(ns eacl-demo.datahike-dynamodb.client
  "DynamoDB SDK membrane exposing only the serving reader's exact operations."
  (:import [java.lang.reflect InvocationHandler InvocationTargetException Method Proxy]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]))

(def ^:private allowed-signatures
  #{["getItem"
     ["software.amazon.awssdk.services.dynamodb.model.GetItemRequest"]]
    ["batchGetItem"
     ["software.amazon.awssdk.services.dynamodb.model.BatchGetItemRequest"]]
    ["describeTable"
     ["software.amazon.awssdk.services.dynamodb.model.DescribeTableRequest"]]
    ["close" []]
    ["serviceName" []]})

(defn- signature
  [^Method method]
  [(.getName method)
   (mapv #(.getName ^Class %) (.getParameterTypes method))])

(defn- denied!
  [^Method method]
  (throw
   (ex-info
    "The Datahike/DynamoDB serving SDK membrane denied an operation."
    {:type :eacl-demo/read-only
     :code "route-not-found"
     :operation (.getName method)})))

(defn- invoke-delegate
  [^Method method delegate args]
  (try
    (.invoke method delegate args)
    (catch InvocationTargetException error
      ;; Preserve AWS SDK exception types so the adapter can distinguish
      ;; throttle, access denial, timeout, absence, and transport failures.
      (throw (.getCause error)))))

(defn read-only-client
  "Wraps one SDK client in an exact read/describe/close allowlist.

  This is an in-process backstop, not a replacement for the exact-table
  read-only IAM role. Unknown overloads and all write/admin calls fail before
  the delegate can execute them."
  [^DynamoDbClient delegate]
  (when-not (instance? DynamoDbClient delegate)
    (throw (ex-info "A DynamoDbClient delegate is required."
                    {:type :eacl-demo/invalid-dynamodb-client})))
  (Proxy/newProxyInstance
   (.getClassLoader DynamoDbClient)
   (into-array Class [DynamoDbClient])
   (reify InvocationHandler
     (invoke [_ proxy method args]
       (case (.getName ^Method method)
         "toString" "eacl-demo-read-only-dynamodb-client"
         "hashCode" (System/identityHashCode proxy)
         "equals" (identical? proxy (when args (aget ^objects args 0)))
         (if (contains? allowed-signatures (signature method))
           (invoke-delegate method delegate args)
           (denied! method)))))))
