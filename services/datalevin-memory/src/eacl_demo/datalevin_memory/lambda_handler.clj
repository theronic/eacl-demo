(ns eacl-demo.datalevin-memory.lambda-handler
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [eacl-demo.contracts.build-identity :as build-identity]
            [eacl-demo.contracts.cache-metrics :as cache-metrics]
            [eacl-demo.contracts.function-url :as function-url]
            [eacl-demo.contracts.observability :as observability]
            [eacl-demo.datalevin-memory.boundary :as boundary]
            [eacl-demo.datalevin-memory.operations :as operations]
            [eacl-demo.datalevin-memory.profile :as profile]
            [eacl-demo.datalevin-memory.reader :as reader]
            [eacl.datalevin.core :as datalevin-eacl])
  (:import [com.amazonaws.services.lambda.runtime Context]
           [java.io InputStream OutputStream]
           [java.nio.file Path Paths]))

(declare initialize invoke-event!)

(defonce ^:private runtime
  (delay
    (let [environment (into {} (System/getenv))]
      (observability/initialize-with-telemetry!
       (observability/runtime-context "datalevin-memory" environment)
       #(initialize environment)))))

(defn initialize-runtime!
  "Realize the embedded reader during Lambda initialization so a published
  SnapStart version captures both the ready process and its LMDB files."
  []
  @runtime
  nil)

(defn- positive-int
  [value]
  (when (and (string? value) (re-matches #"[1-9][0-9]{0,8}" value))
    (try (Integer/parseInt value) (catch NumberFormatException _ nil))))

(defn- absolute-normal-path
  [value]
  (when (and (string? value) (not (.contains ^String value "\u0000")))
    (try
      (let [path (.normalize (Paths/get value (make-array String 0)))]
        (when (and (.isAbsolute path) (= value (str path))) path))
      (catch Throwable _ nil))))

(defn parse-environment
  [environment]
  (let [baked-eacl-sha (build-identity/eacl-sha)
        declared-eacl-sha (get environment "EACL_CORE_SHA")
        execution (get environment "EACL_RUNTIME_EXECUTION" "lambda")
        memory-key (if (= "ec2" execution)
                     "EACL_RUNTIME_MEMORY_MIB"
                     "AWS_LAMBDA_FUNCTION_MEMORY_SIZE")
        identity {:profileId "datalevin-memory"
                  :demoSha (get environment "EACL_DEMO_SHA")
                  :eaclSha baked-eacl-sha
                  :artifactSha256 (get environment "EACL_ARTIFACT_SHA256")
                  :deploymentId (get environment "EACL_DEPLOYMENT_ID")
                  :dataManifestSha256 profile/data-manifest-sha256}
        cursor-key (get environment "EACL_CURSOR_KEY")
        database-directory (absolute-normal-path
                            (get environment "EACL_DATALEVIN_DIRECTORY"))
        memory-mib (positive-int (get environment memory-key))
        maximum-concurrency (or (positive-int
                                 (get environment "EACL_MAXIMUM_CONCURRENCY"))
                                (when (= "lambda" execution) 1))]
    (when-not (and (re-matches #"[0-9a-f]{40}" (or (:demoSha identity) ""))
                   (or (nil? declared-eacl-sha)
                       (= baked-eacl-sha declared-eacl-sha))
                   (re-matches #"[0-9a-f]{64}"
                               (or (:artifactSha256 identity) ""))
                   (re-matches #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}"
                               (or (:deploymentId identity) ""))
                   (string? cursor-key)
                   (<= 32 (alength (.getBytes ^String cursor-key "UTF-8")))
                   (instance? Path database-directory)
                   (pos-int? memory-mib)
                   (pos-int? maximum-concurrency)
                   (contains? #{"lambda" "ec2"} execution))
      (throw (ex-info "Lambda environment is incomplete or invalid."
                      {:type :eacl-demo/invalid-environment})))
    {:identity identity
     :cursor-key cursor-key
     :database-directory database-directory
     :memory-mib memory-mib
     :maximum-concurrency maximum-concurrency
     :execution execution}))

(defn initialize
  [environment]
  (let [{:keys [identity cursor-key database-directory memory-mib
                maximum-concurrency execution]}
        (parse-environment environment)
        opened (reader/open-reader! {:security-key cursor-key
                                     :database-directory database-directory})]
    (try
      (let [initial ((:capture-snapshot opened))]
        (try
          (let [descriptor (profile/descriptor
                            {:identity identity :basis (:basis initial)
                             :memory-mib memory-mib
                             :admission-concurrency maximum-concurrency
                             :execution execution})
                operation-metrics (cache-metrics/create-operation-metrics)
                handlers (operations/create-handlers
                          {:descriptor descriptor
                           :cursor-key cursor-key
                           :cache-stats #(datalevin-eacl/cache-stats
                                          (:client opened))
                           :operation-metrics operation-metrics})]
            {:reader opened
             :descriptor descriptor
             :operation-metrics operation-metrics
             :boundary (boundary/create-boundary
                        {:descriptor descriptor
                         :capture-snapshot (:capture-snapshot opened)
                         :handlers handlers
                         :maximum-concurrency maximum-concurrency})})
          (finally ((:release! initial)))))
      (catch Throwable error
        (reader/close-reader! opened)
        (throw error)))))

(defn handle-event
  [runtime-value event remaining-time-ms]
  (let [started-nanos (System/nanoTime)
        normalized (function-url/normalize-event event)
        descriptor (:descriptor runtime-value)]
    (if-not (:ok? normalized)
      (function-url/create-response
       (boundary/failure-envelope
        {:request-id (function-url/event-request-id event)} (:identity descriptor) nil
        (:code normalized)))
      (let [remaining (if (and (integer? remaining-time-ms)
                               (pos? remaining-time-ms))
                        remaining-time-ms 30000)
            request (assoc (:request normalized)
                           :deadline-ms (+ (System/currentTimeMillis)
                                           (max 1 (- remaining 100)))
                           :cancelled? (constantly false))
            envelope (boundary/invoke! (:boundary runtime-value) request)
            response (function-url/create-response envelope)]
        (cache-metrics/record-response!
         (:operation-metrics runtime-value) (subs (:path request) 1)
         started-nanos response envelope)
        response))))

(defn invoke-event!
  "Invoke one Function URL-shaped event against the process runtime. Lambda
  and the EC2 HTTP adapter share this exact observable boundary."
  [event remaining-time-ms]
  (let [telemetry-context (observability/runtime-context
                           "datalevin-memory" (into {} (System/getenv)))
        started (System/nanoTime)]
    (try
      (let [response (handle-event @runtime event remaining-time-ms)]
        (observability/observe-response! telemetry-context event response started)
        response)
      (catch Throwable error
        (observability/observe-exception! telemetry-context event started error)
        (function-url/internal-error-response
         event (:deployment-id telemetry-context))))))

(defn handle-request-stream
  [^InputStream input ^OutputStream output ^Context context]
  (let [writer (io/writer output :encoding "UTF-8")
        telemetry-context (observability/runtime-context
                           "datalevin-memory" (into {} (System/getenv)))
        started (System/nanoTime)
        event* (atom nil)]
    (try
      (let [event (json/read (io/reader input :encoding "UTF-8")
                             :key-fn keyword)
            _ (reset! event* event)
            response (invoke-event! event
                                    (when context
                                      (.getRemainingTimeInMillis context)))]
        (json/write response writer))
      (catch Throwable error
        (observability/observe-exception! telemetry-context @event* started error)
        (json/write (function-url/internal-error-response
                     @event* (:deployment-id telemetry-context)) writer))
      (finally (.flush writer)))))
