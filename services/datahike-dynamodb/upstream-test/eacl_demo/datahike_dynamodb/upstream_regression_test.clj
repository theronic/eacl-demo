(ns eacl-demo.datahike-dynamodb.upstream-regression-test
  "Executable rejection evidence for the exact upstream adapter artifact."
  (:require [clojure.test :refer [deftest is testing]]
            [konserve-dynamodb.core :as upstream]
            [konserve.impl.defaults :as defaults]
            [konserve.impl.storage-layout :as storage])
  (:import [java.lang.reflect InvocationHandler Method Proxy]
           [java.util HashMap]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]
           [software.amazon.awssdk.services.dynamodb.model
            AttributeValue
            BatchGetItemResponse
            DeleteTableResponse
            GetItemResponse
            KeysAndAttributes
            ProvisionedThroughputExceededException]))

(defn- proxy-client
  [calls handlers]
  (Proxy/newProxyInstance
   (.getClassLoader DynamoDbClient)
   (into-array Class [DynamoDbClient])
   (reify InvocationHandler
     (invoke [_ proxy method args]
       (let [method-name (.getName method)]
         (swap! calls conj method-name)
         (case method-name
           "serviceName" "DynamoDb"
           "close" nil
           "toString" "upstream-regression-dynamodb-client"
           "hashCode" (System/identityHashCode proxy)
           "equals" (identical? proxy (when args (aget ^objects args 0)))
           (if-let [handler (get handlers method-name)]
             (handler (when args (vec args)))
             (throw (UnsupportedOperationException.
                     (str "Unexpected DynamoDbClient call: " method-name))))))))))

(defn- string-attribute
  [value]
  (-> (AttributeValue/builder) (.s value) .build))

(defn- key-map
  [value]
  (doto (HashMap.) (.put "Key" (string-attribute value))))

(deftest broad-exception-is-misclassified-as-absence
  (testing "a throttled GetItem becomes nil in the exact rejected upstream artifact"
    (let [calls (atom [])
          client
          (proxy-client
           calls
           {"getItem"
            (fn [_]
              (throw
               (-> (ProvisionedThroughputExceededException/builder)
                   (.message "synthetic throttle")
                   .build)))})]
      (is (nil? (upstream/get-item client "table" (key-map "key") true)))
      (is (= ["getItem"] @calls)))))

(deftest eventual-read-is-the-upstream-default
  (testing "omitting consistent-read? selects eventual reads"
    (let [calls (atom [])
          client (proxy-client calls {})
          backing
          (with-redefs [upstream/dynamodb-client (constantly client)
                        defaults/connect-default-store (fn [value _] value)]
            (upstream/connect-store {:region "us-east-1" :table "table"}))]
      (is (false? (:consistent-read? backing)))
      (is (empty? @calls)))))

(deftest partial-batch-is-returned-as-if-complete
  (testing "one unprocessed key is silently omitted without a retry"
    (let [calls (atom [])
          processed (doto (HashMap.)
                      (.put "Key" (string-attribute "processed"))
                      (.put "Header" (string-attribute "not-read-in-this-test")))
          unprocessed
          (-> (KeysAndAttributes/builder)
              (.keys (java.util.ArrayList. [(key-map "unprocessed")]))
              (.consistentRead true)
              .build)
          response
          (-> (BatchGetItemResponse/builder)
              (.responses {"table" [processed]})
              (.unprocessedKeys {"table" unprocessed})
              .build)
          client (proxy-client calls {"batchGetItem" (constantly response)})
          backing (upstream/->DynamoDBStore client "table" true (atom {}))
          result (storage/-multi-read-blobs
                  backing ["processed" "unprocessed"] {:sync? true})]
      (is (= #{"processed"} (set (keys result))))
      (is (= ["batchGetItem"] @calls)))))

(deftest destructive-table-delete-is-reachable
  (testing "the rejected adapter exposes DeleteTable from its backing store"
    (let [calls (atom [])
          response (-> (DeleteTableResponse/builder) .build)
          client (proxy-client calls {"deleteTable" (constantly response)})
          backing (upstream/->DynamoDBStore client "table" true (atom {}))]
      (storage/-delete-store backing {:sync? true})
      (is (= ["deleteTable"] @calls)))))
