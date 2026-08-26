(ns eacl-demo.datalevin-memory.runtime
  "Dependency-independent request ownership and telemetry boundary for the
  future Datalevin Lambda. Actual Datalevin functions are injected only by the
  release-qualified service assembly."
  (:require [eacl-demo.datalevin-memory.lifecycle :as lifecycle]))

(def maximum-exact-integer 9007199254740991)
(def maximum-transport-depth 64)
(def maximum-transport-nodes 100000)
(def maximum-transport-bytes 5242880)

(def ^:private byte-array-class (Class/forName "[B"))

(def operation-keys
  #{:open-snapshot! :close-snapshot! :active-snapshot-info! :memory-sample!})

(def request-keys
  #{:deadlineEpochMs :nowMs :cancelled? :realize!})

(def memory-sample-keys
  #{:heapUsedBytes :heapCommittedBytes :heapMaxBytes
    :nonHeapUsedBytes :nonHeapCommittedBytes :directUsedBytes :mappedUsedBytes
    :rssBytes :nativeMappedBytes :openFileDescriptorCount :nativeHandleCount})

(def counter-keys
  #{:openedSnapshots :closedSnapshots :activeSnapshots :peakActiveSnapshots
    :acquisitionFailures :releaseFailures :requestFailures :cancellations
    :deadlineFailures :lastOwnerThreadId})

(def counter-natural-keys
  (disj counter-keys :lastOwnerThreadId))

(def control-keys
  #{:identity :admission :counters})

(def initial-counters
  {:openedSnapshots 0
   :closedSnapshots 0
   :activeSnapshots 0
   :peakActiveSnapshots 0
   :acquisitionFailures 0
   :releaseFailures 0
   :requestFailures 0
   :cancellations 0
   :deadlineFailures 0
   :lastOwnerThreadId nil})

(defn- fail!
  ([reason] (fail! reason nil))
  ([reason safe-data]
   (throw
    (ex-info
     "Datalevin runtime ownership validation failed."
     (merge {:type :eacl-demo.datalevin/runtime-ownership-failed
             :eacl/error :eacl-demo.datalevin/runtime-ownership-failed
             :reason reason}
            safe-data)))))

(defn- exact-map!
  [value expected reason]
  (when-not (map? value)
    (fail! reason {:failure :not-a-map}))
  (let [actual (set (keys value))]
    (when-not (= expected actual)
      (fail! reason
             {:missing-keys (vec (sort (remove actual expected)))
              :unexpected-keys (vec (sort (remove expected actual)))})))
  value)

(defn- exact-natural?
  [value]
  (and (integer? value)
       (not (neg? value))
       (<= value maximum-exact-integer)))

(defn- exact-integer?
  [value]
  (and (integer? value)
       (<= (- maximum-exact-integer) value maximum-exact-integer)))

(defn- function-map!
  [operations]
  (exact-map! operations operation-keys :invalid-operations)
  (doseq [key operation-keys]
    (when-not (fn? (get operations key))
      (fail! :invalid-operations {:field key})))
  operations)

(defn- request-contract!
  [request]
  (exact-map! request request-keys :invalid-request-control)
  (when-not (exact-natural? (:deadlineEpochMs request))
    (fail! :invalid-request-control {:field :deadlineEpochMs}))
  (doseq [key [:nowMs :cancelled? :realize!]]
    (when-not (fn? (get request key))
      (fail! :invalid-request-control {:field key})))
  request)

(defn create-control!
  "Create one opaque process-local ownership controller bound to an exact
  immutable lifecycle state. It contains no Datalevin handle or durable state."
  [identity]
  (lifecycle/validate-state! identity)
  {:identity identity
   :admission (atom nil)
   :counters (atom initial-counters)})

(defn- validate-control!
  [control]
  (exact-map! control control-keys :invalid-control)
  (lifecycle/validate-state! (:identity control))
  (when-not (and (instance? clojure.lang.Atom (:admission control))
                 (instance? clojure.lang.Atom (:counters control)))
    (fail! :invalid-control))
  (let [admitted @(:admission control)
        counters (exact-map! @(:counters control) counter-keys
                             :invalid-counters)]
    (when-not (or (nil? admitted) (instance? Thread admitted))
      (fail! :invalid-control {:field :admission}))
    (doseq [field counter-natural-keys]
      (when-not (exact-natural? (get counters field))
        (fail! :invalid-counters {:field field})))
    (when-not (and (<= (:activeSnapshots counters) 1)
                   (<= (:peakActiveSnapshots counters) 1)
                   (<= (:activeSnapshots counters)
                       (:peakActiveSnapshots counters))
                   (= (:openedSnapshots counters)
                      (+ (:closedSnapshots counters)
                         (:activeSnapshots counters))))
      (fail! :invalid-counters {:failure :ownership-invariant}))
    (when-not (if (zero? (:openedSnapshots counters))
                (nil? (:lastOwnerThreadId counters))
                (and (integer? (:lastOwnerThreadId counters))
                     (exact-natural? (:lastOwnerThreadId counters))
                     (pos? (:lastOwnerThreadId counters))))
      (fail! :invalid-counters {:field :lastOwnerThreadId})))
  control)

(defn- platform-thread!
  []
  (let [thread (Thread/currentThread)]
    (when (.isVirtual thread)
      (fail! :virtual-thread-rejected))
    thread))

(defn- request-status!
  [{:keys [deadlineEpochMs nowMs cancelled?]}]
  (let [now (try
              (nowMs)
              (catch Exception _
                (fail! :clock-read-failed)))]
    (when-not (exact-natural? now)
      (fail! :invalid-clock))
    (let [cancelled (try
                      (cancelled?)
                      (catch Exception _
                        (fail! :cancellation-read-failed)))]
      (when-not (instance? Boolean cancelled)
        (fail! :invalid-cancellation-signal))
      (when cancelled
        (fail! :request-cancelled))
      (when (>= now deadlineEpochMs)
        (fail! :request-deadline-exceeded))))
  nil)

(defn- record-open!
  [control thread]
  (swap!
   (:counters control)
   (fn [counters]
     (let [active (inc (:activeSnapshots counters))]
       (-> counters
           (update :openedSnapshots inc)
           (assoc :activeSnapshots active
                  :peakActiveSnapshots (max active (:peakActiveSnapshots counters))
                  :lastOwnerThreadId (.threadId thread)))))))

(defn- record-close!
  [control]
  (swap!
   (:counters control)
   (fn [counters]
     (when-not (pos? (:activeSnapshots counters))
       (fail! :snapshot-counter-underflow))
     (-> counters
         (update :closedSnapshots inc)
         (update :activeSnapshots dec)))))

(defn- classify-request-failure!
  [control error primary-error]
  (let [reason (:reason (ex-data (or primary-error error)))]
    (swap! (:counters control)
           (fn [counters]
             (cond-> (update counters :requestFailures inc)
               (= :request-cancelled reason) (update :cancellations inc)
               (= :request-deadline-exceeded reason)
               (update :deadlineFailures inc)))))
  error)

(defn- acquire-snapshot!
  [control operations]
  (let [candidate
        (try
          ((:open-snapshot! operations))
          (catch Exception _
            (swap! (:counters control) update :acquisitionFailures inc)
            (fail! :snapshot-acquisition-failed)))]
    (when (nil? candidate)
      (swap! (:counters control) update :acquisitionFailures inc)
      (fail! :snapshot-acquisition-failed {:failure :nil-snapshot}))
    candidate))

(defn- safe-work!
  [work snapshot]
  (try
    (work snapshot)
    (catch Exception _
      (fail! :request-work-failed))))

(defn- realize-response!
  [realize! result]
  (try
    (realize! result)
    (catch Exception _
      (fail! :response-realization-failed))))

(defn- transport-number?
  [value]
  (or (exact-integer? value)
      (and (or (instance? Double value) (instance? Float value))
           (Double/isFinite (double value)))))

(defn- close-transport-response!
  [value]
  (let [remaining-nodes (volatile! maximum-transport-nodes)
        remaining-bytes (volatile! maximum-transport-bytes)]
    (letfn [(consume-bytes! [length]
              (vswap! remaining-bytes - length)
              (when (neg? @remaining-bytes)
                (fail! :response-byte-limit-exceeded)))
            (copy-string! [candidate]
              (consume-bytes!
               (alength
                (.getBytes ^String candidate
                           java.nio.charset.StandardCharsets/UTF_8)))
              candidate)
            (canonical-key! [key]
              (cond
                (string? key) (copy-string! key)
                (keyword? key)
                (copy-string!
                 (if-let [key-namespace (namespace key)]
                   (str key-namespace "/" (name key))
                   (name key)))
                :else (fail! :unsafe-response-key)))
            (copy! [candidate depth]
              (vswap! remaining-nodes dec)
              (when (neg? @remaining-nodes)
                (fail! :response-node-limit-exceeded))
              (when (> depth maximum-transport-depth)
                (fail! :response-depth-limit-exceeded))
              (cond
                (or (nil? candidate)
                    (instance? Boolean candidate)
                    (keyword? candidate))
                candidate

                (string? candidate)
                (copy-string! candidate)

                (transport-number? candidate)
                candidate

                (instance? byte-array-class candidate)
                (do
                  (consume-bytes! (alength ^bytes candidate))
                  (aclone ^bytes candidate))

                (vector? candidate)
                (mapv #(copy! % (inc depth)) candidate)

                (map? candidate)
                (let [seen (volatile! #{})]
                  (persistent!
                   (reduce-kv
                    (fn [closed key nested]
                      (let [canonical-key (canonical-key! key)]
                        (when (contains? @seen canonical-key)
                          (fail! :duplicate-response-key))
                        (vswap! seen conj canonical-key)
                        (assoc! closed canonical-key
                                (copy! nested (inc depth)))))
                    (transient {})
                    candidate)))

                :else
                (fail! :unsafe-response-type)))]
      (copy! value 0))))

(defn- release-snapshot!
  [control operations thread snapshot]
  (let [failure
        (cond
          (not (identical? thread (Thread/currentThread)))
          :snapshot-release-thread-changed

          :else
          (try
            (when-not (true? ((:close-snapshot! operations) snapshot))
              :snapshot-not-owned-at-release)
            (catch Exception _
              :snapshot-release-failed)))]
    (if failure
      (do
        (swap! (:counters control) update :releaseFailures inc)
        failure)
      (do
        (record-close! control)
        nil))))

(defn- combined-release-error
  [release-reason primary-error]
  (ex-info
   "Datalevin runtime ownership validation failed."
   (cond->
    {:type :eacl-demo.datalevin/runtime-ownership-failed
     :eacl/error :eacl-demo.datalevin/runtime-ownership-failed
     :reason release-reason}
     primary-error
     (assoc :requestFailure true
            :requestFailureReason
            (or (:reason (ex-data primary-error)) :unknown-request-failure)))))

(defn invoke-with-owned-snapshot!
  "Run one admitted request on its current platform thread. The result is
  fully realized inside the snapshot scope, and the injected close operation
  is invoked exactly once on every post-acquisition exit path."
  [control operations request work]
  (validate-control! control)
  (function-map! operations)
  (request-contract! request)
  (when-not (fn? work)
    (fail! :invalid-work))
  (let [thread (platform-thread!)
        admission (:admission control)
        snapshot (volatile! nil)
        opened? (volatile! false)
        primary-error (volatile! nil)]
    (request-status! request)
    (when-not (compare-and-set! admission nil thread)
      (fail! :request-busy))
    (try
      (let [outcome
            (try
              (let [candidate (acquire-snapshot! control operations)]
                (vreset! snapshot candidate)
                (vreset! opened? true)
                (record-open! control thread)
                (request-status! request)
                (let [result (safe-work! work candidate)]
                  (when-not (identical? thread (Thread/currentThread))
                    (fail! :request-thread-changed))
                  (request-status! request)
                  (let [realized
                        (close-transport-response!
                         (realize-response! (:realize! request) result))]
                    (when-not (identical? thread (Thread/currentThread))
                      (fail! :realization-thread-changed))
                    (request-status! request)
                    {:result realized})))
              (catch Throwable error
                (vreset! primary-error error)
                {:error error}))
            release-reason
            (when @opened?
              (release-snapshot! control operations thread @snapshot))
            post-release-error
            (when (and (nil? release-reason) (nil? (:error outcome)))
              (try
                (request-status! request)
                nil
                (catch Throwable error error)))
            final-error
            (cond
              release-reason
              (combined-release-error release-reason @primary-error)

              (:error outcome)
              (:error outcome)

              post-release-error
              post-release-error

              :else nil)]
        (if final-error
          (do
            (classify-request-failure! control final-error @primary-error)
            (throw final-error))
          (:result outcome)))
      (finally
        (compare-and-set! admission thread nil)))))

(defn- optional-natural?
  [value]
  (or (nil? value) (exact-natural? value)))

(defn- validate-memory-sample!
  [sample]
  (exact-map! sample memory-sample-keys :invalid-memory-sample)
  (doseq [field [:heapUsedBytes :heapCommittedBytes :heapMaxBytes
                 :nonHeapUsedBytes :nonHeapCommittedBytes :directUsedBytes
                 :mappedUsedBytes]]
    (when-not (exact-natural? (get sample field))
      (fail! :invalid-memory-sample {:field field})))
  (doseq [field [:rssBytes :nativeMappedBytes :openFileDescriptorCount
                 :nativeHandleCount]]
    (when-not (optional-natural? (get sample field))
      (fail! :invalid-memory-sample {:field field})))
  (when-not (<= (:heapUsedBytes sample)
                (:heapCommittedBytes sample)
                (:heapMaxBytes sample))
    (fail! :invalid-memory-sample {:field :heapUsedBytes}))
  (when-not (<= (:nonHeapUsedBytes sample) (:nonHeapCommittedBytes sample))
    (fail! :invalid-memory-sample {:field :nonHeapUsedBytes}))
  sample)

(defn telemetry!
  "Return one closed observation that separates controller ownership counters,
  Datalevin's native-reader view, and heap/direct/native/process measurements."
  [control operations]
  (validate-control! control)
  (function-map! operations)
  (let [native-readers
        (try
          ((:active-snapshot-info! operations))
          (catch Exception _
            (fail! :native-reader-info-failed)))
        memory
        (try
          (validate-memory-sample! ((:memory-sample! operations)))
          (catch clojure.lang.ExceptionInfo error
            (throw error))
          (catch Exception _
            (fail! :memory-sample-failed)))
        identity (:identity control)]
    (exact-map! native-readers #{:active :oldest-age-ms}
                :invalid-native-reader-info)
    (when-not (and (exact-natural? (:active native-readers))
                   (if (zero? (:active native-readers))
                     (nil? (:oldest-age-ms native-readers))
                     (exact-natural? (:oldest-age-ms native-readers))))
      (fail! :invalid-native-reader-info))
    {:schema "eacl-demo.datalevin-runtime-telemetry.v1"
     :profileId "datalevin-memory"
     :demoSha (:demoSha identity)
     :eaclSha (:eaclSha identity)
     :artifactSha256 (:artifactSha256 identity)
     :deploymentId (:deploymentId identity)
     :runtime (:runtime identity)
     :architecture (:architecture identity)
     :storageMode (:storageMode identity)
     :maximumConcurrency (:maximumConcurrency identity)
     :sourceLifecycle (:sourceLifecycle identity)
     :nativeSourceId (:nativeSourceId identity)
     :revisionWatermark (:revisionWatermark identity)
     :snapshotStrategy (:snapshotStrategy identity)
     :ownership @(:counters control)
     :nativeReaders native-readers
     :memory memory
     :memoryComplete
     (every? some? ((juxt :rssBytes :nativeMappedBytes
                          :openFileDescriptorCount :nativeHandleCount)
                    memory))}))
