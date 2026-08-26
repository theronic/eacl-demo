(ns eacl-demo.contracts-observability-test
  (:require [clojure.data.json :as json]
            [clojure.test :refer [deftest is testing]]
            [eacl-demo.contracts.observability :as observability]))

(def context
  (observability/runtime-context
   "datahike-dynamodb"
   {"AWS_LAMBDA_FUNCTION_NAME" "eacl-demo-datahike-dynamodb-live"
    "EACL_DEPLOYMENT_ID" "deploy-7"}))

(defn capture
  [run]
  (let [lines (atom [])]
    (binding [observability/*clock-ms* (constantly 1787702400000)
              observability/*nano-time* (constantly 2500000000)
              observability/*emit-line!* #(swap! lines conj %)]
      (run))
    (mapv #(json/read-str % :key-fn keyword) @lines)))

(deftest runtime-context-retains-only-bounded-non-secret-identity-test
  (is (= {:profile-id "datahike-dynamodb"
          :function-name "eacl-demo-datahike-dynamodb-live"
          :deployment-id "deploy-7"}
         context))
  (is (= {:profile-id "invalid" :function-name "local"
          :deployment-id "invalid"}
         (observability/runtime-context
          "BAD PROFILE"
          {"AWS_LAMBDA_FUNCTION_NAME" "bad/function"
           "EACL_DEPLOYMENT_ID" "secret value"
           "AWS_SECRET_ACCESS_KEY" "must-never-appear"}))))

(deftest successful-request-emits-closed-emf-with-no-input-or-message-test
  (let [response {:statusCode 200
                  :body (json/write-str
                         {:meta {:revision "fixture:1"
                                 :requestId "request-1"}
                          :data {:secret "must-never-appear"}})}
        [record] (capture #(observability/observe-response!
                           context
                           {:rawPath "/api/v1/datahike-dynamodb/authorize"}
                           response 2000000000))]
    (is (= "eacl-demo.runtime-telemetry.v1" (:schema record)))
    (is (= "EaclDemo/Runtime"
           (get-in record [:_aws :CloudWatchMetrics 0 :Namespace])))
    (is (= [["ProfileId" "FunctionName"]]
           (get-in record [:_aws :CloudWatchMetrics 0 :Dimensions])))
    (is (= "success" (:outcome record)))
    (is (= "authorize" (:operation record)))
    (is (= "request-1" (:requestId record)))
    (is (= 500.0 (:Duration record)))
    (is (= 0 (:Errors record)))
    (is (not (.contains (json/write-str record) "must-never-appear")))))

(deftest compact-authorization-keeps-operation-telemetry-test
  (let [response {:statusCode 200
                  :body (json/write-str
                         {:meta {:revision "fixture:42"
                                 :requestId "request-compact"
                                 :elapsedMs 0.8
                                 :cacheStatus "hit"}
                          :data {:allowed true}})}
        [record] (capture #(observability/observe-response!
                           context
                           {:rawPath "/api/v1/datahike-dynamodb/authorize"}
                           response 2000000000))]
    (is (= "authorize" (:operation record)))
    (is (= "request-compact" (:requestId record)))
    (is (= "success" (:outcome record)))))

(deftest typed-storage-timeout-and-health-failure-metrics-are-distinct-test
  (let [response {:statusCode 504
                  :body (json/write-str
                         {:meta {:revision "fixture:1"
                                 :requestId "request-2"}
                          :error {:code "deadline-exceeded"
                                  :message "credential=must-never-appear"}})}
        [request alarm] (capture #(observability/observe-response!
                                  context
                                  {:rawPath "/api/v1/datahike-dynamodb/health"}
                                  response 2000000000))]
    (is (= 1 (:Errors request)))
    (is (= 1 (:Timeouts request)))
    (is (= 0 (:Throttles request)))
    (is (= 0 (:Storage request)))
    (is (= "deadline-exceeded" (:errorCode request)))
    (is (= "health" (:AlarmClass alarm)))
    (is (= [["ProfileId" "FunctionName" "AlarmClass"]]
           (get-in alarm [:_aws :CloudWatchMetrics 0 :Dimensions])))
    (is (not (.contains (json/write-str [request alarm])
                        "must-never-appear")))))

(deftest initialization-and-unhandled-exceptions-remain-redacted-test
  (testing "successful cold initialization records non-SnapStart restore as zero"
    (let [[record] (capture #(is (= :ready
                                    (observability/initialize-with-telemetry!
                                     context (constantly :ready)))))]
      (is (= "cold" (:lifecycle record)))
      (is (= 1 (:Initialization record)))
      (is (= 0 (:Restore record)))
      (is (= 0 (:Errors record)))))
  (testing "initialization failure rethrows the exact error and emits an alarm signal"
    (let [problem (ex-info "password=must-never-appear" {:secret "hidden"})
          records (capture #(is (identical?
                                 problem
                                 (try
                                   (observability/initialize-with-telemetry!
                                    context (fn [] (throw problem)))
                                   (catch Throwable error error)))))]
      (is (= 2 (count records)))
      (is (= "failure" (:outcome (first records))))
      (is (= "initialization" (:AlarmClass (second records))))
      (is (not (.contains (json/write-str records)
                          "must-never-appear")))))
  (testing "OOM and raw event data become only closed metrics"
    (let [[record] (capture #(observability/observe-exception!
                             context
                             {:rawPath "/api/v1/datahike-dynamodb/health"
                              :requestContext {:requestId "request-3"}
                              :body "must-never-appear"}
                             2000000000
                             (OutOfMemoryError. "must-never-appear")))]
      (is (= "internal-error" (:errorCode record)))
      (is (= 1 (:OOM record)))
      (is (not (.contains (json/write-str record)
                          "must-never-appear"))))))

(deftest telemetry-failure-never-changes-runtime-outcome-test
  (binding [observability/*emit-line!*
            (fn [_] (throw (OutOfMemoryError. "telemetry failed")))]
    (is (= :ready
           (observability/initialize-with-telemetry!
            context (constantly :ready))))
    (is (nil? (observability/observe-response!
               context
               {:rawPath "/api/v1/datahike-dynamodb/health"}
               {:statusCode 200
                :body (json/write-str
                       {:data {:ready true}
                        :meta {:revision "fixture:1"
                               :requestId "request-4"}})}
               (System/nanoTime))))
    (is (nil? (observability/observe-exception!
               context nil (System/nanoTime)
               (ex-info "request failed" {}))))))
