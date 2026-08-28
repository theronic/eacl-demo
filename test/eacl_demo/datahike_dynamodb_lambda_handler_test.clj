(ns eacl-demo.datahike-dynamodb-lambda-handler-test
  (:require [clojure.data.json :as json]
            [clojure.test :refer [deftest is use-fixtures]]
            [eacl-demo.contracts.build-identity :as build-identity]
            [eacl-demo.datahike-dynamodb.lambda-handler :as handler]))

(def baked-eacl-sha "11114f59fa57fe87c5b7ab412b3123a9c8a1a862")
(use-fixtures :each
  (fn [run]
    (with-redefs [build-identity/eacl-sha (constantly baked-eacl-sha)]
      (run))))

(def environment
  {"AWS_REGION" "us-east-1"
   "EACL_DATAHIKE_TABLE" "eacl-demo-datahike-dynamodb-test"
   "EACL_DATAHIKE_STORE_ID" "4e67bb31-557d-4f49-8b4c-699d39577310"
   "EACL_STORE_CACHE_SIZE" "1000"
   "EACL_SEARCH_CACHE_SIZE" "0"
   "EACL_MAXIMUM_CONCURRENCY" "1"
   "EACL_MAX_ATTEMPTS" "4"
   "EACL_BASE_DELAY_MS" "25"
   "EACL_MAX_DELAY_MS" "250"
   "EACL_ATTEMPT_TIMEOUT_MS" "3000"
   "EACL_CONNECT_TIMEOUT_MS" "1000"
   "EACL_CURSOR_KEY" (apply str (repeat 32 "k"))
   "EACL_DEMO_SHA" (apply str (repeat 40 "a"))
   "EACL_CORE_SHA" "11114f59fa57fe87c5b7ab412b3123a9c8a1a862"
   "EACL_ARTIFACT_SHA256" (apply str (repeat 64 "b"))
   "EACL_DEPLOYMENT_ID" "demo-test"
   "AWS_LAMBDA_FUNCTION_MEMORY_SIZE" "1024"})

(def basis
  {:behavior "request-snapshot"
   :id "datahike:536872941:6a7df54b-1cb0-5529-9aff-504a79627f73"
   :capturedAt "2026-08-26T00:00:00Z"
   :fixedForEnvironment false})

(defn event
  [path method body]
  {:version "2.0"
   :routeKey "$default"
   :rawPath path
   :rawQueryString ""
   :headers (if body {"content-type" "application/json"} {})
   :requestContext {:requestId "request-1" :http {:method method}}
   :isBase64Encoded false
   :body body
   :cookies nil})

(defn fake-reader
  [_config]
  {:capture-snapshot (fn [] {:value :immutable-snapshot
                             :basis basis
                             :release! (fn [])})})

(deftest closed-environment-builds-request-snapshot-reader-identity-test
  (let [parsed (handler/parse-environment environment)]
    (is (= "eacl-demo-datahike-dynamodb-test"
           (get-in parsed [:reader-config :table])))
    (is (= 0 (get-in parsed [:reader-config :search-cache-size])))
    (is (= 1 (get-in parsed [:reader-config :maximum-concurrency])))
    (is (= "datahike-dynamodb" (get-in parsed [:identity :profileId])))
    (is (= baked-eacl-sha (get-in parsed [:identity :eaclSha])))
    (is (= baked-eacl-sha
           (get-in (handler/parse-environment (dissoc environment "EACL_CORE_SHA"))
                   [:identity :eaclSha]))))
  (doseq [changed [(dissoc environment "EACL_CURSOR_KEY")
                   (assoc environment "EACL_CURSOR_KEY" "too-short")
                   (assoc environment "EACL_CORE_SHA"
                          (apply str (repeat 40 "0")))
                   (assoc environment "EACL_MAXIMUM_CONCURRENCY" "0")
                   (assoc environment "EACL_MAXIMUM_CONCURRENCY" "2")
                   (assoc environment "EACL_MAX_ATTEMPTS" "9")
                   (assoc environment "EACL_BASE_DELAY_MS" "500"
                                      "EACL_MAX_DELAY_MS" "25")
                   (assoc environment "EACL_ATTEMPT_TIMEOUT_MS" "49")
                   (assoc environment "EACL_SEARCH_CACHE_SIZE" "-1")
                   (assoc environment "EACL_DATAHIKE_TABLE" "bad table")
                   (assoc environment "EACL_DATAHIKE_STORE_ID" "not-a-uuid")
                   (assoc environment "EACL_ARTIFACT_SHA256" "not-a-digest")]]
    (is (thrown? clojure.lang.ExceptionInfo
                 (handler/parse-environment changed)))))

(deftest function-url-health-and-closed-route-responses-test
  (let [runtime (handler/initialize environment fake-reader)
        health (handler/handle-event
                runtime
                (event "/health" "GET" nil)
                10000)
        denied (handler/handle-event
                runtime
                (event "/seed" "POST" "{}")
                10000)
        health-body (json/read-str (:body health) :key-fn keyword)
        denied-body (json/read-str (:body denied) :key-fn keyword)]
    (is (= 200 (:statusCode health)))
    (is (= "ready" (get-in health-body [:data :status])))
    (is (= (:id basis) (get-in health-body [:meta :revision])))
    (is (= #{:data :meta} (set (keys health-body))))
    (is (= "enabled"
           (get-in runtime [:descriptor :runtime :snapStart])))
    (is (= 404 (:statusCode denied)))
    (is (= "route-not-found" (get-in denied-body [:error :code])))
    (is (= "demo-test" (get-in denied-body [:meta :revision])))
    (is (= #{:error :meta} (set (keys denied-body))))))

(deftest malformed-function-url-events-return-a-redacted-envelope-test
  (let [runtime (handler/initialize environment fake-reader)
        response (handler/handle-event
                  runtime
                  (assoc (event "/health" "GET" nil)
                         :unexpected "secret")
                  10000)
        body (json/read-str (:body response) :key-fn keyword)]
    (is (= 400 (:statusCode response)))
    (is (= "validation-error" (get-in body [:error :code])))
    (is (= "demo-test" (get-in body [:meta :revision])))
    (is (= #{:error :meta} (set (keys body))))
    (is (not (.contains ^String (:body response) "secret")))))

(deftest snapstart-primes-the-first-admin-resource-page-test
  (let [captured (atom [])
        running {:runtime :datahike-dynamodb}]
    (with-redefs [handler/handle-event
                  (fn [actual event remaining-ms]
                    (swap! captured conj {:runtime actual
                                          :event event
                                          :remaining-ms remaining-ms})
                    {:statusCode 200
                     :body (json/write-str
                            {:data {:items (mapv (fn [index] {:id (str index)})
                                                (range 10))}
                             :meta {:cacheStatus (if (= 1 (count @captured))
                                                   "miss"
                                                   "hit")}})})]
      (is (= running (handler/prime-runtime! running))))
    (is (= 256 (count @captured)))
    (is (every? #(= running (:runtime %)) @captured))
    (is (every? #(= 30000 (:remaining-ms %)) @captured))
    (is (every? #(= "/lookup-resources" (get-in % [:event :rawPath]))
                @captured))
    (is (= "snapstart-prime-lookup-resources"
           (get-in (first @captured)
                   [:event :requestContext :requestId])))
    (is (= {:subjectType "user"
            :subjectId "user-1"
            :resourceType "server"
            :permission "admin"
            :pageSize 10
            :cache true
            :populateCache true
            :consistency "minimize"}
           (json/read-str (get-in (first @captured) [:event :body])
                          :key-fn keyword)))))

(deftest snapstart-prime-requires-the-cache-to-converge-test
  (with-redefs [handler/handle-event
                (fn [_ _ _]
                  {:statusCode 200
                   :body (json/write-str
                          {:data {:items (mapv (fn [index] {:id (str index)})
                                              (range 10))}
                           :meta {:cacheStatus "miss"}})})]
    (is (thrown-with-msg?
         clojure.lang.ExceptionInfo
         #"cache did not converge"
         (handler/prime-runtime! {:runtime :datahike-dynamodb})))))
