(ns eacl-demo.datalevin-memory.boundary
  "Closed request boundary for the in-memory Datalevin demo."
  (:require [eacl-demo.contracts.http :as http]
            [eacl-demo.contracts.response-meta :as response-meta])
  (:import [java.util.concurrent Semaphore]))

(def profile-id "datalevin-memory")
(def profile-prefix "/api/v1/datalevin-memory")

(def ^:private method-by-operation
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

(def success-envelope http/success-envelope)
(def failure-envelope http/failure-envelope)

(defn descriptor
  [{:keys [identity runtime dataset basis capabilities limits]}]
  {:contract {:name "explorer.v1" :routeMajor 1 :revision 2
              :minimumClientRevision 1}
   :identity identity
   :profile {:backend "datalevin" :storage "memory"}
   :runtime runtime
   :dataset dataset
   :basis basis
   :capabilities capabilities
   :limits limits})

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
    (throw (ex-info "Invalid Datalevin boundary configuration."
                    {:type :eacl-demo/invalid-boundary})))
  {:descriptor descriptor
   :capture-snapshot capture-snapshot
   :handlers handlers
   :permits (Semaphore. maximum-concurrency true)
   :clock clock})

(defn invoke!
  [{:keys [descriptor capture-snapshot handlers ^Semaphore permits clock]}
   {:keys [request-id deadline-ms cancelled?] :as request}]
  (let [{:keys [ok? operation code]} (parse-route request)
        operation (or operation "health")
        identity (:identity descriptor)
        input-result (when ok?
                       (http/normalize-input operation (or (:input request) {})
                                             #{"current"}))
        input (:input input-result)]
    (cond
      (not (http/valid-request-id? request-id))
      (failure-envelope (assoc request :request-id "invalid")
                        identity nil "validation-error")
      (not ok?)
      (failure-envelope request identity nil code)
      (not (:ok? input-result))
      (failure-envelope request identity nil (:code input-result))
      (not (.tryAcquire permits))
      (failure-envelope request identity nil "overloaded")
      :else
      (let [started-nanos (System/nanoTime)
            snapshot* (atom nil)
            released? (atom false)
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
          (check-active!)
          (let [snapshot (capture-snapshot)]
            (reset! snapshot* snapshot)
            (when-not (and (map? snapshot) (map? (:basis snapshot))
                           (fn? (:release! snapshot)))
              (throw (ex-info "Invalid Datalevin request snapshot."
                              {:code "internal-error"})))
            (let [data ((get handlers operation)
                        {:input input
                         :snapshot (:value snapshot)
                         :basis (:basis snapshot)
                         :check-active! check-active!})]
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
              (release-once!)
              (finally (.release permits)))))))))
