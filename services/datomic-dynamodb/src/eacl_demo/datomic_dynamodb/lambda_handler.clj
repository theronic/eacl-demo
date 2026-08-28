(ns eacl-demo.datomic-dynamodb.lambda-handler
  "AWS Lambda Function URL entrypoint for the fixed-current Datomic reader."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [eacl-demo.contracts.function-url :as function-url]
            [eacl-demo.contracts.observability :as observability]
            [eacl-demo.datomic-dynamodb.boundary :as boundary]
            [eacl-demo.datomic-dynamodb.operations :as operations]
            [eacl-demo.datomic-dynamodb.profile :as profile]
            [eacl-demo.datomic-dynamodb.reader :as reader])
  (:import [com.amazonaws.services.lambda.runtime Context]
           [java.io InputStream OutputStream]))

(def ^:private pinned-eacl-sha
  "11114f59fa57fe87c5b7ab412b3123a9c8a1a862")
(def ^:private sha1-pattern #"[0-9a-f]{40}")
(def ^:private sha256-pattern #"[0-9a-f]{64}")
(def ^:private deployment-pattern #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}")

(declare handle-event initialize invoke-event! parse-environment
         parse-positive-int)

(defonce ^:private runtime
  (delay
    (let [environment (into {} (System/getenv))]
      (observability/initialize-with-telemetry!
       (observability/runtime-context "datomic-dynamodb" environment)
       #(initialize environment)))))

(defn initialize-runtime!
  "Realize the fixed read-only Peer and captured database value during process
  initialization. Lambda SnapStart is deliberately disabled so the Peer can
  refresh AWS credentials instead of restoring checkpointed credential state."
  []
  @runtime
  nil)

(defn initialize
  "Builds one reader and boundary. Injectable for local tests; production uses
  the process environment and realizes this function exactly once."
  ([environment]
   (initialize environment reader/open-reader!))
  ([environment open-reader!]
   (let [{:keys [reader-config identity memory-mib execution]}
         (parse-environment environment)
         opened (open-reader! reader-config)
         descriptor (profile/descriptor
                     {:identity identity
                      :basis (:basis opened)
                      :memory-mib memory-mib
                      :execution execution
                      :admission-concurrency (:maximum-concurrency reader-config)})
         handlers (operations/create-handlers
                   {:descriptor descriptor
                    :cursor-key (:security-key reader-config)})]
     {:reader opened
      :descriptor descriptor
      :boundary (boundary/create-boundary
                 {:descriptor descriptor
                  :capture-snapshot (:capture-snapshot opened)
                  :handlers handlers
                  :maximum-concurrency (:maximum-concurrency reader-config)})})))

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
                  "EACL_DEMO_SHA" "EACL_CORE_SHA" "EACL_ARTIFACT_SHA256"
                  "EACL_DEPLOYMENT_ID" memory-key]
        missing (filter #(not (string? (get environment %))) required)
        concurrency (parse-positive-int (get environment
                                             "EACL_MAXIMUM_CONCURRENCY"))
        memory-mib (parse-positive-int (get environment memory-key))
        identity {:profileId "datomic-dynamodb"
                  :demoSha (get environment "EACL_DEMO_SHA")
                  :eaclSha (get environment "EACL_CORE_SHA")
                  :artifactSha256 (get environment "EACL_ARTIFACT_SHA256")
                  :deploymentId (get environment "EACL_DEPLOYMENT_ID")
                  :dataManifestSha256 profile/data-manifest-sha256}]
    (when (or (seq missing)
              (nil? concurrency) (nil? memory-mib)
              (not (contains? #{"lambda" "ec2"} execution))
              (not (re-matches sha1-pattern (:demoSha identity)))
              (not= pinned-eacl-sha (:eaclSha identity))
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
