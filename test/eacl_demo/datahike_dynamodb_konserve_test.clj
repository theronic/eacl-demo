(ns eacl-demo.datahike-dynamodb-konserve-test
  (:require [clojure.test :refer [deftest is testing]]
            [datahike.writer :as writer]
            [eacl-demo.datahike-dynamodb.adapter :as adapter]
            [eacl-demo.datahike-dynamodb.client :as read-only-client]
            [eacl-demo.datahike-dynamodb.context :as context]
            [eacl-demo.datahike-dynamodb.konserve :as dynamodb]
            [eacl-demo.datahike-dynamodb.read-only-writer :as read-only-writer]
            [konserve.impl.storage-layout :as storage]
            [konserve.store :as store])
  (:import [java.lang.reflect InvocationHandler Proxy]
           [java.util HashMap]
           [software.amazon.awssdk.core SdkBytes]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]
           [software.amazon.awssdk.services.dynamodb.model
            AttributeValue DescribeTableResponse GetItemRequest GetItemResponse
            PutItemRequest TableDescription TableStatus]))

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

(defn- string-bytes
  [value]
  (String. ^bytes value "UTF-8"))

(defn- recording-client
  [calls]
  (Proxy/newProxyInstance
   (.getClassLoader DynamoDbClient)
   (into-array Class [DynamoDbClient])
   (reify InvocationHandler
     (invoke [_ proxy method args]
       (let [method-name (.getName method)]
         (swap! calls conj method-name)
         (case method-name
           "getItem" (-> (GetItemResponse/builder) .build)
           "describeTable"
           (-> (DescribeTableResponse/builder)
               (.table (-> (TableDescription/builder)
                           (.tableStatus TableStatus/ACTIVE)
                           .build))
               .build)
           "serviceName" "DynamoDb"
           "close" nil
           "toString" "recording-client"
           "hashCode" (System/identityHashCode proxy)
           "equals" (identical? proxy (when args (aget ^objects args 0)))
           (throw (UnsupportedOperationException. method-name))))))))

(deftest sdk-membrane-allows-exact-reads-and-denies-write-before-delegate-test
  (let [calls (atom [])
        ^DynamoDbClient client
        (read-only-client/read-only-client (recording-client calls))]
    (.getItem client (-> (GetItemRequest/builder)
                         (.tableName "table")
                         (.key {"Key" (string-attribute "key")})
                         .build))
    (is (= ["getItem"] @calls))
    (is (thrown-with-msg?
         clojure.lang.ExceptionInfo #"membrane denied"
         (.putItem client (-> (PutItemRequest/builder)
                              (.tableName "table")
                              (.item {"Key" (string-attribute "key")})
                              .build))))
    (is (= ["getItem"] @calls))))

(deftest read-only-blob-fetches-once-and-preserves-missing-test
  (let [calls (atom [])
        backing (dynamodb/->ReadOnlyStore nil "table" {})]
    (with-redefs [adapter/get-item!
                  (fn [_ _ key options]
                    (swap! calls conj [key options])
                    (when (= key "present") (item key)))]
      (let [blob (storage/-create-blob backing "present" {:sync? true})]
        (is (= "header" (string-bytes
                          (storage/-read-header blob {:sync? true}))))
        (is (= "meta" (string-bytes
                        (storage/-read-meta blob 4 {:sync? true}))))
        (is (= "value" (string-bytes
                         (storage/-read-value blob 5 {:sync? true}))))
        (is (= 1 (count @calls))))
      (let [blob (storage/-create-blob backing "missing" {:sync? true})]
        (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Store key not found"
                              (storage/-read-header blob {:sync? true})))))))

(deftest request-context-reaches-the-low-level-read-test
  (let [captured (atom nil)
        backing (dynamodb/->ReadOnlyStore nil "table"
                                         {:max-attempts 2})]
    (with-redefs [adapter/get-item!
                  (fn [_ _ _ options]
                    (reset! captured options)
                    nil)]
      (binding [context/*request-context*
                {:deadline-ms 500 :cancelled? (constantly false)
                 :clock (constantly 100)}]
        (is (false? (storage/-blob-exists? backing "missing"
                                          {:sync? true}))))
      (is (= 2 (:max-attempts @captured)))
      (is (= 500 (:deadline-ms @captured)))
      (is (fn? (:cancelled? @captured))))))

(deftest every-write-maintenance-and-destructive-operation-is-denied-test
  (let [backing (dynamodb/->ReadOnlyStore nil "table" {})
        blob (storage/-create-blob backing "key" {:sync? true})
        denied
         [(fn [] (storage/-delete-blob backing "key" {:sync? true}))
         (fn [] (storage/-copy backing "a" "b" {:sync? true}))
         (fn [] (storage/-atomic-move backing "a" "b" {:sync? true}))
         (fn [] (storage/-delete-store backing {:sync? true}))
         (fn [] (storage/-keys backing {:sync? true}))
         (fn [] (storage/-migrate backing "legacy" [] nil nil nil
                                  {:sync? true}))
         (fn [] (storage/-write-header blob (byte-array 0) {:sync? true}))
         (fn [] (storage/-write-meta blob (byte-array 0) {:sync? true}))
         (fn [] (storage/-write-value blob (byte-array 0) 0 {:sync? true}))
         (fn [] (storage/-write-binary blob 0 (byte-array 0)
                                       {:sync? true}))]]
    (doseq [operation denied]
      (try
        (operation)
        (is false "operation should be denied")
        (catch clojure.lang.ExceptionInfo error
          (is (= :eacl-demo/read-only (:type (ex-data error)))))))
    (try
      (storage/-create-store backing {:sync? true})
      (is false "missing table creation must be denied")
      (catch clojure.lang.ExceptionInfo error
        (is (= :eacl-demo/missing-dynamodb-store (:type (ex-data error))))))
    (is (not (contains? (methods store/-create-store) dynamodb/backend)))
    (is (not (contains? (methods store/-delete-store) dynamodb/backend)))
    (let [config {:backend dynamodb/backend
                  :id (java.util.UUID/randomUUID)
                  :region "us-east-1"
                  :table "table"}]
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Unsupported store backend"
                            (store/create-store config {:sync? true})))
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Unsupported store backend"
                            (store/delete-store config {:sync? true}))))))

(deftest existing-store-connect-uses-required-in-place-locking-test
  (let [config {:backend dynamodb/backend
                :id (java.util.UUID/randomUUID)
                :region "us-east-1"
                :table "table"}
        calls (atom [])
        connected (dynamodb/connect-store config (recording-client calls))]
    (is (some? connected))
    (is (= ["describeTable"] @calls))
    (is (true? (get-in connected [:config :lock-blob?])))
    (is (true? (get-in connected [:config :in-place?])))))

(deftest multi-read-wraps-only-validated-items-test
  (let [backing (dynamodb/->ReadOnlyStore nil "table" {})]
    (with-redefs [adapter/batch-get-items!
                  (fn [_ _ keys _]
                    (is (= ["one" "two"] keys))
                    {"one" (item "one")})]
      (let [result (storage/-multi-read-blobs backing ["one" "two"]
                                              {:sync? true})]
        (is (= #{"one"} (set (keys result))))
        (is (= "header"
               (string-bytes
                (storage/-read-header (get result "one") {:sync? true}))))))))

(deftest serving-config-and-datahike-writer-reject-credentials-and-mutation-test
  (let [config {:backend dynamodb/backend
                :id (java.util.UUID/randomUUID)
                :region "us-east-1"
                :table "table"}]
    (is (= config (dynamodb/validate-config config)))
    (doseq [forbidden [:access-key :secret :endpoint]]
      (is (thrown? clojure.lang.ExceptionInfo
                   (dynamodb/validate-config
                    (assoc config forbidden "forbidden")))))
    (let [instance (read-only-writer/->ReadOnlyWriter)]
      (is (thrown? clojure.lang.ExceptionInfo
                   (writer/-dispatch! instance {:op :transact})))
      (is (thrown? clojure.lang.ExceptionInfo
                   (writer/create-database
                    {:writer read-only-writer/config} {})))
      (is (thrown? clojure.lang.ExceptionInfo
                   (writer/delete-database
                    {:writer read-only-writer/config} {}))))))
