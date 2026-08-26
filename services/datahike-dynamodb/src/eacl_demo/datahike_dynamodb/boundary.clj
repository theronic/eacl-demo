(ns eacl-demo.datahike-dynamodb.boundary
  "Closed request boundary that propagates request lifetime into storage reads."
  (:require [eacl-demo.contracts.http :as http]
            [eacl-demo.datahike-dynamodb.context :as context])
  (:import [java.util.concurrent Semaphore]))

(def profile-id "datahike-dynamodb")
(def profile-prefix "/api/v1/datahike-dynamodb")

(def method-by-operation
  {"health" :get
   "bootstrap" :get
   "list-subjects" :post
   "get-object" :post
   "list-relationships" :post
   "reverse-relationships" :post
   "authorize" :post
   "lookup-resources" :post
   "lookup-subjects" :post
   "count-resources" :post
   "get-schema" :post
   "get-cache-info" :post
   "count-objects" :post})

(defn parse-route
  [{:keys [path method]}]
  (let [path (or path "")
        prefix (str profile-prefix "/")
        operation (when (.startsWith ^String path prefix)
                    (subs path (count prefix)))
        expected (get method-by-operation operation)]
    (cond
      (or (nil? operation) (.contains ^String operation "/")
          (.contains ^String path "%") (nil? expected))
      {:ok? false :code "route-not-found"}

      (not= expected method)
      {:ok? false :code "method-not-allowed" :allowed-method expected}

      :else {:ok? true :operation operation})))

(defn success-envelope
  [request operation identity basis data]
  {:ok true
   :meta {:contractVersion "explorer.v1"
          :operation operation
          :requestId (:request-id request)
          :identity identity
          :basis basis}
   :data data})

(defn- error-message
  [code]
  (case code
    "route-not-found" "The route is not available."
    "method-not-allowed" "The HTTP method is not allowed."
    "unsupported-consistency" "The consistency mode is not supported."
    "cancelled" "The request was cancelled."
    "deadline-exceeded" "The request deadline was exceeded."
    "overloaded" "The profile has reached its admission limit."
    "throttled" "A dependency throttled the request."
    "dependency-unavailable" "A required dependency is unavailable."
    "storage-missing" "Required immutable storage data is missing."
    "storage-corrupt" "Required immutable storage data failed integrity checks."
    "internal-error" "The request failed internally."
    "The request is invalid."))

(def retryable-codes
  #{"cancelled" "deadline-exceeded" "overloaded" "throttled"
    "dependency-unavailable"})

(defn failure-envelope
  [request operation identity basis code]
  {:ok false
   :meta {:contractVersion "explorer.v1"
          :operation operation
          :requestId (:request-id request)
          :identity identity
          :basis basis}
   :error {:code code
           :message (error-message code)
           :retryable (contains? retryable-codes code)
           :details []}})

(defn create-boundary
  [{:keys [descriptor capture-snapshot handlers maximum-concurrency clock]
    :or {maximum-concurrency 1 clock #(System/currentTimeMillis)}}]
  (when-not (and (map? descriptor)
                 (= profile-id (get-in descriptor [:identity :profileId]))
                 (fn? capture-snapshot)
                 (map? handlers)
                 (= (set (keys method-by-operation)) (set (keys handlers)))
                 (pos-int? maximum-concurrency)
                 (fn? clock))
    (throw (ex-info "Invalid Datahike/DynamoDB boundary configuration."
                    {:type :eacl-demo/invalid-boundary})))
  {:descriptor descriptor
   :capture-snapshot capture-snapshot
   :handlers handlers
   :permits (Semaphore. maximum-concurrency true)
   :clock clock
   :active (atom 0)})

(defn invoke!
  [{:keys [descriptor capture-snapshot handlers ^Semaphore permits clock active]}
   {:keys [request-id deadline-ms cancelled? input] :as request}]
  (let [{:keys [ok? operation code]} (parse-route request)
        operation (or operation "health")
        identity (:identity descriptor)
        input-result (when ok?
                       (http/normalize-input operation (or input {})
                                             #{"current"}))
        input (:input input-result)]
    (cond
      (not (http/valid-request-id? request-id))
      (failure-envelope (assoc request :request-id "invalid") operation
                        identity nil "validation-error")

      (not ok?)
      (failure-envelope request operation identity nil code)

      (not (:ok? input-result))
      (failure-envelope request operation identity nil (:code input-result))

      (not (.tryAcquire permits))
      (failure-envelope request operation identity nil "overloaded")

      :else
      (do
        (swap! active inc)
        (let [released? (atom false)
              snapshot* (atom nil)
              release-once!
              (fn []
                (when (compare-and-set! released? false true)
                  (when-let [release! (:release! @snapshot*)]
                    (release!))))
              check-active!
              (fn []
                (cond
                  (and (fn? cancelled?) (cancelled?))
                  (throw (ex-info "cancelled" {:code "cancelled"}))

                  (and (integer? deadline-ms) (>= (clock) deadline-ms))
                  (throw (ex-info "deadline" {:code "deadline-exceeded"}))))]
          (try
            (binding [context/*request-context*
                      {:deadline-ms deadline-ms
                       :cancelled? cancelled?
                       :clock clock}]
              (check-active!)
              (let [snapshot (capture-snapshot)]
                (reset! snapshot* snapshot)
                (when-not (and (map? snapshot) (map? (:basis snapshot))
                               (fn? (:release! snapshot)))
                  (throw (ex-info "Invalid immutable request snapshot."
                                  {:code "internal-error"})))
                (check-active!)
                (let [data ((get handlers operation)
                            {:input input
                             :snapshot (:value snapshot)
                             :basis (:basis snapshot)
                             :check-active! check-active!})]
                  (check-active!)
                  (success-envelope request operation identity (:basis snapshot)
                                    data))))
            (catch clojure.lang.ExceptionInfo error
              (failure-envelope request operation identity
                                (some-> @snapshot* :basis)
                                (or (:code (ex-data error)) "internal-error")))
            (catch Throwable _
              (failure-envelope request operation identity
                                (some-> @snapshot* :basis) "internal-error"))
            (finally
              (try
                (release-once!)
                (finally
                  (swap! active dec)
                  (.release permits))))))))))

(defn active-count [boundary] @(:active boundary))

(defn descriptor
  [{:keys [identity runtime dataset basis capabilities limits]}]
  {:contract {:name "explorer.v1" :routeMajor 1 :revision 2
              :minimumClientRevision 1}
   :identity identity
   :profile {:backend "datahike" :storage "dynamodb"}
   :runtime runtime
   :dataset dataset
   :basis basis
   :capabilities capabilities
   :limits limits})
