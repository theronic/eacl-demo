(ns eacl-demo.datalevin-memory.lambda-handler
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [eacl-demo.contracts.function-url :as function-url]
            [eacl-demo.contracts.observability :as observability]
            [eacl-demo.datalevin-memory.boundary :as boundary]
            [eacl-demo.datalevin-memory.operations :as operations]
            [eacl-demo.datalevin-memory.profile :as profile]
            [eacl-demo.datalevin-memory.reader :as reader])
  (:import [com.amazonaws.services.lambda.runtime Context]
           [java.io InputStream OutputStream]))

(def ^:private pinned-eacl-sha
  "e06e429d1cf6ed686fc294924241312379b3bb3e")

(declare initialize)

(defonce ^:private runtime
  (delay
    (let [environment (into {} (System/getenv))]
      (observability/initialize-with-telemetry!
       (observability/runtime-context "datalevin-memory" environment)
       #(initialize environment)))))

(defn initialize-runtime!
  "Realize the immutable in-memory reader during Lambda initialization so a
  published SnapStart version captures the ready database rather than the
  unrealized delay."
  []
  @runtime
  nil)

(defn- positive-int
  [value]
  (when (and (string? value) (re-matches #"[1-9][0-9]{0,8}" value))
    (try (Integer/parseInt value) (catch NumberFormatException _ nil))))

(defn parse-environment
  [environment]
  (let [identity {:profileId "datalevin-memory"
                  :demoSha (get environment "EACL_DEMO_SHA")
                  :eaclSha (get environment "EACL_CORE_SHA")
                  :artifactSha256 (get environment "EACL_ARTIFACT_SHA256")
                  :deploymentId (get environment "EACL_DEPLOYMENT_ID")
                  :dataManifestSha256 profile/data-manifest-sha256}
        cursor-key (get environment "EACL_CURSOR_KEY")
        memory-mib (positive-int
                    (get environment "AWS_LAMBDA_FUNCTION_MEMORY_SIZE"))]
    (when-not (and (re-matches #"[0-9a-f]{40}" (or (:demoSha identity) ""))
                   (= pinned-eacl-sha (:eaclSha identity))
                   (re-matches #"[0-9a-f]{64}"
                               (or (:artifactSha256 identity) ""))
                   (re-matches #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}"
                               (or (:deploymentId identity) ""))
                   (string? cursor-key)
                   (<= 32 (alength (.getBytes ^String cursor-key "UTF-8")))
                   (pos-int? memory-mib))
      (throw (ex-info "Lambda environment is incomplete or invalid."
                      {:type :eacl-demo/invalid-environment})))
    {:identity identity :cursor-key cursor-key :memory-mib memory-mib}))

(defn initialize
  [environment]
  (let [{:keys [identity cursor-key memory-mib]}
        (parse-environment environment)
        opened (reader/open-reader! {:security-key cursor-key})]
    (try
      (let [initial ((:capture-snapshot opened))]
        (try
          (let [descriptor (profile/descriptor
                            {:identity identity :basis (:basis initial)
                             :memory-mib memory-mib})
                handlers (operations/create-handlers
                          {:descriptor descriptor :cursor-key cursor-key})]
            {:reader opened
             :descriptor descriptor
             :boundary (boundary/create-boundary
                        {:descriptor descriptor
                         :capture-snapshot (:capture-snapshot opened)
                         :handlers handlers
                         :maximum-concurrency 1})})
          (finally ((:release! initial)))))
      (catch Throwable error
        (reader/close-reader! opened)
        (throw error)))))

(defn handle-event
  [runtime-value event remaining-time-ms]
  (let [normalized (function-url/normalize-event event)
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
                           :cancelled? (constantly false))]
        (function-url/create-response
         (boundary/invoke! (:boundary runtime-value) request))))))

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
            response (handle-event @runtime event
                                   (when context
                                     (.getRemainingTimeInMillis context)))]
        (observability/observe-response! telemetry-context event response started)
        (json/write response writer))
      (catch Throwable error
        (observability/observe-exception! telemetry-context @event* started error)
        (json/write (function-url/internal-error-response
                     @event* (:deployment-id telemetry-context)) writer))
      (finally (.flush writer)))))
