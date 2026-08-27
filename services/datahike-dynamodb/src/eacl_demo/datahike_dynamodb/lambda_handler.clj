(ns eacl-demo.datahike-dynamodb.lambda-handler
  "AWS Lambda Function URL entrypoint for a qualified immutable DynamoDB generation."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [eacl-demo.contracts.function-url :as function-url]
            [eacl-demo.contracts.observability :as observability]
            [eacl-demo.datahike-dynamodb.boundary :as boundary]
            [eacl-demo.datahike-dynamodb.operations :as operations]
            [eacl-demo.datahike-dynamodb.profile :as profile]
            [eacl-demo.datahike-dynamodb.reader :as reader])
  (:import [com.amazonaws.services.lambda.runtime Context]
           [java.io InputStream OutputStream]
           [java.util UUID]))

(def ^:private pinned-eacl-sha
  "4d781c4d9437e381d3dcb7f43db8c5fbcd1ffb85")
(def ^:private sha1-pattern #"[0-9a-f]{40}")
(def ^:private sha256-pattern #"[0-9a-f]{64}")
(def ^:private deployment-pattern #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}")
(def ^:private region-pattern #"[a-z]{2}(?:-[a-z0-9]+)+-[0-9]")
(def ^:private table-pattern #"[A-Za-z0-9_.-]{3,255}")

(declare handle-event initialize parse-bounded-int parse-environment parse-nonnegative-int
         parse-positive-int)

(defonce ^:private runtime
  (delay
    (let [environment (into {} (System/getenv))]
      (observability/initialize-with-telemetry!
       (observability/runtime-context "datahike-dynamodb" environment)
       #(initialize environment)))))

(defn initialize-runtime!
  "Realizes the immutable reader during published-version initialization so
  SnapStart captures a ready Datahike database and EACL runtime at 1024 MB."
  []
  @runtime
  nil)

(defn initialize
  "Builds one immutable reader and boundary before the published-version
  SnapStart checkpoint. Restored DynamoDB reads are qualified before promotion."
  ([environment]
   (initialize environment reader/open-reader!))
  ([environment open-reader!]
   (let [{:keys [reader-config identity memory-mib]}
         (parse-environment environment)
         opened (open-reader! reader-config)]
     (try
       (let [initial ((:capture-snapshot opened))]
         (try
           (let [descriptor
                 (profile/descriptor
                  {:identity identity
                   :basis (:basis initial)
                   :operations profile/closed-operations
                   :memory-mib memory-mib})
                 handlers (operations/create-handlers
                           {:descriptor descriptor
                            :cursor-key (:security-key reader-config)})]
             {:reader opened
              :descriptor descriptor
              :boundary (boundary/create-boundary
                         {:descriptor descriptor
                          :capture-snapshot (:capture-snapshot opened)
                          :handlers handlers
                          :maximum-concurrency
                          (:maximum-concurrency reader-config)})})
           (finally
             ((:release! initial)))))
       (catch Throwable error
         (reader/close-reader! opened)
         (throw error))))))

(defn handle-event
  [runtime event remaining-time-ms]
  (let [normalized (function-url/normalize-event event)
        descriptor (:descriptor runtime)]
    (if-not (:ok? normalized)
      (function-url/create-response
       (boundary/failure-envelope
        {:request-id (function-url/event-request-id event)}
        (:identity descriptor) nil (:code normalized)))
      (let [request (:request normalized)
            remaining (if (and (integer? remaining-time-ms)
                               (pos? remaining-time-ms))
                        remaining-time-ms
                        30000)
            deadline (+ (System/currentTimeMillis) (max 1 (- remaining 100)))
            envelope (boundary/invoke!
                      (:boundary runtime)
                      (assoc request
                             :deadline-ms deadline
                             :cancelled? (constantly false)))]
        (function-url/create-response envelope)))))

(defn handle-request-stream
  [^InputStream input ^OutputStream output ^Context context]
  (let [writer (io/writer output :encoding "UTF-8")
        environment (into {} (System/getenv))
        telemetry-context (observability/runtime-context "datahike-dynamodb"
                                                         environment)
        started (System/nanoTime)
        event* (atom nil)]
    (try
      (let [event (json/read (io/reader input :encoding "UTF-8")
                             :key-fn keyword)
            _ (reset! event* event)
            response (handle-event @runtime event
                                   (when context
                                     (.getRemainingTimeInMillis context)))]
        (observability/observe-response! telemetry-context event response started)
        (json/write response writer))
      (catch Throwable error
        (observability/observe-exception! telemetry-context @event* started error)
        (json/write (function-url/internal-error-response
                     @event* (:deployment-id telemetry-context)) writer))
      (finally
        (.flush writer)))))

(defn parse-environment
  [environment]
  (when-not (map? environment)
    (throw (ex-info "Lambda environment is invalid."
                    {:type :eacl-demo/invalid-environment})))
  (let [required ["AWS_REGION" "EACL_DATAHIKE_TABLE"
                  "EACL_DATAHIKE_STORE_ID" "EACL_STORE_CACHE_SIZE"
                  "EACL_SEARCH_CACHE_SIZE" "EACL_MAXIMUM_CONCURRENCY"
                  "EACL_MAX_ATTEMPTS" "EACL_BASE_DELAY_MS"
                  "EACL_MAX_DELAY_MS" "EACL_ATTEMPT_TIMEOUT_MS"
                  "EACL_CONNECT_TIMEOUT_MS"
                  "EACL_CURSOR_KEY" "EACL_DEMO_SHA" "EACL_CORE_SHA"
                  "EACL_ARTIFACT_SHA256" "EACL_DEPLOYMENT_ID"
                  "AWS_LAMBDA_FUNCTION_MEMORY_SIZE"]
        missing (filter #(not (string? (get environment %))) required)
        concurrency (parse-positive-int
                     (get environment "EACL_MAXIMUM_CONCURRENCY"))
        store-cache-size (parse-positive-int
                          (get environment "EACL_STORE_CACHE_SIZE"))
        search-cache-size (parse-nonnegative-int
                           (get environment "EACL_SEARCH_CACHE_SIZE"))
        max-attempts (parse-bounded-int
                      (get environment "EACL_MAX_ATTEMPTS") 1 8)
        base-delay-ms (parse-bounded-int
                       (get environment "EACL_BASE_DELAY_MS") 1 1000)
        max-delay-ms (parse-bounded-int
                      (get environment "EACL_MAX_DELAY_MS") 1 1000)
        attempt-timeout-ms (parse-bounded-int
                            (get environment "EACL_ATTEMPT_TIMEOUT_MS") 50 5000)
        connect-timeout-ms (parse-bounded-int
                            (get environment "EACL_CONNECT_TIMEOUT_MS") 50 5000)
        memory-mib (parse-positive-int
                    (get environment "AWS_LAMBDA_FUNCTION_MEMORY_SIZE"))
        store-id (try
                   (UUID/fromString
                    (get environment "EACL_DATAHIKE_STORE_ID" ""))
                   (catch IllegalArgumentException _ nil))
        identity {:profileId "datahike-dynamodb"
                  :demoSha (get environment "EACL_DEMO_SHA")
                  :eaclSha (get environment "EACL_CORE_SHA")
                  :artifactSha256 (get environment "EACL_ARTIFACT_SHA256")
                  :deploymentId (get environment "EACL_DEPLOYMENT_ID")
                  :dataManifestSha256 profile/data-manifest-sha256}
        region (get environment "AWS_REGION")
        table (get environment "EACL_DATAHIKE_TABLE")
        cursor-key (get environment "EACL_CURSOR_KEY")]
    (when (or (seq missing)
              (nil? concurrency) (not= 1 concurrency)
              (nil? store-cache-size)
              (nil? search-cache-size) (nil? memory-mib) (nil? store-id)
              (nil? max-attempts) (nil? base-delay-ms) (nil? max-delay-ms)
              (nil? attempt-timeout-ms) (nil? connect-timeout-ms)
              (> base-delay-ms max-delay-ms)
              (not (re-matches region-pattern (or region "")))
              (not (re-matches table-pattern (or table "")))
              (not (and (string? cursor-key)
                        (<= 32 (count (.getBytes ^String cursor-key
                                                "UTF-8")))))
              (not (re-matches sha1-pattern (:demoSha identity)))
              (not= pinned-eacl-sha (:eaclSha identity))
              (not (re-matches sha256-pattern (:artifactSha256 identity)))
              (not (re-matches deployment-pattern (:deploymentId identity))))
      (throw (ex-info "Lambda environment is incomplete or invalid."
                      {:type :eacl-demo/invalid-environment})))
    {:reader-config
     {:table table
      :region region
      :store-id store-id
      :store-cache-size store-cache-size
      :search-cache-size search-cache-size
      :maximum-concurrency concurrency
      :security-key cursor-key
      :max-attempts max-attempts
      :base-delay-ms base-delay-ms
      :max-delay-ms max-delay-ms
      :attempt-timeout-ms attempt-timeout-ms
      :connect-timeout-ms connect-timeout-ms}
     :identity identity
     :memory-mib memory-mib}))

(defn- parse-positive-int
  [value]
  (when (and (string? value) (re-matches #"[1-9][0-9]{0,8}" value))
    (try
      (let [parsed (Integer/parseInt value)]
        (when (pos-int? parsed) parsed))
      (catch NumberFormatException _ nil))))

(defn- parse-nonnegative-int
  [value]
  (when (and (string? value) (re-matches #"(?:0|[1-9][0-9]{0,8})" value))
    (try
      (let [parsed (Integer/parseInt value)]
        (when (nat-int? parsed) parsed))
      (catch NumberFormatException _ nil))))

(defn- parse-bounded-int
  [value minimum maximum]
  (when (and (string? value) (re-matches #"[1-9][0-9]{0,8}" value))
    (try
      (let [parsed (Integer/parseInt value)]
        (when (<= minimum parsed maximum) parsed))
      (catch NumberFormatException _ nil))))
