(ns eacl-demo.datomic-dynamodb.boundary
  "Closed public boundary for one fixed Datomic DB value."
  (:require [eacl-demo.contracts.http :as http]
            [eacl-demo.contracts.response-meta :as response-meta])
  (:import [java.util.concurrent Semaphore]))

(def profile-id "datomic-dynamodb")
(def method-by-operation
  {"health" :get
   "bootstrap" :get
   "list-subjects" :post
   "get-object" :post
   "list-relationships" :post
   "reverse-relationships" :post
   "check-permission" :post
   "lookup-resources" :post
   "lookup-subjects" :post
   "count-resources" :post
   "get-schema" :post
   "get-cache-info" :post
   "count-objects" :post})

(defn parse-route
  [{:keys [path method]}]
  (let [path (or path "")
        operation (when (and (.startsWith ^String path "/")
                             (< 1 (count path)))
                    (subs path 1))
        expected (get method-by-operation operation)]
    (cond
      (or (nil? operation) (.contains ^String operation "/")
          (.contains ^String path "%") (nil? expected))
      {:ok? false :code "route-not-found"}

      (not= expected method)
      {:ok? false :code "method-not-allowed" :allowed-method expected}

      :else {:ok? true :operation operation})))

(def success-envelope http/success-envelope)
(def failure-envelope http/failure-envelope)

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
    (throw (ex-info "Invalid Datomic/DynamoDB boundary configuration."
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
        supported-consistency
        (set (get-in descriptor [:capabilities :consistencyModes]))
        input-result (when ok?
                       (http/normalize-input operation (or input {})
                                             supported-consistency))
        input (:input input-result)]
    (cond
      (not (http/valid-request-id? request-id))
      (failure-envelope (assoc request :request-id "invalid")
                        identity nil "validation-error")

      (not ok?)
      (failure-envelope request identity nil code)

      (not (:ok? input-result))
      ;; This is intentionally before admission and snapshot construction so
      ;; malformed input and disallowed modes cannot reach EACL source
      ;; selection, caches, handlers, or sync.
      (failure-envelope request identity nil (:code input-result))

      (not (.tryAcquire permits))
      (failure-envelope request identity nil "overloaded")

      :else
      (do
        (swap! active inc)
        (let [started-nanos (System/nanoTime)
              snapshot* (atom nil)
              check-active!
              (fn []
                (cond
                  (and (fn? cancelled?) (cancelled?))
                  (throw (ex-info "cancelled" {:code "cancelled"}))

                  (and (integer? deadline-ms) (>= (clock) deadline-ms))
                  (throw (ex-info "deadline" {:code "deadline-exceeded"}))))]
          (try
            (check-active!)
            (let [snapshot (capture-snapshot input)]
              ;; Retain the cleanup handle before validating the rest of the
              ;; internal shape so a malformed capture cannot leak resources.
              (reset! snapshot* snapshot)
              (when-not (and (map? snapshot) (map? (:basis snapshot))
                             (fn? (:release! snapshot)))
                (throw (ex-info "Invalid immutable request snapshot."
                                {:code "internal-error"})))
              (check-active!)
              (let [data (if (= operation "bootstrap")
                           descriptor
                           ((get handlers operation)
                            {:input (assoc input
                                           :eacl-demo/snapshot (:value snapshot)
                                           :eacl-demo/public-basis (:basis snapshot))
                             :snapshot (:value snapshot)
                             :basis (:basis snapshot)
                             :check-active! check-active!}))]
                (check-active!)
                (success-envelope request identity (:basis snapshot)
                                  data
                                  (response-meta/elapsed-ms started-nanos)
                                  (response-meta/cache-status data))))
            (catch clojure.lang.ExceptionInfo error
              (failure-envelope request identity
                                (some-> @snapshot* :basis)
                                (or (:code (ex-data error)) "internal-error")))
            (catch Throwable _
              (failure-envelope request identity
                                (some-> @snapshot* :basis) "internal-error"))
            (finally
              (try
                (when-let [release! (some-> @snapshot* :release!)]
                  (release!))
                (finally
                  (swap! active dec)
                  (.release permits))))))))))

(defn active-count [boundary] @(:active boundary))

(defn descriptor
  [{:keys [identity runtime dataset basis capabilities limits]}]
  {:contract {:name "explorer.v1" :routeMajor 1 :revision 4
              :minimumClientRevision 1}
   :identity identity
   :profile {:backend "datomic" :storage "dynamodb"}
   :runtime runtime
   :dataset dataset
   :basis basis
   :capabilities capabilities
   :limits limits})
