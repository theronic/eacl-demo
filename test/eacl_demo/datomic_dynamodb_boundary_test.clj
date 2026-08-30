(ns eacl-demo.datomic-dynamodb-boundary-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.datomic-dynamodb.boundary :as boundary]))

(def profile-identity
  {:profileId "datomic-dynamodb"
   :demoSha (apply str (repeat 40 "a"))
   :eaclSha (apply str (repeat 40 "b"))
   :artifactSha256 (apply str (repeat 64 "c"))
   :deploymentId "deployment-test"
   :dataManifestSha256 (apply str (repeat 64 "d"))})

(def descriptor
  {:identity profile-identity
   :capabilities {:consistencyModes ["minimize" "authoritative" "at-least"
                                     "exact"]}
   :basis {:behavior "fixed-environment"
   :id "datomic:eacl-demo-datomic-generation-test:eacl-demo:424242"
           :capturedAt "2026-08-25T12:00:00Z"
           :fixedForEnvironment true}})

(def handlers
  (into {}
        (map (fn [operation]
               [operation (fn [{:keys [input snapshot remaining-ms]}]
                            {:operation operation
                             :input input
                             :snapshot snapshot
                             :remaining-ms (remaining-ms)})]))
        (keys boundary/method-by-operation)))

(defn request
  [consistency]
  {:path "/check-permission"
   :method :post
   :request-id "request-1"
   :deadline-ms 2000
   :input (cond-> {:subjectType "user" :subjectId "user-1"
                   :resourceType "account" :resourceId "account-0"
                   :permission "admin"}
            (some? consistency) (assoc :consistency consistency))})

(deftest supported-consistency-reaches-the-same-fixed-snapshot-test
  (let [captures (atom 0)
        releases (atom 0)
        profile
        (boundary/create-boundary
         {:descriptor descriptor
          :maximum-concurrency 1
          :clock (constantly 1000)
          :capture-snapshot (fn [_]
                              (swap! captures inc)
                              {:value :fixed-snapshot
                               :basis (:basis descriptor)
                               :release! #(swap! releases inc)})
          :handlers handlers})]
    (doseq [consistency [nil "minimize" "authoritative" "at-least" "exact"]]
      (let [response (boundary/invoke! profile (request consistency))]
        (is (contains? response :data))
        (is (not (contains? response :error)))
        (is (= #{:revision :requestId :elapsedMs}
               (set (keys (:meta response)))))
        (is (number? (get-in response [:meta :elapsedMs])))
        (is (= :fixed-snapshot (get-in response [:data :snapshot])))
        (is (= 1000 (get-in response [:data :remaining-ms])))
        (is (= "datomic:eacl-demo-datomic-generation-test:eacl-demo:424242"
               (get-in response [:meta :revision])))))
    (is (= 5 @captures))
    (is (= 5 @releases))))

(deftest synchronized-historical-and-future-modes-fail-before-snapshot-test
  (let [captures (atom 0)
        handler-calls (atom 0)
        rejecting-handlers
        (into {} (map (fn [operation]
                        [operation (fn [_] (swap! handler-calls inc))]))
              (keys boundary/method-by-operation))
        profile
        (boundary/create-boundary
         {:descriptor descriptor
          :capture-snapshot (fn [_]
                              (swap! captures inc)
                              {:value :forbidden
                               :basis (:basis descriptor)
                               :release! (fn [])})
          :handlers rejecting-handlers})]
    (doseq [consistency ["fully-consistent" "live-refresh" "future-sync-mode"]]
      (let [response (boundary/invoke! profile (request consistency))]
        (is (contains? response :error))
        (is (not (contains? response :data)))
        (is (= "unsupported-consistency" (get-in response [:error :code])))
        (is (= #{:revision :requestId} (set (keys (:meta response)))))))
    (is (= "validation-error"
           (get-in (boundary/invoke! profile (request "historical-date"))
                   [:error :code])))
    (is (zero? @captures))
    (is (zero? @handler-calls))))

(deftest malformed-consistency-fails-before-snapshot-test
  (let [captures (atom 0)
        profile (boundary/create-boundary
                 {:descriptor descriptor
                  :capture-snapshot (fn [_] (swap! captures inc))
                  :handlers handlers})
        response (boundary/invoke!
                  profile
                  (assoc-in (request nil) [:input :consistency] 42))]
    (is (= "validation-error" (get-in response [:error :code])))
    (is (zero? @captures))))

(deftest malformed-or-open-input-fails-before-snapshot-test
  (let [captures (atom 0)
        profile (boundary/create-boundary
                 {:descriptor descriptor
                  :capture-snapshot (fn [_] (swap! captures inc))
                  :handlers handlers})
        base (:input (request nil))]
    (doseq [input [(dissoc base :permission)
                   (assoc base :seed true)
                   (assoc base :resourceId "contains spaces")
                   (assoc base "consistency" "minimize")]]
      (is (= "validation-error"
             (get-in (boundary/invoke!
                      profile (assoc (request nil) :input input))
                     [:error :code]))))
    (is (zero? @captures))))

(deftest cleanup-failure-cannot-leak-admission-state-test
  (let [captures (atom 0)
        profile (boundary/create-boundary
                 {:descriptor descriptor
                  :maximum-concurrency 1
                  :clock (constantly 1000)
                  :capture-snapshot
                  (fn [_]
                    (swap! captures inc)
                    {:value :fixed-snapshot
                     :basis (:basis descriptor)
                     :release! #(throw (ex-info "release failed" {}))})
                  :handlers handlers})]
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"release failed"
                          (boundary/invoke! profile (request "minimize"))))
    (is (zero? (boundary/active-count profile)))
    ;; A released semaphore permits another call instead of leaving it queued.
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"release failed"
                          (boundary/invoke! profile (request "minimize"))))
    (is (= 2 @captures))))

(deftest admission-contention-waits-and-then-runs-test
  (let [entered (promise)
        continue (promise)
        captures (atom 0)
        releases (atom 0)
        calls (atom [])
        call-index (atom 0)
        waiting-handlers
        (assoc handlers "check-permission"
               (fn [_]
                 (let [index (swap! call-index inc)]
                   (swap! calls conj index)
                   (when (= 1 index)
                     (deliver entered true)
                     @continue))
                 {:allowed true}))
        profile
        (boundary/create-boundary
         {:descriptor descriptor
          :maximum-concurrency 1
          :capture-snapshot
          (fn [_]
            (swap! captures inc)
            {:value :fixed-snapshot
             :basis (:basis descriptor)
             :release! #(swap! releases inc)})
          :handlers waiting-handlers})
        deadline (+ (System/currentTimeMillis) 5000)
        marked-request
        (fn [request-id]
          (assoc (request "minimize")
                 :request-id request-id :deadline-ms deadline))
        first-call
        (future (boundary/invoke! profile
                                  (marked-request "request-first")))]
    @entered
    (let [second-call
          (future (boundary/invoke! profile
                                    (marked-request "request-second")))]
      (is (= ::waiting (deref second-call 100 ::waiting))
          "contention must queue instead of returning overloaded")
      (is (= 1 (boundary/active-count profile)))
      (is (= 1 @captures)
          "a queued request must not capture a Datomic snapshot")
      (deliver continue true)
      (is (contains? @first-call :data))
      (let [second-response (deref second-call 2000 ::timed-out)]
        (is (not= ::timed-out second-response))
        (is (contains? second-response :data))
        (is (not= "overloaded" (get-in second-response [:error :code])))))
    (is (= [1 2] @calls))
    (is (= 2 @captures))
    (is (= 2 @releases))
    (is (zero? (boundary/active-count profile)))))

(deftest admission-wait-honors-deadline-and-cancellation-test
  (let [entered (promise)
        continue (promise)
        captures (atom 0)
        waiting-handlers
        (assoc handlers "check-permission"
               (fn [_]
                 (deliver entered true)
                 @continue
                 {:allowed true}))
        profile
        (boundary/create-boundary
         {:descriptor descriptor
          :maximum-concurrency 1
          :capture-snapshot
          (fn [_]
            (swap! captures inc)
            {:value :fixed-snapshot
             :basis (:basis descriptor)
             :release! (fn [])})
          :handlers waiting-handlers})
        first-call
        (future
          (boundary/invoke!
           profile
           (assoc (request "minimize")
                  :request-id "request-holder"
                  :deadline-ms (+ (System/currentTimeMillis) 5000))))]
    @entered
    (try
      (let [deadline-call
            (future
              (boundary/invoke!
               profile
               (assoc (request "minimize")
                      :request-id "request-deadline"
                      :deadline-ms (+ (System/currentTimeMillis) 100))))
            deadline-response (deref deadline-call 2000 ::timed-out)]
        (is (not= ::timed-out deadline-response))
        (is (= "deadline-exceeded"
               (get-in deadline-response [:error :code])))
        (is (= 1 @captures)))
      (let [cancelled? (atom false)
            cancelled-call
            (future
              (boundary/invoke!
               profile
               (assoc (request "minimize")
                      :request-id "request-cancelled"
                      :deadline-ms (+ (System/currentTimeMillis) 5000)
                      :cancelled? #(deref cancelled?))))]
        (Thread/sleep 50)
        (reset! cancelled? true)
        (let [cancelled-response (deref cancelled-call 2000 ::timed-out)]
          (is (not= ::timed-out cancelled-response))
          (is (= "cancelled" (get-in cancelled-response [:error :code])))
          (is (= 1 @captures))))
      (finally
        (deliver continue true)
        (deref first-call 2000 ::timed-out)))
    (is (zero? (boundary/active-count profile)))))

(deftest ec2-historical-date-selects-a-request-basis-test
  (let [captured-input (atom nil)
        historical-basis {:behavior "request-snapshot"
                          :id "datomic:eacl-demo-datomic-generation-test:eacl-demo:400"
                          :capturedAt "2026-08-24T09:30:00Z"
                          :fixedForEnvironment false}
        profile
        (boundary/create-boundary
         {:descriptor (assoc-in descriptor [:capabilities :consistencyModes]
                                ["minimize" "authoritative" "at-least"
                                 "exact" "historical-date"])
          :clock (constantly 1000)
          :capture-snapshot
          (fn [input]
            (reset! captured-input input)
            {:value :historical-snapshot
             :basis historical-basis
             :release! (fn [])})
          :handlers handlers})
        response
        (boundary/invoke!
         profile
         (assoc (request "historical-date")
                :input (assoc (:input (request "historical-date"))
                              :atExactSnapshotAt
                              "2026-08-24T10:00:00Z")))]
    (is (= "historical-date" (:consistency @captured-input)))
    (is (= "2026-08-24T10:00:00Z" (:atExactSnapshotAt @captured-input)))
    (is (= :historical-snapshot (get-in response [:data :snapshot])))
    (is (= (:id historical-basis) (get-in response [:meta :revision])))))
