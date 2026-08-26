(ns eacl-demo.datahike-dynamodb-local-test
  "DynamoDB Local qualification. The endpoint must be opted in explicitly."
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.datahike-dynamodb.adapter :as adapter]
            [eacl-demo.datahike-dynamodb.client :as read-only-client]
            [eacl-demo.datahike-dynamodb.konserve :as dynamodb]
            [konserve.impl.storage-layout :as storage])
  (:import [java.net URI]
           [java.util HashMap UUID]
           [software.amazon.awssdk.auth.credentials
            AwsBasicCredentials StaticCredentialsProvider]
           [software.amazon.awssdk.core SdkBytes]
           [software.amazon.awssdk.http.urlconnection UrlConnectionHttpClient]
           [software.amazon.awssdk.regions Region]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]
           [software.amazon.awssdk.services.dynamodb.model
            AttributeDefinition AttributeValue BillingMode CreateTableRequest
            DeleteTableRequest KeySchemaElement KeyType PutItemRequest
            ScalarAttributeType]))

(def policy
  {:max-attempts 4 :base-delay-ms 1 :max-delay-ms 4
   :random (constantly 0.0) :sleep! #(Thread/sleep ^long %)})

(defn- endpoint []
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

(defn- bytes-attribute
  [value]
  (-> (AttributeValue/builder)
      (.b (SdkBytes/fromByteArray (.getBytes value "UTF-8")))
      .build))

(defn- string-attribute
  [value]
  (-> (AttributeValue/builder) (.s value) .build))

(defn- item
  [key]
  (doto (HashMap.)
    (.put "Key" (string-attribute key))
    (.put "Header" (bytes-attribute "header"))
    (.put "Meta" (bytes-attribute "meta"))
    (.put "Value" (bytes-attribute "value"))))

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

(defn- put-item!
  [^DynamoDbClient client table value]
  (.putItem client
            (-> (PutItemRequest/builder)
                (.tableName table)
                (.item value)
                .build)))

(defn- delete-table!
  [^DynamoDbClient client table]
  (.deleteTable client
                (-> (DeleteTableRequest/builder)
                    (.tableName table)
                    .build)))

(deftest local-publication-missing-corrupt-batch-and-concurrency-test
  (if-let [endpoint (endpoint)]
    (let [client (client endpoint)
          read-client (read-only-client/read-only-client client)
          table (str "eacl-demo-local-" (.replace (str (UUID/randomUUID)) "-" ""))]
      (try
        (create-table! client table)
        (put-item! client table (item "published"))

        (testing "a publication-critical read is immediately strong"
          (let [value (adapter/get-item! read-client table "published" policy)]
            (is (= "published" (some-> (get value "Key") .s)))))

        (testing "a successful empty result is the only missing-item path"
          (is (nil? (adapter/get-item! read-client table "absent" policy))))

        (testing "malformed physical data is corrupt rather than absent"
          (put-item! client table
                     (doto (HashMap.)
                       (.put "Key" (string-attribute "corrupt"))
                       (.put "Header" (bytes-attribute "header"))))
          (try
            (adapter/get-item! read-client table "corrupt" policy)
            (is false "corrupt item should throw")
            (catch clojure.lang.ExceptionInfo error
              (is (= "storage-corrupt" (:code (ex-data error)))))))

        (testing "batch reads are strong and sparse only for genuine absence"
          (put-item! client table (item "second"))
          (is (= #{"published" "second"}
                 (set (keys (adapter/batch-get-items!
                             read-client table ["published" "second" "absent"]
                             policy))))))

        (testing "the Konserve backing consumes the repaired read path"
          (let [backing (dynamodb/->ReadOnlyStore read-client table policy)
                blob (storage/-create-blob backing "published" {:sync? true})]
            (is (= "header"
                   (String. ^bytes (storage/-read-header blob {:sync? true})
                            "UTF-8")))))

        (testing "representative concurrent reads remain equal"
          (let [workers
                (doall
                 (for [_ (range 16)]
                   (future
                     (dotimes [_ 20]
                       (let [value (adapter/get-item! read-client table "published"
                                                      policy)]
                         (when-not (= "published" (some-> (get value "Key") .s))
                           (throw (ex-info "concurrent read mismatch" {})))))
                     :ok)))]
            (is (= (vec (repeat 16 :ok)) (mapv deref workers)))))

        (testing "a missing table is typed separately from a missing item"
          (try
            (adapter/get-item! read-client (str table "-missing") "published" policy)
            (is false "missing table should throw")
            (catch clojure.lang.ExceptionInfo error
              (is (= :missing (:category (ex-data error))))
              (is (= "storage-missing" (:code (ex-data error)))))))
        (finally
          (try (delete-table! client table) (catch Exception _))
          (.close client))))
    (is true "DynamoDB Local qualification skipped without an explicit endpoint")))
