(ns eacl-demo.datahike-dynamodb.adapter
  "Strongly consistent, typed, bounded read adapter for immutable DynamoDB data."
  (:require [clojure.set :as set]
            [eacl-demo.datahike-dynamodb.errors :as errors]
            [eacl-demo.datahike-dynamodb.retry :as retry])
  (:import [java.time Duration]
           [java.util ArrayList HashMap Map]
           [software.amazon.awssdk.awscore AwsRequestOverrideConfiguration]
           [software.amazon.awssdk.core SdkBytes]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]
           [software.amazon.awssdk.services.dynamodb.model
            AttributeValue
            BatchGetItemRequest
            BatchGetItemResponse
            GetItemRequest
            GetItemResponse
            KeysAndAttributes]))

(def required-attributes #{"Key" "Header" "Meta" "Value"})

(defn- string-attribute
  [value]
  (-> (AttributeValue/builder) (.s value) .build))

(defn- key-map
  [store-key]
  (doto (HashMap.) (.put "Key" (string-attribute store-key))))

(defn- request-timeout
  [{:keys [attempt-timeout-ms deadline-ms clock]
    :or {attempt-timeout-ms 3000 clock #(System/currentTimeMillis)}}]
  (Duration/ofMillis
   (long
    (max 1
         (min attempt-timeout-ms
              (if deadline-ms
                (max 1 (- deadline-ms (clock)))
                attempt-timeout-ms))))))

(defn- request-override
  [configured]
  (let [timeout (request-timeout configured)]
    (-> (AwsRequestOverrideConfiguration/builder)
        (.apiCallTimeout timeout)
        (.apiCallAttemptTimeout timeout)
        .build)))

(defn build-get-request
  ([table store-key]
   (build-get-request table store-key {}))
  ([table store-key configured]
   (-> (GetItemRequest/builder)
       (.tableName table)
       (.key (key-map store-key))
       (.consistentRead true)
       (.overrideConfiguration (request-override configured))
       .build)))

(defn- attribute-bytes
  [^AttributeValue attribute]
  (some-> attribute .b ^SdkBytes .asByteArray))

(defn validate-item!
  [operation requested-key item]
  (let [item (into {} item)]
    (when-not (and (= requested-key (some-> ^AttributeValue (get item "Key") .s))
                   (every? #(some? (attribute-bytes (get item %)))
                           ["Header" "Meta" "Value"]))
      (errors/corrupt! operation))
    item))

(defn get-item!
  ([client table store-key configured]
   (get-item! client table store-key configured
              (fn [^DynamoDbClient client ^GetItemRequest request]
                (.getItem client request))))
  ([client table store-key configured call-get-item]
   (when-not (and (string? table) (not-empty table)
                  (string? store-key) (not-empty store-key)
                  (fn? call-get-item))
     (throw (ex-info "Invalid DynamoDB GetItem input."
                     {:type :eacl-demo/invalid-dynamodb-read})))
   (let [configured (retry/policy configured)
         ^GetItemResponse response
         (retry/invoke!
          :get-item configured
          (fn [_]
            (call-get-item client
                           (build-get-request table store-key configured))))
         _ (when-not (instance? GetItemResponse response)
             (throw (errors/error :get-item :unexpected
                                  "internal-error" false nil)))
         item (when (.hasItem response) (.item response))]
     (when (seq item)
       (validate-item! :get-item store-key item)))))

(defn build-batch-request
  ([table store-keys]
   (build-batch-request table store-keys {}))
  ([table store-keys configured]
   (let [keys (ArrayList.)
         _ (doseq [store-key store-keys] (.add keys (key-map store-key)))
         attributes (-> (KeysAndAttributes/builder)
                        (.keys keys)
                        (.consistentRead true)
                        .build)]
     (-> (BatchGetItemRequest/builder)
         (.requestItems {table attributes})
         (.overrideConfiguration (request-override configured))
         .build))))

(defn- response-keys
  [^KeysAndAttributes attributes]
  (mapv #(some-> ^Map % (.get "Key") ^AttributeValue .s)
        (if attributes (.keys attributes) [])))

(defn batch-get-items!
  ([client table store-keys configured]
   (batch-get-items!
    client table store-keys configured
    (fn [^DynamoDbClient client ^BatchGetItemRequest request]
      (.batchGetItem client request))))
  ([client table store-keys configured call-batch-get]
   (let [provided (vec store-keys)
         requested (vec (distinct provided))
         configured (retry/policy configured)]
     (when-not (and (string? table) (not-empty table)
                    (= (count provided) (count requested))
                    (seq requested) (<= (count provided) 100)
                    (every? #(and (string? %) (not-empty %)) requested)
                    (fn? call-batch-get))
       (throw (ex-info "Invalid DynamoDB BatchGetItem input."
                       {:type :eacl-demo/invalid-dynamodb-batch-read})))
     (loop [attempt 1 pending requested found {}]
       (retry/check-active! configured)
       (let [request (build-batch-request table pending configured)
             outcome
             (try
               {:ok true :response (call-batch-get client request)}
               (catch Exception throwable
                 {:ok false :error (errors/classify :batch-get-item throwable)}))]
         (if-not (:ok outcome)
           (do
             (retry/wait-before-retry! configured attempt (:error outcome))
             (recur (inc attempt) pending found))
           (let [^BatchGetItemResponse response (:response outcome)
                 _ (when-not (instance? BatchGetItemResponse response)
                     (throw (errors/error :batch-get-item :unexpected
                                          "internal-error" false nil)))
                 response-tables (set (keys (if response (.responses response) {})))
                 unprocessed-tables
                 (set (keys (if response (.unprocessedKeys response) {})))
                 _ (when (or (seq (disj response-tables table))
                             (seq (disj unprocessed-tables table)))
                     (errors/corrupt! :batch-get-item))
                 items (vec (get (if response (.responses response) {}) table []))
                 validated
                 (reduce
                  (fn [acc item]
                    (let [key (some-> ^Map item (.get "Key") ^AttributeValue .s)]
                      (when (or (not (some #{key} pending))
                                (contains? found key)
                                (contains? acc key))
                        (errors/corrupt! :batch-get-item))
                      (assoc acc key (validate-item! :batch-get-item key item))))
                  {}
                  items)
                 unprocessed
                 (response-keys
                  (get (if response (.unprocessedKeys response) {}) table))
                 _ (when (or (not= (count unprocessed) (count (distinct unprocessed)))
                             (some nil? unprocessed)
                             (seq (set/difference (set unprocessed) (set pending)))
                             (seq (set/intersection (set unprocessed)
                                                    (set (keys validated)))))
                     (errors/corrupt! :batch-get-item))
                 found (merge found validated)]
             (if (empty? unprocessed)
               found
               (let [throttled
                     (errors/error :batch-get-item :throttled "throttled" true nil)]
                 (retry/wait-before-retry! configured attempt throttled)
                 (recur (inc attempt) unprocessed found))))))))))
