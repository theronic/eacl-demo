(ns eacl-demo.datomic-dynamodb.lambda-handler
  "AWS Lambda Function URL entrypoint for the fixed-current Datomic reader."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [eacl-demo.contracts.build-identity :as build-identity]
            [eacl-demo.contracts.cache-metrics :as cache-metrics]
            [eacl-demo.contracts.function-url :as function-url]
            [eacl-demo.contracts.observability :as observability]
            [eacl-demo.datomic-dynamodb.boundary :as boundary]
            [eacl-demo.datomic-dynamodb.operations :as operations]
            [eacl-demo.datomic-dynamodb.profile :as profile]
            [eacl-demo.datomic-dynamodb.reader :as reader]
            [eacl.datomic.core :as datomic-eacl])
  (:import [com.amazonaws.services.lambda.runtime Context]
           [java.io InputStream OutputStream]))

(def ^:private sha1-pattern #"[0-9a-f]{40}")
(def ^:private sha256-pattern #"[0-9a-f]{64}")
(def ^:private deployment-pattern #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}")

(declare handle-event initialize invoke-event! parse-environment
         parse-positive-int prepare-runtime! verify-hot-path! warm-hot-path!)

;; On a fresh JVM, the same real Datomic cache hit falls from roughly 100us to
;; roughly 13us after ten thousand calls. Alternate the two Explorer requests
;; so both operation-specific call sites cross the measured JIT threshold.
(def ^:private hot-path-warmup-iterations 20000)
(def ^:private never-cancelled? (constantly false))
(def ^:private hot-path-requests
  [{:path "/lookup-resources"
    :method :post
    :request-id "warm-lookup-resources"
    :input {:subjectType "user"
            :subjectId "user-1"
            :resourceType "server"
            :permission "view"
            :pageSize 100
            :cache true
            :populateCache true
            :consistency "minimize"}}
   {:path "/count-resources"
    :method :post
    :request-id "warm-count-resources"
    :input {:subjectType "user"
            :subjectId "user-1"
            :resourceType "server"
            :permission "view"
            :ceiling 1000
            :cache true
            :populateCache true
            :consistency "minimize"}}])

(defonce ^:private runtime
  (delay
    (let [environment (into {} (System/getenv))]
      (observability/initialize-with-telemetry!
       (observability/runtime-context "datomic-dynamodb" environment)
       #(initialize environment)))))

(defn initialize-runtime!
  "Realize and warm the fixed read-only Peer. Lambda does this before its
  SnapStart checkpoint; EC2 does it before binding its public health port."
  []
  (prepare-runtime! @runtime)
  nil)

(defn close-runtime!
  "Closes the process reader after request admission has stopped. Lambda owns
  its runtime for the process lifetime; the EC2 shutdown hook calls this."
  ([]
   (when (realized? runtime)
     (close-runtime! @runtime)))
  ([running]
   (when-let [opened (:reader running)]
     (reader/close-reader! opened))
   nil))

(defn- prepare-runtime!
  [running]
  (try
    (warm-hot-path! running)
    running
    (catch Throwable error
      (try
        (close-runtime! running)
        (catch Throwable cleanup-error
          (.addSuppressed ^Throwable error cleanup-error)))
      (throw error))))

(defn initialize
  "Builds one reader and boundary. Injectable for local tests; production uses
  the process environment and realizes this function exactly once."
  ([environment]
   (initialize environment reader/open-reader!))
  ([environment open-reader!]
   (let [{:keys [reader-config identity memory-mib execution]}
         (parse-environment environment)
         opened (open-reader! reader-config)]
     (try
       (let [descriptor (profile/descriptor
                         {:identity identity
                          :basis (:basis opened)
                          :memory-mib memory-mib
                          :execution execution
                          :admission-concurrency
                          (:maximum-concurrency reader-config)})
             operation-metrics (cache-metrics/create-operation-metrics)
             handlers (operations/create-handlers
                       {:descriptor descriptor
                        :cursor-key (:security-key reader-config)
                        :cache-stats #(datomic-eacl/cache-stats (:client opened))
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
       (catch Throwable error
         (try
           (reader/close-reader! opened)
           (catch Throwable cleanup-error
             (.addSuppressed ^Throwable error cleanup-error)))
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

(defn warm-hot-path!
  "Populate and JIT-compile the two canonical server cache-hit paths."
  [running]
  (let [profile-boundary (:boundary running)
        final-envelopes
        (loop [iteration 0
               final-envelopes [nil nil]]
          (if (= iteration hot-path-warmup-iterations)
            final-envelopes
            (let [request-index (bit-and iteration 1)
                  request (nth hot-path-requests request-index)
                  envelope
                  (boundary/invoke!
                   profile-boundary
                   (assoc request
                          :deadline-ms (+ (System/currentTimeMillis) 30000)
                          :cancelled? never-cancelled?))]
              (recur (inc iteration)
                     (assoc final-envelopes request-index envelope)))))]
    (doseq [[request envelope] (map vector hot-path-requests final-envelopes)]
      (verify-hot-path! request envelope))
    ;; Exercise JSON encoding and operation metrics once per route without
    ;; paying that allocation-heavy transport cost during all 20,000 JIT calls.
    (doseq [request hot-path-requests]
      (let [event {:version "2.0"
                   :routeKey "$default"
                   :rawPath (:path request)
                   :rawQueryString ""
                   :headers {"content-type" "application/json"}
                   :requestContext
                   {:requestId (str "verify-" (:request-id request))
                    :http {:method "POST"}}
                   :isBase64Encoded false
                   :body (json/write-str (:input request))
                   :cookies nil}
            response (handle-event running event 30000)
            envelope (json/read-str (:body response) :key-fn keyword)]
        (when-not (= 200 (:statusCode response))
          (throw
           (ex-info "Datomic/DynamoDB hot-path transport verification failed."
                    {:type :eacl-demo/hot-path-warmup-failed
                     :operation (subs (:path request) 1)
                     :status (:statusCode response)})))
        (verify-hot-path! request envelope)))
    (let [metrics (cache-metrics/operation-snapshot
                   (:operation-metrics running))]
      (when-not (every? #(pos? (long (get-in metrics [% :count] 0)))
                        ["lookup-resources" "count-resources"])
        (throw
         (ex-info "Datomic/DynamoDB hot-path metrics verification failed."
                  {:type :eacl-demo/hot-path-warmup-failed})))))
  running)

(defn- verify-hot-path!
  [request envelope]
  (let [operation (subs (:path request) 1)
        cache-status (get-in envelope [:meta :cacheStatus])
        valid-data?
        (case operation
          "lookup-resources"
          (and (= 64 (count (get-in envelope [:data :items])))
               (= 64 (get-in envelope [:data :pageInfo :pageSize])))

          "count-resources"
          (and (= 64 (get-in envelope [:data :value]))
               (true? (get-in envelope [:data :exact]))
               (= 1000 (get-in envelope [:data :ceiling])))

          false)]
    (when-not (and valid-data? (= "hit" cache-status))
      (throw
       (ex-info (if (= "miss" cache-status)
                  "Datomic/DynamoDB hot-path cache did not converge."
                  "Datomic/DynamoDB hot-path verification failed.")
                {:type :eacl-demo/hot-path-warmup-failed
                 :operation operation
                 :cache-status cache-status
                 :error-code (get-in envelope [:error :code])}))))
  envelope)

(defn invoke-event!
  "Invoke one normalized Function URL-shaped event against the process runtime.
  Lambda and the EC2 HTTP adapter share this exact observable boundary."
  [event remaining-time-ms]
  (let [environment (into {} (System/getenv))
        telemetry-context (observability/runtime-context "datomic-dynamodb"
                                                         environment)
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
        environment (into {} (System/getenv))
        telemetry-context (observability/runtime-context "datomic-dynamodb"
                                                         environment)
        started (System/nanoTime)
        event* (atom nil)]
    (try
      (let [event (json/read (io/reader input :encoding "UTF-8")
                             :key-fn keyword)
            _ (reset! event* event)
            response (invoke-event!
                      event
                      (when context (.getRemainingTimeInMillis context)))]
        (json/write response writer))
      (catch Throwable error
        (observability/observe-exception! telemetry-context @event*
                                          started error)
        ;; Initialization errors occur before this method. Request-local
        ;; failures are deliberately redacted and never serialize exception
        ;; text, environment values, credentials, or Datomic details.
        (json/write (function-url/internal-error-response
                     @event* (:deployment-id telemetry-context)) writer))
      (finally
        (.flush writer)))))

(defn parse-environment
  [environment]
  (when-not (map? environment)
    (throw (ex-info "Lambda environment is invalid."
                    {:type :eacl-demo/invalid-environment})))
  (let [execution (get environment "EACL_RUNTIME_EXECUTION" "lambda")
        memory-key (if (= "ec2" execution)
                     "EACL_RUNTIME_MEMORY_MIB"
                     "AWS_LAMBDA_FUNCTION_MEMORY_SIZE")
        required ["AWS_REGION" "EACL_DATOMIC_TABLE" "EACL_DATOMIC_DATABASE"
                  "EACL_MAXIMUM_CONCURRENCY" "EACL_CURSOR_KEY"
                  "EACL_DEMO_SHA" "EACL_ARTIFACT_SHA256"
                  "EACL_DEPLOYMENT_ID" memory-key]
        missing (filter #(not (string? (get environment %))) required)
        concurrency (parse-positive-int (get environment
                                             "EACL_MAXIMUM_CONCURRENCY"))
        memory-mib (parse-positive-int (get environment memory-key))
        baked-eacl-sha (build-identity/eacl-sha)
        identity {:profileId "datomic-dynamodb"
                  :demoSha (get environment "EACL_DEMO_SHA")
                  :eaclSha baked-eacl-sha
                  :artifactSha256 (get environment "EACL_ARTIFACT_SHA256")
                  :deploymentId (get environment "EACL_DEPLOYMENT_ID")
                  :dataManifestSha256 profile/data-manifest-sha256}]
    (when (or (seq missing)
              (nil? concurrency) (nil? memory-mib)
              (not (contains? #{"lambda" "ec2"} execution))
              (not (re-matches sha1-pattern (:demoSha identity)))
              (not (re-matches sha256-pattern (:artifactSha256 identity)))
              (not (re-matches deployment-pattern (:deploymentId identity))))
      (throw (ex-info "Lambda environment is incomplete or invalid."
                      {:type :eacl-demo/invalid-environment})))
    {:reader-config
     {:region (get environment "AWS_REGION")
      :table (get environment "EACL_DATOMIC_TABLE")
      :database (get environment "EACL_DATOMIC_DATABASE")
      :maximum-concurrency concurrency
      :security-key (get environment "EACL_CURSOR_KEY")}
     :identity identity
     :memory-mib memory-mib
     :execution execution}))

(defn- parse-positive-int
  [value]
  (when (and (string? value) (re-matches #"[1-9][0-9]{0,8}" value))
    (try
      (let [parsed (Integer/parseInt value)]
        (when (pos-int? parsed) parsed))
      (catch NumberFormatException _ nil))))
