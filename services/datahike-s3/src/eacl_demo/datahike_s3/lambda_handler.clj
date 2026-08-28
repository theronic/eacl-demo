(ns eacl-demo.datahike-s3.lambda-handler
  "AWS Lambda Function URL entrypoint for the adopted read-only S3 store."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [eacl-demo.contracts.build-identity :as build-identity]
            [eacl-demo.contracts.cache-metrics :as cache-metrics]
            [eacl-demo.contracts.function-url :as function-url]
            [eacl-demo.contracts.observability :as observability]
            [eacl-demo.datahike-s3.boundary :as boundary]
            [eacl-demo.datahike-s3.operations :as operations]
            [eacl-demo.datahike-s3.profile :as profile]
            [eacl-demo.datahike-s3.reader :as reader]
            [eacl.datahike.core :as datahike-eacl])
  (:import [com.amazonaws.services.lambda.runtime Context]
           [java.io InputStream OutputStream]
           [java.util UUID]))

(def ^:private sha1-pattern #"[0-9a-f]{40}")
(def ^:private sha256-pattern #"[0-9a-f]{64}")
(def ^:private deployment-pattern #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}")
(def ^:private region-pattern #"[a-z]{2}(?:-[a-z0-9]+)+-[0-9]")
(def ^:private bucket-pattern
  #"(?=.{3,63}$)(?![0-9]+(?:\.[0-9]+){3}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?")

(declare handle-event initialize parse-environment parse-nonnegative-int
         parse-positive-int prime-runtime!)

(def ^:private snapstart-prime-event
  {:version "2.0"
   :routeKey "$default"
   :rawPath "/lookup-resources"
   :rawQueryString ""
   :headers {"content-type" "application/json"}
   :requestContext
   {:requestId "snapstart-prime-lookup-resources"
    :http {:method "POST"}}
   :isBase64Encoded false
   :body (json/write-str
          {:subjectType "user"
           :subjectId "user-1"
           :resourceType "server"
           :permission "admin"
           :pageSize 10
           :cache true
           :populateCache true
           :consistency "minimize"})
   :cookies nil})
(def ^:private snapstart-prime-repetitions 256)

(defonce ^:private runtime
  (delay
    (let [environment (into {} (System/getenv))]
      (observability/initialize-with-telemetry!
       (observability/runtime-context "datahike-s3" environment)
       #(initialize environment)))))

(defn initialize-runtime!
  "Realizes the immutable reader during published-version initialization so
  SnapStart captures the adopted, read-only Datahike/S3 runtime at 1769 MB."
  []
  (prime-runtime! @runtime)
  nil)

(defn initialize
  "Builds one immutable reader and boundary before the published-version
  SnapStart checkpoint. Restored candidates are qualified before promotion."
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
                 operation-metrics (cache-metrics/create-operation-metrics)
                 handlers (operations/create-handlers
                           {:descriptor descriptor
                            :cursor-key (:security-key reader-config)
                            :refresh-snapshot! (:refresh-snapshot! opened)
                            :cache-stats #(datahike-eacl/cache-stats
                                           (:client opened))
                            :operation-metrics operation-metrics})]
             {:reader opened
              :descriptor descriptor
              :operation-metrics operation-metrics
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
  (let [started-nanos (System/nanoTime)
        normalized (function-url/normalize-event event)
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
                             :cancelled? (constantly false)))
            response (function-url/create-response envelope)]
        (cache-metrics/record-response!
         (:operation-metrics runtime) (subs (:path request) 1)
         started-nanos response envelope)
        response))))

(defn prime-runtime!
  "Exercises and populates the exact first admin server page before SnapStart.

  EACL cache hits alone are sub-millisecond; capturing the complete route,
  boundary, pagination, and JSON code path prevents every restored environment
  from paying the interpreter/JIT warm-up cost on its first resource page."
  [running]
  (let [final-cache-status (volatile! nil)]
    (dotimes [_ snapstart-prime-repetitions]
      (let [response (handle-event running snapstart-prime-event 30000)
            envelope (json/read-str (:body response) :key-fn keyword)]
        (vreset! final-cache-status (get-in envelope [:meta :cacheStatus]))
        (when-not (and (= 200 (:statusCode response))
                       (= 10 (count (get-in envelope [:data :items]))))
          (throw (ex-info "Datahike/S3 SnapStart lookup priming failed."
                          {:type :eacl-demo/snapstart-prime-failed
                           :status (:statusCode response)
                           :cache-status @final-cache-status
                           :error-code (get-in envelope [:error :code])})))))
    (when-not (= "hit" @final-cache-status)
      (throw (ex-info "Datahike/S3 SnapStart cache did not converge."
                      {:type :eacl-demo/snapstart-prime-failed
                       :cache-status @final-cache-status}))))
  running)

(defn handle-request-stream
  [^InputStream input ^OutputStream output ^Context context]
  (let [writer (io/writer output :encoding "UTF-8")
        environment (into {} (System/getenv))
        telemetry-context (observability/runtime-context "datahike-s3"
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
  (let [required ["AWS_REGION" "EACL_DATAHIKE_BUCKET"
                  "EACL_DATAHIKE_STORE_ID" "EACL_STORE_CACHE_SIZE"
                  "EACL_SEARCH_CACHE_SIZE" "EACL_MAXIMUM_CONCURRENCY"
                  "EACL_CURSOR_KEY" "EACL_DEMO_SHA"
                  "EACL_ARTIFACT_SHA256" "EACL_DEPLOYMENT_ID"
                  "AWS_LAMBDA_FUNCTION_MEMORY_SIZE"]
        missing (filter #(not (string? (get environment %))) required)
        concurrency (parse-positive-int
                     (get environment "EACL_MAXIMUM_CONCURRENCY"))
        store-cache-size (parse-positive-int
                          (get environment "EACL_STORE_CACHE_SIZE"))
        search-cache-size (parse-nonnegative-int
                           (get environment "EACL_SEARCH_CACHE_SIZE"))
        memory-mib (parse-positive-int
                    (get environment "AWS_LAMBDA_FUNCTION_MEMORY_SIZE"))
        store-id (try
                   (UUID/fromString
                    (get environment "EACL_DATAHIKE_STORE_ID" ""))
                   (catch IllegalArgumentException _ nil))
        baked-eacl-sha (build-identity/eacl-sha)
        declared-eacl-sha (get environment "EACL_CORE_SHA")
        identity {:profileId "datahike-s3"
                  :demoSha (get environment "EACL_DEMO_SHA")
                  :eaclSha baked-eacl-sha
                  :artifactSha256 (get environment "EACL_ARTIFACT_SHA256")
                  :deploymentId (get environment "EACL_DEPLOYMENT_ID")
                  :dataManifestSha256 profile/data-manifest-sha256}
        region (get environment "AWS_REGION")
        bucket (get environment "EACL_DATAHIKE_BUCKET")
        cursor-key (get environment "EACL_CURSOR_KEY")]
    (when (or (seq missing)
              (nil? concurrency) (not= 1 concurrency)
              (nil? store-cache-size)
              (nil? search-cache-size) (nil? memory-mib) (nil? store-id)
              (not (re-matches region-pattern (or region "")))
              (not (re-matches bucket-pattern (or bucket "")))
              (not (and (string? cursor-key)
                        (<= 32 (count (.getBytes ^String cursor-key
                                                "UTF-8")))))
              (not (re-matches sha1-pattern (:demoSha identity)))
              (and (some? declared-eacl-sha)
                   (not= baked-eacl-sha declared-eacl-sha))
              (not (re-matches sha256-pattern (:artifactSha256 identity)))
              (not (re-matches deployment-pattern (:deploymentId identity))))
      (throw (ex-info "Lambda environment is incomplete or invalid."
                      {:type :eacl-demo/invalid-environment})))
    {:reader-config
     {:bucket bucket
      :region region
      :store-id store-id
      :store-cache-size store-cache-size
      :search-cache-size search-cache-size
      :maximum-concurrency concurrency
      :security-key cursor-key}
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
