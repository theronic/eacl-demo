(ns eacl-demo.contracts.observability
  "Closed, redacted CloudWatch Embedded Metric Format telemetry for JVM Lambdas."
  (:require [clojure.data.json :as json])
  (:import [java.net SocketTimeoutException]
           [java.util.concurrent TimeoutException]))

(def ^:private metric-namespace "EaclDemo/Runtime")
(def ^:private profile-pattern #"[a-z0-9]+(?:-[a-z0-9]+)*")
(def ^:private function-pattern #"[A-Za-z0-9-_]{1,64}")
(def ^:private deployment-pattern #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}")
(def ^:private request-id-pattern #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}")
(def ^:private operations
  #{"health" "bootstrap" "list-subjects" "get-object"
    "list-relationships" "reverse-relationships" "authorize"
    "get-schema" "get-cache-info" "count-objects"})
(def ^:private stable-error-codes
  #{"validation-error" "request-too-large" "method-not-allowed"
    "route-not-found" "unsupported-media-type" "cursor-invalid"
    "cursor-expired" "cursor-scope-mismatch" "unsupported-consistency"
    "cancelled" "deadline-exceeded" "overloaded" "throttled"
    "dependency-unavailable" "storage-missing" "storage-corrupt"
    "identity-mismatch" "response-too-large" "internal-error"})
(def ^:private storage-error-codes
  #{"throttled" "dependency-unavailable" "storage-missing" "storage-corrupt"})
(def ^:private fault-codes
  #{"deadline-exceeded" "overloaded" "throttled" "dependency-unavailable"
    "storage-missing" "storage-corrupt" "response-too-large" "internal-error"})

(def ^:dynamic *clock-ms* #(System/currentTimeMillis))
(def ^:dynamic *nano-time* #(System/nanoTime))
(def ^:dynamic *emit-line!*
  (fn [line]
    (locking *out*
      (println line)
      (flush))))

(declare alarm-record attempt-telemetry! duration-ms emit-record! metric-envelope
         observation-from-response operation-from-event safe-value)

(defn runtime-context
  "Extracts only bounded non-secret telemetry identity from a Lambda environment."
  [profile-id environment]
  (let [environment (if (map? environment) environment {})]
    {:profile-id (safe-value profile-id profile-pattern "invalid")
     :function-name (safe-value (get environment "AWS_LAMBDA_FUNCTION_NAME")
                                function-pattern "local")
     :deployment-id (safe-value (get environment "EACL_DEPLOYMENT_ID")
                                deployment-pattern "invalid")}))

(defn initialize-with-telemetry!
  "Runs one cold initialization, emits a bounded lifecycle record, and rethrows
  the original failure. Restore is explicitly zero for the current non-SnapStart
  JVM profiles; a future restore hook must emit the restore lifecycle itself."
  [context initialize!]
  (let [started (*nano-time*)]
    (try
      (let [result (initialize!)]
        (attempt-telemetry!
         #(emit-record!
           (merge
            (metric-envelope context
                             [{"Name" "Initialization" "Unit" "Count"}
                              {"Name" "Restore" "Unit" "Count"}
                              {"Name" "Errors" "Unit" "Count"}
                              {"Name" "OOM" "Unit" "Count"}])
            {"eventType" "runtime-initialization"
             "lifecycle" "cold"
             "outcome" "success"
             "errorCode" nil
             "durationMs" (duration-ms started)
             "Initialization" 1
             "Restore" 0
             "Errors" 0
             "OOM" 0})))
        result)
      (catch Throwable error
        (attempt-telemetry!
         #(let [oom? (instance? OutOfMemoryError error)]
            (emit-record!
             (merge
              (metric-envelope context
                               [{"Name" "Initialization" "Unit" "Count"}
                                {"Name" "Restore" "Unit" "Count"}
                                {"Name" "Errors" "Unit" "Count"}
                                {"Name" "OOM" "Unit" "Count"}])
              {"eventType" "runtime-initialization"
               "lifecycle" "cold"
               "outcome" "failure"
               "errorCode" "internal-error"
               "durationMs" (duration-ms started)
               "Initialization" 1
               "Restore" 0
               "Errors" 1
               "OOM" (if oom? 1 0)}))
            (emit-record! (alarm-record context "initialization"))))
        (throw error)))))

(defn observe-response!
  "Emits one closed request record from an internally generated Function URL
  response. Response messages, inputs, paths, credentials, exception text, and
  storage identifiers are never copied into the log."
  [context response started-ns]
  (attempt-telemetry!
   #(let [{:keys [ok? operation request-id error-code status-code]}
          (observation-from-response response)
          error? (not ok?)
          throttle? (= "throttled" error-code)
          timeout? (= "deadline-exceeded" error-code)
          storage? (contains? storage-error-codes error-code)
          elapsed-ms (duration-ms started-ns)]
      (emit-record!
       (merge
        (metric-envelope context
                         [{"Name" "Requests" "Unit" "Count"}
                          {"Name" "Errors" "Unit" "Count"}
                          {"Name" "Duration" "Unit" "Milliseconds"}
                          {"Name" "Throttles" "Unit" "Count"}
                          {"Name" "Timeouts" "Unit" "Count"}
                          {"Name" "OOM" "Unit" "Count"}
                          {"Name" "Storage" "Unit" "Count"}])
        {"eventType" "runtime-request"
         "outcome" (if error? "failure" "success")
         "requestId" request-id
         "operation" operation
         "errorCode" error-code
         "statusCode" status-code
         "fault" (if (contains? fault-codes error-code) 1 0)
         "durationMs" elapsed-ms
         "Requests" 1
         "Errors" (if error? 1 0)
         "Duration" elapsed-ms
         "Throttles" (if throttle? 1 0)
         "Timeouts" (if timeout? 1 0)
         "OOM" 0
         "Storage" (if storage? 1 0)}))
      (when (and error? (= "health" operation))
        (emit-record! (alarm-record context "health"))))))

(defn observe-exception!
  "Emits a safe request record for an exception that escaped the response
  boundary. Only a closed timeout/OOM/internal class is retained."
  [context event started-ns error]
  (attempt-telemetry!
   #(let [oom? (instance? OutOfMemoryError error)
          timeout? (or (instance? TimeoutException error)
                       (instance? SocketTimeoutException error))
          error-code (if timeout? "deadline-exceeded" "internal-error")
          operation (operation-from-event context event)
          elapsed-ms (duration-ms started-ns)]
      (emit-record!
       (merge
        (metric-envelope context
                         [{"Name" "Requests" "Unit" "Count"}
                          {"Name" "Errors" "Unit" "Count"}
                          {"Name" "Duration" "Unit" "Milliseconds"}
                          {"Name" "Throttles" "Unit" "Count"}
                          {"Name" "Timeouts" "Unit" "Count"}
                          {"Name" "OOM" "Unit" "Count"}
                          {"Name" "Storage" "Unit" "Count"}])
        {"eventType" "runtime-request"
         "outcome" "failure"
         "requestId" (safe-value (get-in event [:requestContext :requestId])
                                 request-id-pattern "invalid")
         "operation" operation
         "errorCode" error-code
         "statusCode" 500
         "fault" 1
         "durationMs" elapsed-ms
         "Requests" 1
         "Errors" 1
         "Duration" elapsed-ms
         "Throttles" 0
         "Timeouts" (if timeout? 1 0)
         "OOM" (if oom? 1 0)
         "Storage" 0}))
      (when (= "health" operation)
        (emit-record! (alarm-record context "health"))))))

(defn- observation-from-response
  [response]
  (try
    (let [body (json/read-str (if (string? (:body response))
                                (:body response) "")
                              :key-fn keyword)
          ok? (true? (:ok body))
          operation (safe-value (get-in body [:meta :operation])
                                operations "unknown")
          request-id (safe-value (get-in body [:meta :requestId])
                                 request-id-pattern "invalid")
          error-code (when-not ok?
                       (safe-value (get-in body [:error :code])
                                   stable-error-codes "internal-error"))
          status (:statusCode response)]
      {:ok? ok?
       :operation operation
       :request-id request-id
       :error-code error-code
       :status-code (if (and (int? status) (<= 100 status 599)) status 500)})
    (catch Throwable _
      {:ok? false :operation "unknown" :request-id "invalid"
       :error-code "internal-error" :status-code 500})))

(defn- operation-from-event
  [{:keys [profile-id]} event]
  (let [path (:rawPath event)
        prefix (str "/api/v1/" profile-id "/")]
    (if (and (string? path) (.startsWith ^String path prefix))
      (safe-value (subs path (count prefix)) operations "unknown")
      "unknown")))

(defn- metric-envelope
  [{:keys [profile-id function-name deployment-id]} metrics]
  {"_aws" {"Timestamp" (*clock-ms*)
           "CloudWatchMetrics"
           [{"Namespace" metric-namespace
             "Dimensions" [["ProfileId" "FunctionName"]]
             "Metrics" metrics}]}
   "schema" "eacl-demo.runtime-telemetry.v1"
   "ProfileId" profile-id
   "FunctionName" function-name
   "deploymentId" deployment-id})

(defn- alarm-record
  [{:keys [profile-id function-name deployment-id] :as context} alarm-class]
  (merge
   (metric-envelope context [{"Name" "Errors" "Unit" "Count"}])
   {"_aws" {"Timestamp" (*clock-ms*)
            "CloudWatchMetrics"
            [{"Namespace" metric-namespace
              "Dimensions" [["ProfileId" "FunctionName" "AlarmClass"]]
              "Metrics" [{"Name" "Errors" "Unit" "Count"}]}]}
    "eventType" "runtime-alarm-signal"
    "outcome" "failure"
    "ProfileId" profile-id
    "FunctionName" function-name
    "deploymentId" deployment-id
    "AlarmClass" alarm-class
    "Errors" 1}))

(defn- duration-ms
  [started-ns]
  (let [elapsed (max 0 (- (long (*nano-time*)) (long started-ns)))]
    (/ (double (Math/round (* (/ (double elapsed) 1000000.0) 1000.0)))
       1000.0)))

(defn- safe-value
  [value accepted fallback]
  (if (and (string? value)
           (if (set? accepted)
             (contains? accepted value)
             (boolean (re-matches accepted value))))
    value
    fallback))

(defn- attempt-telemetry!
  [emit!]
  (try
    (emit!)
    (catch Throwable _ nil)))

(defn- emit-record!
  [record]
  (try
    (let [line (json/write-str record)]
      (when (<= (count (.getBytes ^String line "UTF-8")) 8192)
        (*emit-line!* line)))
    (catch Throwable _ nil)))
