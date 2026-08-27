(ns eacl-demo.datahike-dynamodb.build-main
  "Builds and compacts one canonical Datahike fixture in a local file store."
  (:require [clojure.data.json :as json]
            [clojure.edn :as edn]
            [clojure.java.io :as io]
            [datahike.api :as d]
            [eacl.datahike.schema :as eacl-schema]
            [eacl-demo.datahike-dynamodb.seed :as seed])
  (:import [java.nio.charset StandardCharsets]
           [java.nio.file Path Paths]
           [java.util UUID])
  (:gen-class))

(def ^:private maximum-line-bytes 1500000)
(def ^:private maximum-batches 10000)
(def ^:private group-size 4)
(def ^:private progress-group-interval 25)
(def ^:private sha256-pattern #"sha256:[0-9a-f]{64}")

(declare database-config expected-counts invalid-line? manifest-resource-path
         parse-environment resource-text)

(defn -main
  [& arguments]
  (when (seq arguments)
    (throw (ex-info "The Datahike builder accepts no command arguments."
                    {:type :eacl-demo/invalid-build-command})))
  (let [{:keys [store-path store-id cut-point manifest-digest]}
        (parse-environment (System/getenv))
        manifest
        (json/read-str (resource-text (manifest-resource-path cut-point))
                       :key-fn keyword)
        _ (when-not (and (= (:fixtureId manifest) "eacl-demo-fixture-v1")
                         (= manifest-digest (get-in manifest [:digests :manifest]))
                         (= cut-point (get-in manifest [:cutPoint :logicalResources])))
            (throw (ex-info "Fixture manifest identity mismatch."
                            {:type :eacl-demo/manifest-identity-mismatch})))
        config (database-config store-path store-id)
        database-created (not (d/database-exists? config))
        _ (when database-created (d/create-database config))
        connection (d/connect config)]
    (try
      (let [state
            (seed/initialize-seed!
             connection
             {:seed-id (:fixtureId manifest)
              :manifest-digest manifest-digest
              :schema-source (resource-text "schema.v1.zed")})
            batches
            (with-open [reader (io/reader System/in :encoding "UTF-8")]
              (reduce
               (fn [batch-count [group-index lines]]
                 (when (or (>= batch-count maximum-batches)
                           (some invalid-line? lines))
                   (throw (ex-info
                           "Fixture batch stream is invalid or exceeds limits."
                           {:type :eacl-demo/invalid-batch-stream})))
                 (let [inputs (mapv #(json/read-str % :key-fn keyword) lines)
                       result (seed/apply-batch-group! state inputs)
                       next-count (+ batch-count (count inputs))]
                   (when (or (zero? (mod (inc group-index)
                                         progress-group-interval))
                             (= (:next-resource-ordinal result) cut-point))
                     (println
                      (json/write-str
                       {:kind "build-progress"
                        :status (name (:status result))
                        :batches next-count
                        :nextResourceOrdinal
                        (:next-resource-ordinal result)})))
                   next-count))
               0
               (map-indexed vector
                            (partition-all group-size (line-seq reader)))))
            expected-batches
            (long (Math/ceil (/ (double cut-point) 250.0)))
            _ (when-not (= expected-batches batches)
                (throw (ex-info "Fixture batch count mismatch."
                                {:type :eacl-demo/batch-count-mismatch
                                 :expected expected-batches
                                 :actual batches})))
            final-result
            (seed/finalize-seed!
             state
             {:cutPointResources cut-point
              :counts (expected-counts manifest)})
            compaction (seed/compact-store! state)
            verified
            (seed/finalize-seed!
             state
             {:cutPointResources cut-point
              :counts (expected-counts manifest)})]
        (println
         (json/write-str
          {:kind "build-complete"
           :status (name (:status verified))
           :databaseCreated database-created
           :batches batches
           :storeId (str store-id)
           :manifestDigest manifest-digest
           :contentBasisT (:content-basis-t final-result)
           :publicationBasisT (:publication-basis-t verified)
           :deletedKeyCount (:deleted-key-count compaction)
           :counts (:counts verified)})))
      (finally
        (d/release connection)))))

(defn database-config
  [store-path store-id]
  {:store {:backend :file
           :path store-path
           :id store-id}
   :writer {:backend :self
            :writer-ownership :exclusive}
   :schema-flexibility :write
   :attribute-refs? true
   :keep-history? false
   :max-string-length 0
   :store-cache-size 256
   :search-cache-size 0
   :index-config {:diff-buf-size 256}
   :fuse-index-roots? true
   :commit-graph? false
   :initial-tx
   (eacl-schema/merge-schema
    (edn/read-string (resource-text "datahike-demo-metadata-schema.edn")))})

(defn parse-environment
  [environment]
  (let [path-text (get environment "EACL_DATAHIKE_STORE_PATH")
        store-id-text (get environment "EACL_DATAHIKE_STORE_ID")
        digest (get environment "EACL_FIXTURE_MANIFEST_DIGEST")
        cut-point-text (get environment "EACL_FIXTURE_CUT_POINT")
        cut-point
        (when (and (string? cut-point-text)
                   (re-matches #"[1-9][0-9]{0,6}" cut-point-text))
          (Long/parseLong cut-point-text))
        store-id
        (try (when (string? store-id-text) (UUID/fromString store-id-text))
             (catch IllegalArgumentException _ nil))
        store-path
        (try
          (when (string? path-text)
            (let [^Path path (Paths/get path-text (make-array String 0))]
              (when (.isAbsolute path)
                (str (.normalize path)))))
          (catch Throwable _ nil))]
    (when-not (and (= path-text store-path)
                   (not-empty store-path)
                   store-id
                   (re-matches sha256-pattern (or digest ""))
                   (contains? #{10000 1000000} cut-point))
      (throw (ex-info "Datahike build environment is incomplete or invalid."
                      {:type :eacl-demo/invalid-build-environment})))
    {:store-path store-path
     :store-id store-id
     :manifest-digest digest
     :cut-point cut-point}))

(defn manifest-resource-path
  [cut-point]
  (str "manifests/fixture-" cut-point ".v1.json"))

(defn resource-text
  [resource-name]
  (if-let [resource (io/resource resource-name)]
    (slurp resource :encoding "UTF-8")
    (throw (ex-info "Required Datahike build resource is absent."
                    {:type :eacl-demo/missing-build-resource
                     :resource resource-name}))))

(defn- invalid-line?
  [line]
  (or (zero? (count line))
      (> (alength (.getBytes ^String line StandardCharsets/UTF_8))
         maximum-line-bytes)))

(defn- expected-counts
  [manifest]
  {:objects (get-in manifest [:counts :objects :total])
   :subjects (get-in manifest [:counts :objects :subjects :total])
   :resources (get-in manifest [:counts :objects :resources :total])
   :relationships (get-in manifest [:counts :relationships :total])
   :records (get-in manifest [:counts :records :total])})
