(ns eacl-demo.datahike-s3.full-local-reader-test
  "Physical-format compatibility test only; this is not a production seeder."
  (:require [clojure.test :refer [deftest is testing]]
            [datahike.api :as d]
            [eacl.datahike.core :as datahike-eacl]
            [eacl-demo.datahike-s3.reader :as reader]
            [konserve-s3.core :as upstream])
  (:import [java.net URI]
           [java.security MessageDigest]
           [java.util UUID]
           [software.amazon.awssdk.auth.credentials
            AwsBasicCredentials StaticCredentialsProvider]
           [software.amazon.awssdk.http.urlconnection UrlConnectionHttpClient]
           [software.amazon.awssdk.regions Region]
           [software.amazon.awssdk.services.s3 S3Client]
           [software.amazon.awssdk.services.s3.model DeleteBucketRequest]))

(defn- local-setting
  [property environment]
  (or (System/getProperty property) (System/getenv environment)))

(defn- client
  [endpoint access-key secret]
  (-> (S3Client/builder)
      (.endpointOverride (URI/create endpoint))
      (.region (Region/of "us-east-1"))
      (.credentialsProvider
       (StaticCredentialsProvider/create
        (AwsBasicCredentials/create access-key secret)))
      (.serviceConfiguration
       (reify java.util.function.Consumer
         (accept [_ builder]
           (.pathStyleAccessEnabled builder true))))
      (.httpClientBuilder (UrlConnectionHttpClient/builder))
      .build))

(defn- hex
  [^bytes value]
  (apply str (map #(format "%02x" (bit-and 0xff %)) value)))

(defn- object-fingerprint
  [client bucket]
  (into (sorted-map)
        (map (fn [key]
               [key (-> (MessageDigest/getInstance "SHA-256")
                        (.digest ^bytes (upstream/get-object client bucket key))
                        hex)]))
        (upstream/list-objects client bucket)))

(deftest written-physical-format-opens-without-changing-any-s3-object-test
  (if-let [endpoint (local-setting "eacl.demo.s3.local.endpoint"
                                   "EACL_S3_LOCAL_ENDPOINT")]
    (let [access-key (or (local-setting "eacl.demo.s3.local.access-key"
                                        "EACL_S3_LOCAL_ACCESS_KEY") "minioadmin")
          secret (or (local-setting "eacl.demo.s3.local.secret"
                                    "EACL_S3_LOCAL_SECRET") "minioadmin")
          store-id (UUID/randomUUID)
          bucket (str "eacl-demo-local-"
                      (.replace (str (UUID/randomUUID)) "-" ""))
          endpoint-map (let [uri (URI/create endpoint)]
                         {:protocol (keyword (.getScheme uri))
                          :hostname (.getHost uri)
                          :port (.getPort uri)})
          writer-config
          {:store {:backend :s3
                   :id store-id
                   :region "us-east-1"
                   :bucket bucket
                   :endpoint-override endpoint-map
                   :path-style-access? true
                   :access-key access-key
                   :secret secret}
           :schema-flexibility :write
           :attribute-refs? true
           :keep-history? false
           :max-string-length 0
           :store-cache-size 1000
           :search-cache-size 0
           :index-config {:diff-buf-size 256}
           :fuse-index-roots? true
           :commit-graph? false}
          reader-config
          {:region "us-east-1"
           :bucket bucket
           :store-id store-id
           :store-cache-size 1000
           :search-cache-size 0
           :maximum-concurrency 1
           :security-key (apply str (repeat 32 "k"))}
          admin (client endpoint access-key secret)
          connection (atom nil)
          opened (atom nil)]
      (try
        (d/create-database writer-config)
        (reset! connection (d/connect writer-config))
        (d/transact @connection
                    [{:db/ident :demo/value
                      :db/valueType :db.type/string
                      :db/cardinality :db.cardinality/one}])
        (d/transact @connection [{:demo/value "full-reader"}])
        (d/release @connection)
        (reset! connection nil)
        (let [before (object-fingerprint admin bucket)]
          (with-redefs [upstream/s3-client (fn [_] admin)]
            (reset! opened (reader/open-reader! reader-config)))
          (let [snapshot ((:capture-snapshot @opened))]
            (try
              (testing "the serving reader decodes the upstream physical format"
                (is (= #{["full-reader"]}
                       (d/q '[:find ?value
                              :where
                              [_ :demo/value ?value]]
                            (datahike-eacl/db (:value snapshot)))))
                (is (= "request-snapshot"
                       (get-in snapshot [:basis :behavior]))))
              (finally
                ((:release! snapshot)))))
          (testing "open and query perform no physical mutation"
            (is (= before (object-fingerprint admin bucket)))))
        (finally
          (when @opened (reader/close-reader! @opened))
          (when @connection (d/release @connection))
          (try (d/delete-database writer-config) (catch Exception _))
          (try
            (.deleteBucket admin
                           (-> (DeleteBucketRequest/builder)
                               (.bucket bucket)
                               .build))
            (catch Exception _))
          (.close admin)
          (upstream/shutdown-clients!))))
    (is true "full local S3 reader qualification skipped without an endpoint")))
