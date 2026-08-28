(ns eacl-demo.datalevin-memory-runtime-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.datalevin-memory.runtime :as runtime]))

(def valid-state
  {:schema "eacl-demo.datalevin-lifecycle-state.v1"
   :profileId "datalevin-memory"
   :stateKind "external-control-plane-metadata"
   :demoSha (apply str (repeat 40 "d"))
   :eaclSha (apply str (repeat 40 "e"))
   :artifactSha256 (apply str (repeat 64 "f"))
   :deploymentId "datalevin-candidate-42"
   :runtime "java25"
   :architecture "arm64"
   :storageMode "embedded"
   :snapshotStrategy "after-restore-rebuild"
   :maximumConcurrency 1
   :dataManifestSha256 (apply str (repeat 64 "a"))
   :bootstrapPlanSha256 (apply str (repeat 64 "b"))
   :sourceLifecycle "123e4567-e89b-42d3-a456-426614174000"
   :nativeSourceId "223e4567-e89b-42d3-a456-426614174000"
   :revisionWatermark 42
   :logicalResourceCount 10000
   :mutationPolicy "immutable-after-publication"})

(def complete-memory-sample
  {:heapUsedBytes 100
   :heapCommittedBytes 200
   :heapMaxBytes 400
   :nonHeapUsedBytes 50
   :nonHeapCommittedBytes 75
   :directUsedBytes 25
   :mappedUsedBytes 30
   :rssBytes 600
   :nativeMappedBytes 300
   :openFileDescriptorCount 12
   :nativeHandleCount 3})

(defn error-data
  [thunk]
  (try
    (thunk)
    nil
    (catch clojure.lang.ExceptionInfo error
      (ex-data error))))

(defn request
  ([] (request {}))
  ([overrides]
   (merge
    {:deadlineEpochMs 1000
     :nowMs (constantly 0)
     :cancelled? (constantly false)
     :realize! identity}
    overrides)))

(defn fake-runtime
  ([] (fake-runtime {}))
  ([{:keys [close-result close-error memory-sample]
     :or {close-result true
          memory-sample complete-memory-sample}}]
   (let [active (atom 0)
         opens (atom 0)
         closes (atom 0)
         events (atom [])
         open!
         (fn []
           (let [snapshot {:owner (Thread/currentThread)
                           :closed? (atom false)}]
             (swap! opens inc)
             (swap! active inc)
             (swap! events conj :open)
             snapshot))
         close!
         (fn [snapshot]
           (swap! closes inc)
           (swap! events conj :close)
           (when close-error
             (throw (Exception. "sensitive native close failure")))
           (if (and close-result
                    (identical? (:owner snapshot) (Thread/currentThread))
                    (compare-and-set! (:closed? snapshot) false true))
             (do (swap! active dec) true)
             false))]
     {:active active
      :opens opens
      :closes closes
      :events events
      :use! (fn [snapshot]
              (when-not (identical? (:owner snapshot) (Thread/currentThread))
                (throw (ex-info "wrong thread" {:unsafe true})))
              (when @(:closed? snapshot)
                (throw (ex-info "closed" {:unsafe true})))
              :ok)
      :operations
      {:open-snapshot! open!
       :close-snapshot! close!
       :active-snapshot-info!
       (fn []
         {:active @active
          :oldest-age-ms (when (pos? @active) 0)})
       :memory-sample! (fn [] memory-sample)}})))

(defn ownership
  [control operations]
  (:ownership (runtime/telemetry! control operations)))

(deftest result-is-realized-before-exactly-once-release-test
  (let [{:keys [active opens closes events operations]} (fake-runtime)
        control (runtime/create-control! valid-state)
        result
        (runtime/invoke-with-owned-snapshot!
         control operations (request {:realize! vec})
         (fn [_]
           (map (fn [value]
                  (is (= 1 @active))
                  (swap! events conj [:realize value])
                  value)
                [1 2 3])))]
    (is (= [1 2 3] result))
    (is (= 1 @opens))
    (is (= 1 @closes))
    (is (= 0 @active))
    (is (= [:open [:realize 1] [:realize 2] [:realize 3] :close]
           @events))
    (is (= {:openedSnapshots 1
            :closedSnapshots 1
            :activeSnapshots 0
            :peakActiveSnapshots 1
            :acquisitionFailures 0
            :releaseFailures 0
            :requestFailures 0
            :cancellations 0
            :deadlineFailures 0
            :lastOwnerThreadId (.threadId (Thread/currentThread))}
           (ownership control operations)))))

(deftest every-post-acquisition-failure-releases-once-test
  (doseq [[expected-reason request-overrides]
          [[:response-realization-failed
            {:realize! (fn [_]
                         (throw (Exception. "sensitive realization failure")))}]
           [:request-cancelled
            (let [calls (atom 0)]
              {:cancelled? #(= 2 (swap! calls inc))})]
           [:request-deadline-exceeded
            (let [times (atom [0 1000])]
              {:nowMs (fn []
                        (let [now (first @times)]
                          (swap! times #(if (next %) (vec (next %)) %))
                          now))})]]]
    (let [{:keys [active closes operations]} (fake-runtime)
          control (runtime/create-control! valid-state)
          data (error-data
                #(runtime/invoke-with-owned-snapshot!
                  control operations (request request-overrides)
                  (constantly [1 2 3])))
          counters (ownership control operations)]
      (is (= :eacl-demo.datalevin/runtime-ownership-failed (:type data)))
      (is (= expected-reason (:reason data)))
      (is (not (contains? data :cause)))
      (is (= 1 @closes))
      (is (= 0 @active))
      (is (= 1 (:requestFailures counters)))
      (is (= (if (= :request-cancelled expected-reason) 1 0)
             (:cancellations counters)))
      (is (= (if (= :request-deadline-exceeded expected-reason) 1 0)
             (:deadlineFailures counters))))))

(deftest one-admitted-request-prevents-a-second-snapshot-test
  (let [{:keys [opens operations]} (fake-runtime)
        control (runtime/create-control! valid-state)
        entered (promise)
        continue (promise)
        first-request
        (future
          (runtime/invoke-with-owned-snapshot!
           control operations (request)
           (fn [_]
             (deliver entered true)
             @continue
             :first)))]
    (is (= true (deref entered 1000 :timeout)))
    (is (= :request-busy
           (:reason
            (error-data
             #(runtime/invoke-with-owned-snapshot!
               control operations (request) (constantly :second))))))
    (is (= 1 @opens))
    (deliver continue true)
    (is (= :first (deref first-request 1000 :timeout)))
    (is (= 1 @opens))))

(deftest cross-thread-use-fails-but-owner-thread-closes-test
  (let [{:keys [active closes operations use!]} (fake-runtime)
        control (runtime/create-control! valid-state)
        data
        (error-data
         #(runtime/invoke-with-owned-snapshot!
           control operations (request)
           (fn [snapshot]
             (let [child-error
                   @(future
                      (try
                        (use! snapshot)
                        nil
                        (catch Throwable error error)))]
               (when child-error
                 (throw child-error))
               :impossible))))]
    (is (= :request-work-failed (:reason data)))
    (is (not (contains? data :unsafe)))
    (is (= 1 @closes))
    (is (= 0 @active))))

(deftest snapshot-and-lazy-values-cannot-escape-the-scope-test
  (doseq [work [(fn [snapshot] snapshot)
                (fn [_] (map identity [1 2 3]))
                (fn [snapshot] {:nested [snapshot]})]]
    (let [{:keys [active closes operations]} (fake-runtime)
          control (runtime/create-control! valid-state)
          data
          (error-data
           #(runtime/invoke-with-owned-snapshot!
             control operations (request) work))]
      (is (= :unsafe-response-type (:reason data)))
      (is (= 1 @closes))
      (is (= 0 @active)))))

(deftest transport-values-are-copied-canonicalized-and-bounded-test
  (let [{:keys [operations]} (fake-runtime)
        control (runtime/create-control! valid-state)
        bytes (byte-array [1 2 3])
        result
        (runtime/invoke-with-owned-snapshot!
         control operations (request)
         (constantly {:plain "value" :qualified/key bytes}))]
    (is (= #{"plain" "qualified/key"} (set (keys result))))
    (is (= "value" (get result "plain")))
    (is (not (identical? bytes (get result "qualified/key"))))
    (is (= (seq bytes) (seq (get result "qualified/key")))))
  (doseq [[work expected-reason]
          [[(constantly {:same 1 "same" 2}) :duplicate-response-key]
           [(constantly (byte-array 5242881)) :response-byte-limit-exceeded]
           [(constantly {1 "unsafe"}) :unsafe-response-key]]]
    (let [{:keys [active closes operations]} (fake-runtime)
          data
          (error-data
           #(runtime/invoke-with-owned-snapshot!
             (runtime/create-control! valid-state)
             operations (request) work))]
      (is (= expected-reason (:reason data)))
      (is (= 1 @closes))
      (is (= 0 @active)))))

(deftest release-failure-is-primary-and-retains-leak-visibility-test
  (doseq [[configuration expected-reason]
          [[{:close-result false} :snapshot-not-owned-at-release]
           [{:close-error true} :snapshot-release-failed]]]
    (let [{:keys [active closes operations]} (fake-runtime configuration)
          control (runtime/create-control! valid-state)
          data
          (error-data
           #(runtime/invoke-with-owned-snapshot!
             control operations (request)
             (fn [_]
               (throw (Exception. "sensitive request failure")))))
          counters (ownership control operations)]
      (is (= expected-reason (:reason data)))
      (is (= true (:requestFailure data)))
      (is (= :request-work-failed (:requestFailureReason data)))
      (is (= 1 @closes))
      (is (= 1 @active))
      (is (= 1 (:activeSnapshots counters)))
      (is (= 1 (:releaseFailures counters)))
      (is (= 1 (:requestFailures counters)))
      (is (nil? @(:admission control))))))

(deftest telemetry-is-closed-complete-and-deployment-bound-test
  (let [{:keys [operations]} (fake-runtime)
        control (runtime/create-control! valid-state)
        telemetry (runtime/telemetry! control operations)]
    (is (= #{:schema :profileId :demoSha :eaclSha :artifactSha256
             :deploymentId :runtime :architecture :storageMode
             :maximumConcurrency :sourceLifecycle :nativeSourceId
             :revisionWatermark :snapshotStrategy :ownership :nativeReaders
             :memory :memoryComplete}
           (set (keys telemetry))))
    (is (= "eacl-demo.datalevin-runtime-telemetry.v1" (:schema telemetry)))
    (is (= (select-keys valid-state
                        [:demoSha :eaclSha :artifactSha256 :deploymentId
                         :runtime :architecture :storageMode
                         :maximumConcurrency :sourceLifecycle :nativeSourceId
                         :revisionWatermark :snapshotStrategy])
           (select-keys telemetry
                        [:demoSha :eaclSha :artifactSha256 :deploymentId
                         :runtime :architecture :storageMode
                         :maximumConcurrency :sourceLifecycle :nativeSourceId
                         :revisionWatermark :snapshotStrategy])))
    (is (= {:active 0 :oldest-age-ms nil} (:nativeReaders telemetry)))
    (is (= complete-memory-sample (:memory telemetry)))
    (is (true? (:memoryComplete telemetry))))
  (let [{:keys [operations]}
        (fake-runtime {:memory-sample
                       (assoc complete-memory-sample
                              :rssBytes nil
                              :nativeMappedBytes nil
                              :openFileDescriptorCount nil
                              :nativeHandleCount nil)})]
    (is (false?
         (:memoryComplete
          (runtime/telemetry! (runtime/create-control! valid-state)
                              operations))))))

(deftest malformed-callbacks-and-observations-fail-closed-test
  (let [{:keys [operations]} (fake-runtime)
        control (runtime/create-control! valid-state)]
    (doseq [[expected-reason changed-operations]
            [[:native-reader-info-failed
              (assoc operations :active-snapshot-info!
                     #(throw (Exception. "sensitive native failure")))]
             [:invalid-native-reader-info
              (assoc operations :active-snapshot-info!
                     (constantly {:active 0 :oldest-age-ms 1}))]
             [:memory-sample-failed
              (assoc operations :memory-sample!
                     #(throw (Exception. "sensitive memory failure")))]
             [:invalid-memory-sample
              (assoc operations :memory-sample!
                     (constantly (assoc complete-memory-sample
                                        :heapUsedBytes 500)))]]]
      (let [data (error-data #(runtime/telemetry! control changed-operations))]
        (is (= expected-reason (:reason data)))
        (is (= :eacl-demo.datalevin/runtime-ownership-failed (:type data)))
        (is (not (contains? data :value))))))
  (let [{:keys [operations]} (fake-runtime)
        control (runtime/create-control! valid-state)]
    (doseq [[expected-reason request-overrides]
            [[:invalid-clock {:nowMs (constantly -1)}]
             [:clock-read-failed
              {:nowMs #(throw (Exception. "sensitive clock failure"))}]
             [:invalid-cancellation-signal {:cancelled? (constantly :yes)}]
             [:cancellation-read-failed
              {:cancelled?
               #(throw (Exception. "sensitive cancellation failure"))}]]]
      (is (= expected-reason
             (:reason
              (error-data
               #(runtime/invoke-with-owned-snapshot!
                 control operations (request request-overrides)
                 (constantly :impossible)))))))))

(deftest virtual-thread-is-rejected-before-acquisition-test
  (let [{:keys [opens operations]} (fake-runtime)
        control (runtime/create-control! valid-state)
        result (promise)
        thread
        (Thread/startVirtualThread
         (reify Runnable
           (run [_]
             (deliver
              result
              (error-data
               #(runtime/invoke-with-owned-snapshot!
                 control operations (request) (constantly :impossible)))))))]
    (.join thread)
    (is (= :virtual-thread-rejected (:reason @result)))
    (is (= 0 @opens))))
