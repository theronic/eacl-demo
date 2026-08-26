(ns eacl-demo.datahike-s3.boundary
  "Closed, read-only request boundary for the adopted S3 profile."
  (:require [eacl-demo.contracts.http :as http]
            [eacl-demo.contracts.response-meta :as response-meta])
  (:import [java.util.concurrent Semaphore]))

(def profile-id "datahike-s3")
(def profile-prefix "/api/v1/datahike-s3")

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

      :else
      {:ok? true :operation operation})))

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
    (throw (ex-info "Invalid Datahike/S3 boundary configuration."
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
      (failure-envelope (assoc request :request-id "invalid")
                        identity nil "validation-error")

      (not ok?)
      (failure-envelope request identity nil code)

      (not (:ok? input-result))
      (failure-envelope request identity nil (:code input-result))

      (not (.tryAcquire permits))
      (failure-envelope request identity nil "overloaded")

      :else
      (do
        (swap! active inc)
        (let [started-nanos (System/nanoTime)
              released? (atom false)
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
                (finally
                  (swap! active dec)
                  (.release permits))))))))))

(defn active-count [boundary] @(:active boundary))

(defn descriptor
  [{:keys [identity runtime dataset basis capabilities limits]}]
  {:contract {:name "explorer.v1" :routeMajor 1 :revision 2
              :minimumClientRevision 1}
   :identity identity
   :profile {:backend "datahike" :storage "s3"}
   :runtime runtime
   :dataset dataset
   :basis basis
   :capabilities capabilities
   :limits limits})
