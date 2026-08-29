(ns eacl-demo.datahike-dynamodb-boundary-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.datahike-dynamodb.boundary :as boundary]
            [eacl-demo.datahike-dynamodb.context :as context]
            [eacl-demo.datahike-dynamodb.retry :as retry]))

(def descriptor
  {:identity {:profileId "datahike-dynamodb"
              :demoSha (apply str (repeat 40 "d"))
              :eaclSha (apply str (repeat 40 "e"))}})

(defn- request
  [operation method & [extra]]
  (merge {:request-id "request-1"
          :path (str "/" operation)
          :method method
          :deadline-ms Long/MAX_VALUE
          :cancelled? (constantly false)
          :input (if (= operation "check-permission")
                   {:subjectType "user" :subjectId "user-1"
                    :resourceType "account" :resourceId "account-0"
                    :permission "admin"}
                   {})}
         extra))

(defn- handlers
  [handler]
  (into {} (map (fn [operation] [operation handler]))
        (keys boundary/method-by-operation)))

(defn- fixture
  [handler]
  (boundary/create-boundary
   {:descriptor descriptor
    :maximum-concurrency 1
    :clock (constantly 100)
    :capture-snapshot
    (fn [] {:value :snapshot :basis {:id "basis"}
            :release! (fn [])})
    :handlers (handlers handler)}))

(deftest closed-route-and-method-table-test
  (let [service (fixture (constantly {:ok true}))]
    (let [response (boundary/invoke! service (request "check-permission" :post))]
      (is (contains? response :data))
      (is (not (contains? response :error)))
      (is (= #{:revision :requestId :elapsedMs}
             (set (keys (:meta response)))))
      (is (number? (get-in response [:meta :elapsedMs]))))
    (is (= "method-not-allowed"
           (get-in (boundary/invoke! service (request "check-permission" :get))
                   [:error :code])))
    (is (= "route-not-found"
           (get-in (boundary/invoke! service (request "seed" :post))
                   [:error :code])))
    (is (= "route-not-found"
           (get-in (boundary/invoke! service
                                     (request "authorize/extra" :post))
                   [:error :code])))))

(deftest unsupported-consistency-fails-before-snapshot-test
  (let [captures (atom 0)
        service
        (boundary/create-boundary
         {:descriptor descriptor
          :capture-snapshot (fn [] (swap! captures inc))
          :handlers (handlers (constantly {:ok true}))})]
    (doseq [mode ["authoritative" "historical-date" "future-mode"]]
      (let [input (cond-> {:subjectType "user"
                           :subjectId "user-1"
                           :resourceType "account"
                           :resourceId "account-0"
                           :permission "admin"
                           :consistency mode}
                    (= "historical-date" mode)
                    (assoc :atExactSnapshotAt "2026-08-26T00:00:00Z"))]
        (is (= "unsupported-consistency"
               (get-in (boundary/invoke!
                        service
                        (request "check-permission" :post {:input input}))
                       [:error :code])))))
    (is (zero? @captures))))

(deftest malformed-or-open-input-fails-before-snapshot-test
  (let [captures (atom 0)
        service
        (boundary/create-boundary
         {:descriptor descriptor
          :capture-snapshot (fn [] (swap! captures inc))
          :handlers (handlers (constantly {:ok true}))})
        base {:subjectType "user" :subjectId "user-1"
              :resourceType "account" :resourceId "account-0"
              :permission "admin"}]
    (doseq [input [(dissoc base :permission)
                   (assoc base :transaction [])
                   (assoc base :subjectId "contains spaces")
                   (assoc base "consistency" "minimize")]]
      (is (= "validation-error"
             (get-in (boundary/invoke!
                      service (request "check-permission" :post {:input input}))
                     [:error :code]))))
    (is (zero? @captures))))

(deftest storage-error-codes-and-request-lifetime-propagate-test
  (testing "deep retries see the exact request cancellation/deadline context"
    (let [captured (atom nil)
          service
          (fixture
           (fn [_]
             (reset! captured (context/current))
             {:ok true}))
          cancelled? (constantly false)
          response (boundary/invoke!
                    service
                    (request "check-permission" :post
                             {:deadline-ms 900 :cancelled? cancelled?}))]
      (is (contains? response :data))
      (is (= 900 (:deadline-ms @captured)))
      (is (identical? cancelled? (:cancelled? @captured)))))

  (testing "a typed dependency error remains typed in the public envelope"
    (let [service
          (fixture
           (fn [_]
             (throw (ex-info "throttle"
                             {:type :eacl-demo/dynamodb-error
                              :code "throttled"
                              :category :throttled
                              :retryable true}))))
          response (boundary/invoke! service (request "check-permission" :post))]
      (is (= "throttled" (get-in response [:error :code])))
      (is (= "A dependency throttled the request."
             (get-in response [:error :message])))
      (is (= #{:code :message} (set (keys (:error response)))))))

  (testing "late cancellation wins over a handler success"
    (let [cancelled (atom false)
          service (fixture (fn [_] (reset! cancelled true) {:late true}))
          response
          (boundary/invoke!
           service
           (request "check-permission" :post {:cancelled? #(deref cancelled)}))]
      (is (= "cancelled" (get-in response [:error :code]))))))

(deftest snapshot-release-and-admission-cleanup-are-exact-test
  (let [releases (atom 0)
        service
        (boundary/create-boundary
         {:descriptor descriptor
          :maximum-concurrency 1
          :capture-snapshot
          (fn [] {:value :snapshot :basis {:id "basis"}
                  :release! #(swap! releases inc)})
          :handlers (handlers (fn [_] (throw (RuntimeException. "boom"))))})
        response (boundary/invoke! service (request "check-permission" :post))]
    (is (= "internal-error" (get-in response [:error :code])))
    (is (= 1 @releases))
    (is (zero? (boundary/active-count service)))))

(deftest cleanup-failure-cannot-leak-admission-test
  (let [service
        (boundary/create-boundary
         {:descriptor descriptor
          :maximum-concurrency 1
          :capture-snapshot
          (fn [] {:value :snapshot :basis {:id "basis"}
                  :release! #(throw (ex-info "release failed" {}))})
          :handlers (handlers (constantly {:ok true}))})]
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"release failed"
                          (boundary/invoke! service (request "check-permission" :post))))
    (is (zero? (boundary/active-count service)))
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"release failed"
                          (boundary/invoke! service (request "check-permission" :post))))))
