(ns eacl-demo.datahike-dynamodb.full-local-reader-test
  "Physical-format compatibility test only; this is not a production seeder."
  (:require [clojure.test :refer [deftest is testing]]
            [datahike.api :as d]
            [eacl.datahike.core :as datahike-eacl]
            [eacl-demo.datahike-dynamodb.reader :as reader]
            [konserve-dynamodb.core :as upstream]
            [konserve.store :as store]
            [konserve.utils :refer [*default-sync-translation* async+sync]]
            [superv.async :refer [go-try-]])
  (:import [java.net URI]
           [java.util UUID]
           [software.amazon.awssdk.auth.credentials
            AwsBasicCredentials StaticCredentialsProvider]
           [software.amazon.awssdk.http.urlconnection UrlConnectionHttpClient]
           [software.amazon.awssdk.regions Region]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]
           [software.amazon.awssdk.services.dynamodb.model
            AttributeDefinition BillingMode CreateTableRequest
            DeleteTableRequest KeySchemaElement KeyType ScalarAttributeType]))

(def seed-backend :eacl-demo-dynamodb-local-format-seed)
(defonce ^:private initialized-tables (atom #{}))

(def ^:private storage-config
  {:sync-blob? true
   :in-place? true
   :no-backup? true
   :lock-blob? true})

(defn- seed-spec
  [config]
  (dissoc config :backend))

(defn- connect-seed-store
  [config]
  (upstream/connect-store
   (seed-spec config)
   :opts {:sync? true}
   :config storage-config))

(defmethod store/-store-exists? seed-backend
  [config opts]
  (async+sync (:sync? opts) *default-sync-translation*
              (go-try- (contains? @initialized-tables (:table config)))))

(defmethod store/-create-store seed-backend
  [config opts]
  (async+sync (:sync? opts) *default-sync-translation*
              (go-try-
               (let [connected (connect-seed-store config)]
                 (swap! initialized-tables conj (:table config))
                 connected))))

(defmethod store/-connect-store seed-backend
  [config opts]
  (async+sync (:sync? opts) *default-sync-translation*
              (go-try- (connect-seed-store config))))

(defmethod store/-delete-store seed-backend
  [& _]
  (throw (ex-info "The format-only local writer cannot delete a table."
                  {:type :eacl-demo/read-only-table-lifecycle})))

(defmethod store/-release-store seed-backend
  [_config connected opts]
  (async+sync (:sync? opts) *default-sync-translation*
              (go-try- (upstream/release connected {:sync? true}))))

(defn- endpoint
  []
  (or (System/getProperty "eacl.demo.dynamodb.local.endpoint")
      (System/getenv "EACL_DYNAMODB_LOCAL_ENDPOINT")))

(defn- client
  [endpoint]
  (-> (DynamoDbClient/builder)
      (.endpointOverride (URI/create endpoint))
      (.region (Region/of "us-east-1"))
      (.credentialsProvider
       (StaticCredentialsProvider/create
        (AwsBasicCredentials/create "dummy" "dummy")))
      (.httpClientBuilder (UrlConnectionHttpClient/builder))
      .build))

(defn- create-table!
  [^DynamoDbClient client table]
  (.createTable
   client
   (-> (CreateTableRequest/builder)
       (.tableName table)
       (.attributeDefinitions
        [(-> (AttributeDefinition/builder)
             (.attributeName "Key")
             (.attributeType ScalarAttributeType/S)
             .build)])
       (.keySchema
        [(-> (KeySchemaElement/builder)
             (.attributeName "Key")
             (.keyType KeyType/HASH)
             .build)])
       (.billingMode BillingMode/PAY_PER_REQUEST)
       .build)))

(defn- delete-table!
  [^DynamoDbClient client table]
  (.deleteTable client
                (-> (DeleteTableRequest/builder)
                    (.tableName table)
                    .build)))

(deftest written-physical-format-opens-through-read-only-serving-reader-test
  (if-let [local-endpoint (endpoint)]
    (let [store-id (UUID/randomUUID)
          table (str "eacl-demo-local-full-"
                     (.replace (str (UUID/randomUUID)) "-" ""))
          admin (client local-endpoint)
          connection (atom nil)
          opened (atom nil)
          writer-config
          {:store {:backend seed-backend
                   :id store-id
                   :region "us-east-1"
                   :table table
                   :endpoint local-endpoint
                   :access-key "dummy"
                   :secret "dummy"
                   :consistent-read? true}
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
           :table table
           :store-id store-id
           :store-cache-size 1000
           :search-cache-size 0
           :maximum-concurrency 1
           :security-key (apply str (repeat 32 "k"))
           :max-attempts 4
           :base-delay-ms 1
           :max-delay-ms 4
           :attempt-timeout-ms 3000
           :connect-timeout-ms 1000}]
      (try
        (create-table! admin table)
        (d/create-database writer-config)
        (reset! connection (d/connect writer-config))
        (d/transact @connection
                    [{:db/ident :demo/value
                      :db/valueType :db.type/string
                      :db/cardinality :db.cardinality/one}])
        (d/transact @connection [{:demo/value "full-reader"}])
        (d/release @connection)
        (reset! connection nil)

        (reset! opened (reader/open-reader! reader-config))
        (let [snapshot ((:capture-snapshot @opened))]
          (try
            (testing "the serving reader decodes the writer's physical format"
              (is (= #{["full-reader"]}
                     (d/q '[:find ?value
                            :where
                            [_ :demo/value ?value]]
                          (datahike-eacl/db (:value snapshot)))))
              (is (= "request-snapshot" (get-in snapshot [:basis :behavior]))))
            (finally
              ((:release! snapshot)))))
        (finally
          (when @opened (reader/close-reader! @opened))
          (when @connection (d/release @connection))
          (swap! initialized-tables disj table)
          (try (delete-table! admin table) (catch Exception _))
          (.close admin))))
    (is true "full local reader qualification skipped without an endpoint")))
