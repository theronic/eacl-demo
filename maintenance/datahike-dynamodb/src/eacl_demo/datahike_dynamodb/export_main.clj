(ns eacl-demo.datahike-dynamodb.export-main
  "Exports a compact, preflighted file store with an S3-backed resume point."
  (:require [clojure.data.json :as json]
            [eacl-demo.datahike-dynamodb.export :as export])
  (:import [java.nio.charset StandardCharsets]
           [java.nio.file Path Paths]
           [java.time Instant]
           [java.util UUID]
           [software.amazon.awssdk.core ResponseBytes]
           [software.amazon.awssdk.core.sync RequestBody]
           [software.amazon.awssdk.http.urlconnection UrlConnectionHttpClient]
           [software.amazon.awssdk.regions Region]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]
           [software.amazon.awssdk.services.s3 S3Client]
           [software.amazon.awssdk.services.s3.model
            GetObjectRequest GetObjectResponse PutObjectRequest
            ServerSideEncryption S3Exception])
  (:gen-class))

(def ^:private digest-pattern #"sha256:[0-9a-f]{64}")
(def ^:private table-pattern #"eacl-demo-datahike-[a-z0-9-]{3,80}")
(def ^:private bucket-pattern #"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]")
(def ^:private key-pattern #"[A-Za-z0-9][A-Za-z0-9!_.*'()/-]{0,1023}")
(def ^:private checkpoint-kind
  "datahike-dynamodb-export-checkpoint-v1")
(def ^:private checkpoint-interval 1000)

(declare checkpoint-identity checkpoint-value parse-environment read-checkpoint
         require-valid-checkpoint! write-checkpoint!)

(defn -main
  [& arguments]
  (when (seq arguments)
    (throw (ex-info "The Datahike exporter accepts no command arguments."
                    {:type :eacl-demo/invalid-export-command})))
  (let [{:keys [region table store-path bucket checkpoint-key] :as configured}
        (parse-environment (System/getenv))
        preflight (export/preflight-store store-path)
        identity (checkpoint-identity configured preflight)
        ^S3Client s3 (-> (S3Client/builder)
                         (.region (Region/of region))
                         (.httpClient (UrlConnectionHttpClient/create))
                         .build)
        ^DynamoDbClient dynamodb (-> (DynamoDbClient/builder)
                                     (.region (Region/of region))
                                     (.httpClient
                                      (UrlConnectionHttpClient/create))
                                     .build)]
    (try
      (let [existing (read-checkpoint s3 bucket checkpoint-key)
            start-index (if existing
                          (require-valid-checkpoint! identity preflight existing)
                          0)
            total (:object-count preflight)
            last-persisted (atom start-index)
            persist!
            (fn [{:keys [next-index] :as progress}]
              (when (or (= next-index total)
                        (>= (- next-index @last-persisted)
                            checkpoint-interval))
                (let [checkpoint (checkpoint-value identity progress
                                                   (= next-index total))]
                  (write-checkpoint! s3 bucket checkpoint-key checkpoint)
                  (reset! last-persisted next-index)
                  (println
                   (json/write-str
                    {:kind "export-progress"
                     :confirmedObjects next-index
                     :totalObjects total
                     :storeDigest (:storeDigest checkpoint)})))))
            result (export/export-store!
                    dynamodb table store-path preflight
                    {:start-index start-index :checkpoint! persist!})
            final-progress
            {:next-index total
             :last-key (:key (peek (:entries preflight)))
             :store-digest (:store-digest preflight)}
            completed (checkpoint-value identity final-progress true)]
        (write-checkpoint! s3 bucket checkpoint-key completed)
        (println
         (json/write-str
          {:kind "export-complete"
           :status "exported"
           :table table
           :storeId (:storeId identity)
           :manifestDigest (:manifestDigest identity)
           :storeDigest (:storeDigest identity)
           :archiveSha256 (:archiveSha256 identity)
           :objectCount total
           :itemBytes (:item-bytes preflight)
           :writeUnits (:write-units preflight)
           :resumedAtObject start-index
           :requests (:request-count result)})))
      (finally
        (.close dynamodb)
        (.close s3)))))

(defn parse-environment
  [environment]
  (let [region (get environment "AWS_REGION")
        table (get environment "EACL_DATAHIKE_TABLE")
        path-text (get environment "EACL_DATAHIKE_STORE_PATH")
        store-id-text (get environment "EACL_DATAHIKE_STORE_ID")
        manifest-digest (get environment "EACL_FIXTURE_MANIFEST_DIGEST")
        archive-sha256 (get environment "EACL_STORE_ARCHIVE_SHA256")
        bucket (get environment "EACL_ARTIFACT_BUCKET")
        checkpoint-key (get environment "EACL_EXPORT_CHECKPOINT_KEY")
        store-id
        (try (when (string? store-id-text) (UUID/fromString store-id-text))
             (catch IllegalArgumentException _ nil))
        store-path
        (try
          (when (string? path-text)
            (let [^Path path (Paths/get path-text (make-array String 0))]
              (when (.isAbsolute path) (str (.normalize path)))))
          (catch Throwable _ nil))]
    (when-not (and (= "us-east-1" region)
                   (re-matches table-pattern (or table ""))
                   (= path-text store-path) (not-empty store-path)
                   store-id
                   (re-matches digest-pattern (or manifest-digest ""))
                   (re-matches digest-pattern (or archive-sha256 ""))
                   (re-matches bucket-pattern (or bucket ""))
                   (re-matches key-pattern (or checkpoint-key ""))
                   (not (.contains ^String checkpoint-key ".."))
                   (.startsWith ^String checkpoint-key
                                "checkpoints/datahike-dynamodb/"))
      (throw (ex-info "Datahike export environment is incomplete or invalid."
                      {:type :eacl-demo/invalid-export-environment})))
    {:region region
     :table table
     :store-path store-path
     :store-id store-id
     :manifest-digest manifest-digest
     :archive-sha256 archive-sha256
     :bucket bucket
     :checkpoint-key checkpoint-key}))

(defn checkpoint-identity
  [{:keys [table store-id manifest-digest archive-sha256]}
   {:keys [store-digest object-count]}]
  (sorted-map
   :kind checkpoint-kind
   :table table
   :storeId (str store-id)
   :manifestDigest manifest-digest
   :archiveSha256 archive-sha256
   :storeDigest store-digest
   :objectCount object-count))

(defn checkpoint-value
  [identity {:keys [next-index last-key store-digest]} complete?]
  (when-not (= store-digest (:storeDigest identity))
    (throw (ex-info "Checkpoint store identity changed."
                    {:type :eacl-demo/checkpoint-store-mismatch})))
  (into (sorted-map)
        (assoc identity
               :nextIndex next-index
               :lastKey last-key
               :complete complete?
               :updatedAt (str (Instant/now)))))

(defn require-valid-checkpoint!
  [identity preflight checkpoint]
  (let [identity-keys (set (keys identity))
        expected-identity (select-keys checkpoint identity-keys)
        next-index (:nextIndex checkpoint)
        entries (:entries preflight)
        expected-last-key (when (pos? (or next-index 0))
                            (:key (nth entries (dec next-index) nil)))]
    (when-not (and (= identity expected-identity)
                   (= (conj identity-keys :nextIndex :lastKey :complete :updatedAt)
                      (set (keys checkpoint)))
                   (nat-int? next-index)
                   (<= next-index (count entries))
                   (= expected-last-key (:lastKey checkpoint))
                   (boolean? (:complete checkpoint))
                   (= (:complete checkpoint) (= next-index (count entries)))
                   (string? (:updatedAt checkpoint)))
      (throw (ex-info "Datahike export checkpoint is invalid."
                      {:type :eacl-demo/invalid-export-checkpoint})))
    next-index))

(defn read-checkpoint
  [^S3Client client bucket key]
  (try
    (let [request (-> (GetObjectRequest/builder)
                      (.bucket bucket)
                      (.key key)
                      .build)
          ^ResponseBytes response
          (.getObjectAsBytes client request)]
      (json/read-str (.asUtf8String response) :key-fn keyword))
    (catch S3Exception error
      (if (= 404 (.statusCode error)) nil (throw error)))))

(defn write-checkpoint!
  [^S3Client client bucket key checkpoint]
  (let [content (.getBytes (str (json/write-str checkpoint) "\n")
                           StandardCharsets/UTF_8)
        request (-> (PutObjectRequest/builder)
                    (.bucket bucket)
                    (.key key)
                    (.contentType "application/json")
                    (.cacheControl "no-store")
                    (.serverSideEncryption ServerSideEncryption/AES256)
                    .build)]
    (.putObject client request (RequestBody/fromBytes content))))
