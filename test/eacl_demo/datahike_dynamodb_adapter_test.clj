(ns eacl-demo.datahike-dynamodb-adapter-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.datahike-dynamodb.adapter :as adapter]
            [eacl-demo.datahike-dynamodb.retry :as retry])
  (:import [java.util HashMap]
           [java.util.concurrent TimeoutException]
           [software.amazon.awssdk.awscore.exception AwsErrorDetails]
           [software.amazon.awssdk.core SdkBytes]
           [software.amazon.awssdk.services.dynamodb.model
            AttributeValue
            BatchGetItemResponse
            DynamoDbException
            GetItemResponse
            KeysAndAttributes
            ProvisionedThroughputExceededException]))

(defn- string-attribute
  [value]
  (-> (AttributeValue/builder) (.s value) .build))

(defn- bytes-attribute
  [value]
  (-> (AttributeValue/builder)
      (.b (SdkBytes/fromByteArray (.getBytes value "UTF-8")))
      .build))

(defn- item
  [key]
  (doto (HashMap.)
    (.put "Key" (string-attribute key))
    (.put "Header" (bytes-attribute "header"))
    (.put "Meta" (bytes-attribute "meta"))
    (.put "Value" (bytes-attribute "value"))))

(defn- get-response
  [value]
  (-> (GetItemResponse/builder) (.item value) .build))

(defn- batch-response
  [responses unprocessed]
  (-> (BatchGetItemResponse/builder)
      (.responses responses)
      (.unprocessedKeys unprocessed)
      .build))

(def no-wait-policy
  {:max-attempts 4
   :base-delay-ms 1
   :max-delay-ms 1
   :random (constantly 0.0)
   :sleep! (fn [_])})

(deftest get-item-distinguishes-absence-corruption-and-dependency-errors-test
  (testing "only an empty successful response is absence"
    (is (nil? (adapter/get-item!
               nil "table" "missing" no-wait-policy
               (fn [_ request]
                 (is (true? (.consistentRead request)))
                 (get-response {}))))))

  (testing "a nil SDK response is an internal failure, never absence"
    (try
      (adapter/get-item! nil "table" "missing" no-wait-policy
                         (fn [_ _] nil))
      (is false "nil response should throw")
      (catch clojure.lang.ExceptionInfo error
        (is (= "internal-error" (:code (ex-data error)))))))

  (testing "a malformed stored node is corrupt, not absent"
    (let [corrupt (doto (HashMap.)
                    (.put "Key" (string-attribute "node")))]
      (try
        (adapter/get-item! nil "table" "node" no-wait-policy
                           (fn [_ _] (get-response corrupt)))
        (is false "corrupt node should throw")
        (catch clojure.lang.ExceptionInfo error
          (is (= {:category :corrupt
                  :code "storage-corrupt"
                  :retryable false}
                 (select-keys (ex-data error)
                              [:category :code :retryable])))))))

  (testing "throttling is retried and never converted to nil"
    (let [calls (atom 0)
          result
          (adapter/get-item!
           nil "table" "node" no-wait-policy
           (fn [_ _]
             (if (< (swap! calls inc) 3)
               (throw
                (-> (ProvisionedThroughputExceededException/builder)
                    (.message "synthetic")
                    .build))
               (get-response (item "node")))))]
      (is (= "node" (some-> (get result "Key") .s)))
      (is (= 3 @calls))))

  (testing "authorization failure is typed and not retried"
    (let [calls (atom 0)
          details (-> (AwsErrorDetails/builder)
                      (.errorCode "AccessDeniedException")
                      .build)
          denied (-> (DynamoDbException/builder)
                     (.statusCode 403)
                     (.awsErrorDetails details)
                     .build)]
      (try
        (adapter/get-item! nil "table" "node" no-wait-policy
                           (fn [_ _] (swap! calls inc) (throw denied)))
        (is false "authorization failure should throw")
        (catch clojure.lang.ExceptionInfo error
          (is (= {:category :authorization
                  :code "dependency-unavailable"
                  :retryable false}
                 (select-keys (ex-data error)
                              [:category :code :retryable])))))
      (is (= 1 @calls))))

  (testing "timeouts remain typed after the bounded retry budget"
    (let [calls (atom 0)]
      (try
        (adapter/get-item! nil "table" "node"
                           (assoc no-wait-policy :max-attempts 2)
                           (fn [_ _]
                             (swap! calls inc)
                             (throw (TimeoutException. "synthetic"))))
        (is false "timeout should throw")
        (catch clojure.lang.ExceptionInfo error
          (is (= :timeout (:category (ex-data error))))
          (is (= "dependency-unavailable" (:code (ex-data error))))))
      (is (= 2 @calls)))))

(deftest batch-retries-every-unprocessed-key-with-strong-reads-test
  (let [calls (atom [])
        unprocessed-attrs
        (-> (KeysAndAttributes/builder)
            (.keys [(doto (HashMap.)
                      (.put "Key" (string-attribute "later")))])
            (.consistentRead true)
            .build)
        result
        (adapter/batch-get-items!
         nil "table" ["now" "later"] no-wait-policy
         (fn [_ request]
           (let [attrs (get (.requestItems request) "table")
                 keys (mapv #(some-> (get % "Key") .s) (.keys attrs))]
             (swap! calls conj {:keys keys :consistent? (.consistentRead attrs)})
             (if (= 1 (count @calls))
               (batch-response {"table" [(item "now")]}
                               {"table" unprocessed-attrs})
               (batch-response {"table" [(item "later")]} {})))))]
    (is (= #{"now" "later"} (set (keys result))))
    (is (= [{:keys ["now" "later"] :consistent? true}
            {:keys ["later"] :consistent? true}]
           @calls))))

(deftest batch-unprocessed-budget-is-bounded-test
  (let [calls (atom 0)
        attrs (-> (KeysAndAttributes/builder)
                  (.keys [(doto (HashMap.)
                            (.put "Key" (string-attribute "later")))])
                  (.consistentRead true)
                  .build)]
    (try
      (adapter/batch-get-items!
       nil "table" ["later"] (assoc no-wait-policy :max-attempts 2)
       (fn [_ _]
         (swap! calls inc)
         (batch-response {} {"table" attrs})))
      (is false "unprocessed keys should exhaust with a typed throttle")
      (catch clojure.lang.ExceptionInfo error
        (is (= "throttled" (:code (ex-data error))))
        (is (= true (:retryable (ex-data error))))))
    (is (= 2 @calls))))

(deftest nil-batch-response-and-duplicate-input-fail-closed-test
  (is (thrown? clojure.lang.ExceptionInfo
               (adapter/batch-get-items! nil "table" ["same" "same"]
                                         no-wait-policy (fn [_ _] nil))))
  (try
    (adapter/batch-get-items! nil "table" ["one"] no-wait-policy
                              (fn [_ _] nil))
    (is false "nil batch response should throw")
    (catch clojure.lang.ExceptionInfo error
      (is (= "internal-error" (:code (ex-data error)))))))

(deftest retry-preserves-cancellation-deadline-and-jitter-bounds-test
  (testing "cancelled requests do not call the dependency"
    (let [calls (atom 0)]
      (try
        (retry/invoke! :get-item
                       (assoc no-wait-policy :cancelled? (constantly true))
                       (fn [_] (swap! calls inc)))
        (is false "cancel should throw")
        (catch clojure.lang.ExceptionInfo error
          (is (= "cancelled" (:code (ex-data error))))))
      (is (zero? @calls))))

  (testing "cancellation that arrives during a dependency call wins afterward"
    (let [cancelled (atom false)]
      (try
        (retry/invoke! :get-item
                       (assoc no-wait-policy :cancelled? #(deref cancelled))
                       (fn [_] (reset! cancelled true) :late-success))
        (is false "late success should be cancelled")
        (catch clojure.lang.ExceptionInfo error
          (is (= "cancelled" (:code (ex-data error))))))))

  (testing "a retry that would cross the deadline is rejected before sleep"
    (let [time (atom 100)
          sleeps (atom [])]
      (try
        (retry/invoke!
         :get-item
         {:max-attempts 2 :base-delay-ms 10 :max-delay-ms 10
          :deadline-ms 105 :clock #(deref time) :random (constantly 1.0)
          :sleep! #(swap! sleeps conj %)}
         (fn [_] (throw (TimeoutException. "synthetic"))))
        (is false "deadline should throw")
        (catch clojure.lang.ExceptionInfo error
          (is (= "deadline-exceeded" (:code (ex-data error))))))
      (is (empty? @sleeps))))

  (testing "the SDK attempt timeout is clipped to the remaining request deadline"
    (let [captured (atom nil)]
      (adapter/get-item!
       nil "table" "missing"
       (assoc no-wait-policy :deadline-ms 105 :clock (constantly 100)
              :attempt-timeout-ms 3000)
       (fn [_ request]
         (reset! captured request)
         (get-response {})))
      (let [override (.orElseThrow (.overrideConfiguration @captured))]
        (is (= 5 (.toMillis (.orElseThrow (.apiCallAttemptTimeout override)))))
        (is (= 5 (.toMillis (.orElseThrow (.apiCallTimeout override))))))))

  (is (= 0 (retry/full-jitter-delay-ms
            (retry/policy (assoc no-wait-policy :base-delay-ms 10
                                 :max-delay-ms 40 :random (constantly 0.0))) 3)))
  (is (= 40 (retry/full-jitter-delay-ms
             (retry/policy (assoc no-wait-policy :base-delay-ms 10
                                  :max-delay-ms 40 :random (constantly 1.0))) 3))))

(deftest retry-policy-is-closed-and-overflow-safe-test
  (doseq [invalid [{:max-attempts 9}
                   {:base-delay-ms 1001}
                   {:max-delay-ms 1001}]]
    (is (thrown? clojure.lang.ExceptionInfo
                 (retry/policy (merge no-wait-policy invalid))))))
