(ns eacl-demo.datahike-dynamodb-real-aws-test
  "Opt-in disposable real-AWS qualification for the hardened read path."
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.datahike-dynamodb.adapter :as adapter]
            [eacl-demo.datahike-dynamodb.client :as read-only-client]
            [eacl-demo.datahike-dynamodb.konserve :as dynamodb]
            [konserve.impl.storage-layout :as storage])
  (:import [java.util HashMap]
           [software.amazon.awssdk.auth.credentials ProfileCredentialsProvider]
           [software.amazon.awssdk.core SdkBytes]
           [software.amazon.awssdk.core.client.config ClientOverrideConfiguration]
           [software.amazon.awssdk.core.retry RetryPolicy]
           [software.amazon.awssdk.http.urlconnection UrlConnectionHttpClient]
           [software.amazon.awssdk.regions Region]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]
           [software.amazon.awssdk.services.dynamodb.model
            AttributeValue BatchGetItemResponse DynamoDbException GetItemRequest
            KeysAndAttributes PutItemRequest]))

(def policy
  {:max-attempts 4 :base-delay-ms 5 :max-delay-ms 25
   :random (constantly 0.0) :sleep! #(Thread/sleep ^long %)})

(defn- property [name]
  (System/getProperty name))

(defn- client []
  (let [override (-> (ClientOverrideConfiguration/builder)
                     (.retryPolicy (RetryPolicy/none))
                     .build)]
    (-> (DynamoDbClient/builder)
        (.region (Region/of (or (property "eacl.demo.aws.region") "us-east-1")))
        (.credentialsProvider
         (ProfileCredentialsProvider/create
          (or (property "eacl.demo.aws.profile") "petrus-prod")))
        (.httpClientBuilder (UrlConnectionHttpClient/builder))
        (.overrideConfiguration override)
        .build)))

(defn- string-attribute [value]
  (-> (AttributeValue/builder) (.s value) .build))

(defn- bytes-attribute [value]
  (-> (AttributeValue/builder)
      (.b (SdkBytes/fromByteArray (.getBytes value "UTF-8")))
      .build))

(defn- key-map [key]
  (doto (HashMap.) (.put "Key" (string-attribute key))))

(defn- item [key value]
  (doto (key-map key)
    (.put "Header" (bytes-attribute "header"))
    (.put "Meta" (bytes-attribute "meta"))
    (.put "Value" (bytes-attribute value))))

(defn- put-item! [^DynamoDbClient client table value]
  (.putItem client
            (-> (PutItemRequest/builder)
                (.tableName table)
                (.item value)
                .build)))

(defn- raw-get! [^DynamoDbClient client table key]
  (.getItem client
            (-> (GetItemRequest/builder)
                (.tableName table)
                (.key (key-map key))
                (.consistentRead true)
                .build)))

(defn- inject-one-unprocessed
  [^DynamoDbClient client table calls]
  (fn [_ request]
    (let [response (.batchGetItem client request)]
      (if (= 1 (swap! calls inc))
        (let [items (vec (get (.responses response) table []))
              deferred (first (filter #(= "second" (some-> (get % "Key") .s))
                                      items))
              delivered (vec (remove #(identical? deferred %) items))
              pending (-> (KeysAndAttributes/builder)
                          (.keys [(key-map "second")])
                          (.consistentRead true)
                          .build)]
          (-> (BatchGetItemResponse/builder)
              (.responses {table delivered})
              (.unprocessedKeys {table pending})
              .build))
        response))))

(deftest disposable-real-aws-publication-failure-and-concurrency-test
  (if-let [table (when (not= "true" (property "eacl.demo.dynamodb.real.throttle"))
                   (property "eacl.demo.dynamodb.real.table"))]
    (with-open [client (client)]
      (let [read-client (read-only-client/read-only-client client)]
      (put-item! client table (item "published" "value"))
      (put-item! client table (item "second" "second-value"))
      (put-item! client table
                 (doto (key-map "corrupt")
                   (.put "Header" (bytes-attribute "header"))))

      (testing "publication-critical GetItem is immediately strongly consistent"
        (is (= "published"
               (some-> (adapter/get-item! read-client table "published" policy)
                       (get "Key") .s))))

      (testing "only a successful empty response is absence"
        (is (nil? (adapter/get-item! read-client table "genuinely-absent" policy))))

      (testing "physical corruption is not converted to absence"
        (try
          (adapter/get-item! read-client table "corrupt" policy)
          (is false "corrupt item should throw")
          (catch clojure.lang.ExceptionInfo error
            (is (= "storage-corrupt" (:code (ex-data error)))))))

      (testing "a controlled partial AWS batch retries every unprocessed key"
        (let [calls (atom 0)
              result (adapter/batch-get-items!
                      read-client table ["published" "second" "genuinely-absent"]
                      policy (inject-one-unprocessed read-client table calls))]
          (is (= #{"published" "second"} (set (keys result))))
          (is (= 2 @calls))))

      (testing "the read-only Konserve backing uses the same real table"
        (let [backing (dynamodb/->ReadOnlyStore read-client table policy)
              blob (storage/-create-blob backing "published" {:sync? true})]
          (is (= "value"
                 (String. ^bytes (storage/-read-value blob 0 {:sync? true})
                          "UTF-8")))))

      (testing "cancellation and deadline reject before an AWS dependency call"
        (doseq [[options code]
                [[{:cancelled? (constantly true)} "cancelled"]
                 [{:deadline-ms 0 :clock (constantly 0)} "deadline-exceeded"]]]
          (try
            (adapter/get-item! read-client table "published" (merge policy options))
            (is false (str code " should throw"))
            (catch clojure.lang.ExceptionInfo error
              (is (= code (:code (ex-data error))))))))

      (testing "concurrent strongly consistent reads remain equal"
        (let [workers
              (doall
               (for [_ (range 24)]
                 (future
                   (dotimes [_ 20]
                     (when-not (= "published"
                                  (some-> (adapter/get-item!
                                           read-client table "published" policy)
                                          (get "Key") .s))
                       (throw (ex-info "concurrent read mismatch" {}))))
                   :ok)))]
          (is (= (vec (repeat 24 :ok)) (mapv deref workers)))))))
    (is true "real-AWS qualification skipped without an explicit table")))

(deftest disposable-real-aws-throttle-test
  (if (and (= "true" (property "eacl.demo.dynamodb.real.throttle"))
           (property "eacl.demo.dynamodb.real.table"))
    (let [table (property "eacl.demo.dynamodb.real.table")]
      (with-open [client (client)]
        ;; A 96 KiB value consumes 24 RRUs per strong read. The dedicated table
        ;; is set to 1 RRU/s before this opt-in test, so this bounded workload
        ;; should produce genuine MaxOnDemandThroughputExceeded responses.
        (put-item! client table (item "throttle-probe" (apply str (repeat 98304 "x"))))
        (let [read-client (read-only-client/read-only-client client)
              results
              (->> (range 32)
                   (mapv
                    (fn [_]
                      (future
                        (loop [remaining 2 successes 0 throttles 0]
                          (if (zero? remaining)
                            {:successes successes :throttles throttles}
                            (let [outcome
                                  (try
                                    (raw-get! read-client table "throttle-probe")
                                    :success
                                    (catch DynamoDbException error
                                      (let [code (some-> error .awsErrorDetails
                                                         .errorCode)]
                                        (if (#{"ThrottlingException"
                                               "ProvisionedThroughputExceededException"}
                                             code)
                                          :throttle
                                          (throw error)))))]
                              (recur (dec remaining)
                                     (+ successes (if (= :success outcome) 1 0))
                                     (+ throttles (if (= :throttle outcome) 1 0)))))))))
                   (mapv deref))
              totals (apply merge-with + results)]
          (is (pos? (:successes totals 0)))
          (is (pos? (:throttles totals 0))))))
    (is true "real-AWS throttle qualification skipped without explicit opt-in")))
