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
   :basis {:behavior "fixed-environment"
   :id "datomic:eacl-demo-datomic-generation-test:eacl-demo:424242"
           :capturedAt "2026-08-25T12:00:00Z"
           :fixedForEnvironment true}})

(def handlers
  (into {}
        (map (fn [operation]
               [operation (fn [{:keys [input snapshot]}]
                            {:operation operation
                             :input input
                             :snapshot snapshot})]))
        (keys boundary/method-by-operation)))

(defn request
  [consistency]
  {:path "/api/v1/datomic-dynamodb/authorize"
   :method :post
   :request-id "request-1"
   :deadline-ms 2000
   :input (cond-> {:subjectType "user" :subjectId "user-1"
                   :resourceType "account" :resourceId "account-0"
                   :permission "admin"}
            (some? consistency) (assoc :consistency consistency))})

(deftest only-fixed-current-consistency-reaches-snapshot-and-handler-test
  (let [captures (atom 0)
        releases (atom 0)
        profile
        (boundary/create-boundary
         {:descriptor descriptor
          :maximum-concurrency 1
          :clock (constantly 1000)
          :capture-snapshot (fn []
                              (swap! captures inc)
                              {:value :fixed-snapshot
                               :basis (:basis descriptor)
                               :release! #(swap! releases inc)})
          :handlers handlers})]
    (doseq [consistency [nil "current" "minimize"]]
      (let [response (boundary/invoke! profile (request consistency))]
        (is (true? (:ok response)))
        (is (= #{:contractVersion :operation :requestId :identity :basis :elapsedMs}
               (set (keys (:meta response)))))
        (is (number? (get-in response [:meta :elapsedMs])))
        (is (= :fixed-snapshot (get-in response [:data :snapshot])))
        (is (= "datomic:eacl-demo-datomic-generation-test:eacl-demo:424242"
               (get-in response [:meta :basis :id])))))
    (is (= 3 @captures))
    (is (= 3 @releases))))

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
          :capture-snapshot (fn []
                              (swap! captures inc)
                              {:value :forbidden
                               :basis (:basis descriptor)
                               :release! (fn [])})
          :handlers rejecting-handlers})]
    (doseq [consistency ["authoritative" "at-least" "exact"
                         "historical-date" "fully-consistent" "live-refresh"
                         "future-sync-mode"]]
      (let [response (boundary/invoke! profile (request consistency))]
        (is (false? (:ok response)))
        (is (= "unsupported-consistency" (get-in response [:error :code])))
        (is (nil? (get-in response [:meta :basis])))))
    (is (zero? @captures))
    (is (zero? @handler-calls))))

(deftest malformed-consistency-fails-before-snapshot-test
  (let [captures (atom 0)
        profile (boundary/create-boundary
                 {:descriptor descriptor
                  :capture-snapshot (fn [] (swap! captures inc))
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
                  :capture-snapshot (fn [] (swap! captures inc))
                  :handlers handlers})
        base (:input (request nil))]
    (doseq [input [(dissoc base :permission)
                   (assoc base :seed true)
                   (assoc base :resourceId "contains spaces")
                   (assoc base "consistency" "current")]]
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
                  (fn []
                    (swap! captures inc)
                    {:value :fixed-snapshot
                     :basis (:basis descriptor)
                     :release! #(throw (ex-info "release failed" {}))})
                  :handlers handlers})]
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"release failed"
                          (boundary/invoke! profile (request "current"))))
    (is (zero? (boundary/active-count profile)))
    ;; A released semaphore permits another call instead of reporting overload.
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"release failed"
                          (boundary/invoke! profile (request "current"))))
    (is (= 2 @captures))))
