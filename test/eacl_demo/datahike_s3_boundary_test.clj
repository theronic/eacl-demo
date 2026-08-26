(ns eacl-demo.datahike-s3-boundary-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.contracts.response-meta :as response-meta]
            [eacl-demo.datahike-s3.boundary :as boundary]))

(def identity
  {:profileId "datahike-s3"
   :demoSha (apply str (repeat 40 "a"))
   :eaclSha (apply str (repeat 40 "b"))
   :artifactSha256 (apply str (repeat 64 "c"))
   :deploymentId "candidate-1"
   :dataManifestSha256 (apply str (repeat 64 "d"))})

(def descriptor
  (boundary/descriptor
   {:identity identity
    :runtime {:execution "lambda" :name "java25" :architecture "arm64"
              :snapStart "disabled"}
    :dataset {:fixtureId "legacy-datahike-s3-unattested"
              :logicalResourceCount 1001584
              :manifestSha256 (apply str (repeat 64 "d"))}
    :basis {:behavior "request-snapshot" :id "basis-1"
            :capturedAt "2026-08-25T12:00:00Z"
            :fixedForEnvironment false}
    :capabilities {:operations ["health" "bootstrap" "authorize"]
                   :consistencyModes ["current"]
                   :snapshotBehavior "request-snapshot"
                   :cacheBehavior "environment-local"
                   :mutationLocality "none"
                   :limitations ["read-only" "unequal-dataset-scale"]}
    :limits [{:name "requestDeadlineMs" :value 30000}]}))

(defn request
  ([operation method]
   (request operation method {}))
  ([operation method extra]
   (merge {:path (str boundary/profile-prefix "/" operation)
           :method method
           :request-id (str "request-" operation)
           :deadline-ms Long/MAX_VALUE
           :cancelled? (constantly false)
           :input (if (= operation "authorize")
                    {:subjectType "user" :subjectId "user-1"
                     :resourceType "account" :resourceId "account-0"
                     :permission "admin"}
                    {})}
          extra)))

(defn configured-boundary
  [overrides]
  (let [release-count (atom 0)
        handlers (into {}
                       (map (fn [operation]
                              [operation (fn [{:keys [check-active!]}]
                                           (check-active!)
                                           {:operation operation})]))
                       ["health" "bootstrap" "list-subjects" "get-object"
                        "list-relationships" "reverse-relationships" "authorize"
                        "lookup-resources" "lookup-subjects" "count-resources"
                        "get-schema" "get-cache-info" "count-objects"])]
    {:release-count release-count
     :boundary
     (boundary/create-boundary
      (merge {:descriptor descriptor
              :capture-snapshot
              (fn [] {:value {:immutable true}
                      :basis {:id "basis-1"}
                      :release! #(swap! release-count inc)})
              :handlers handlers
              :maximum-concurrency 1}
             overrides))}))

(deftest closed-prefix-envelope-and-snapshot-test
  (let [{:keys [boundary release-count]} (configured-boundary {})
        result (boundary/invoke! boundary (request "authorize" :post))]
    (is (:ok result))
    (is (= "authorize" (get-in result [:meta :operation])))
    (is (= identity (get-in result [:meta :identity])))
    (is (= #{:contractVersion :operation :requestId :identity :basis :elapsedMs}
           (set (keys (:meta result)))))
    (is (number? (get-in result [:meta :elapsedMs])))
    (is (= {:id "basis-1"} (get-in result [:meta :basis])))
    (is (= 1 @release-count))
    (is (zero? (boundary/active-count boundary)))
    (is (= "route-not-found"
           (get-in (boundary/invoke!
                    boundary (assoc (request "seed" :post)
                                    :path "/api/v1/datahike-s3/seed"))
                   [:error :code])))
    (is (= "route-not-found"
           (get-in (boundary/invoke!
                    boundary (assoc (request "authorize" :post)
                                    :path "/api/v1/datahike-s3/authorize/"))
                   [:error :code])))
    (is (= "method-not-allowed"
           (get-in (boundary/invoke! boundary (request "authorize" :get))
                   [:error :code])))))

(deftest timing-and-cache-metadata-reach-the-wire-envelope-test
  (let [operations ["health" "bootstrap" "list-subjects" "get-object"
                    "list-relationships" "reverse-relationships" "authorize"
                    "lookup-resources" "lookup-subjects" "count-resources"
                    "get-schema" "get-cache-info" "count-objects"]
        handlers (into {}
                       (map (fn [operation]
                              [operation
                               (fn [_]
                                 (response-meta/with-cache-status
                                  {:operation operation}
                                  {:cached? true}
                                  true))]))
                       operations)
        {service :boundary} (configured-boundary {:handlers handlers})
        result (boundary/invoke! service (request "authorize" :post))]
    (is (= "hit" (get-in result [:meta :cacheStatus])))
    (is (number? (get-in result [:meta :elapsedMs])))
    (is (= {:operation "authorize"} (:data result)))))

(deftest unsupported-consistency-fails-before-snapshot-test
  (let [{:keys [boundary release-count]} (configured-boundary {})]
    (doseq [mode ["minimize" "authoritative" "at-least" "exact"
                  "historical-date" "future-mode"]]
      (is (= "unsupported-consistency"
             (get-in (boundary/invoke!
                      boundary
                      (request "authorize" :post
                               {:input {:subjectType "user" :subjectId "user-1"
                                        :resourceType "account"
                                        :resourceId "account-0"
                                        :permission "admin"
                                        :consistency mode}}))
                     [:error :code]))))
    (is (zero? @release-count))))

(deftest malformed-or-open-input-fails-before-snapshot-test
  (let [{:keys [boundary release-count]} (configured-boundary {})
        base {:subjectType "user" :subjectId "user-1"
              :resourceType "account" :resourceId "account-0"
              :permission "admin"}]
    (doseq [input [(dissoc base :permission)
                   (assoc base :seed true)
                   (assoc base :subjectId (apply str (repeat 257 "a")))
                   (assoc base "consistency" "current")]]
      (is (= "validation-error"
             (get-in (boundary/invoke!
                      boundary (request "authorize" :post {:input input}))
                     [:error :code]))))
    (is (zero? @release-count))))

(deftest cleanup-failure-cannot-leak-admission-test
  (let [{service :boundary}
        (configured-boundary
         {:capture-snapshot
          (fn [] {:value :snapshot :basis {:id "basis"}
                  :release! #(throw (ex-info "release failed" {}))})})]
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"release failed"
                          (boundary/invoke! service (request "authorize" :post))))
    (is (zero? (boundary/active-count service)))
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"release failed"
                          (boundary/invoke! service (request "authorize" :post))))))

(deftest cancellation-deadline-and-cleanup-test
  (let [cancelled (atom true)
        first (configured-boundary {})
        cancelled-result
        (boundary/invoke! (:boundary first)
                          (request "authorize" :post
                                   {:cancelled? #(deref cancelled)}))
        deadline (configured-boundary {:clock (constantly 100)})
        deadline-result
        (boundary/invoke! (:boundary deadline)
                          (request "authorize" :post {:deadline-ms 100}))]
    (is (= "cancelled" (get-in cancelled-result [:error :code])))
    (is (zero? @(:release-count first))
        "cancellation before capture has no snapshot to release")
    (is (= "deadline-exceeded" (get-in deadline-result [:error :code])))
    (is (zero? @(:release-count deadline)))
    (is (zero? (boundary/active-count (:boundary first))))
    (is (zero? (boundary/active-count (:boundary deadline))))))

(deftest admission-is-nonblocking-and-every-snapshot-releases-once-test
  (let [entered (promise)
        continue (promise)
        {:keys [boundary release-count]}
        (configured-boundary
         {:handlers
          (into {}
                (map (fn [operation]
                       [operation
                        (if (= operation "authorize")
                          (fn [{:keys [check-active!]}]
                            (deliver entered true)
                            @continue
                            (check-active!)
                            {:allowed true})
                          (fn [_] {:operation operation}))]))
                ["health" "bootstrap" "list-subjects" "get-object"
                 "list-relationships" "reverse-relationships" "authorize"
                 "lookup-resources" "lookup-subjects" "count-resources"
                 "get-schema" "get-cache-info" "count-objects"])})
        first (future (boundary/invoke! boundary (request "authorize" :post)))]
    @entered
    (let [overloaded (boundary/invoke! boundary (request "health" :get))]
      (is (= "overloaded" (get-in overloaded [:error :code])))
      (is (= 1 (boundary/active-count boundary))))
    (deliver continue true)
    (is (:ok @first))
    (is (= 1 @release-count))
    (is (zero? (boundary/active-count boundary)))))
