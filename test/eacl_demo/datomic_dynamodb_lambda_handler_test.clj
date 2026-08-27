(ns eacl-demo.datomic-dynamodb-lambda-handler-test
  (:require [clojure.data.json :as json]
            [clojure.test :refer [deftest is]]
            [eacl-demo.datomic-dynamodb.lambda-handler :as handler]))

(def environment
  {"AWS_REGION" "us-east-1"
   "EACL_DATOMIC_TABLE" "eacl-demo-datomic-fixture-v1-green"
   "EACL_DATOMIC_DATABASE" "eacl-demo"
   "EACL_MAXIMUM_CONCURRENCY" "2"
   "EACL_CURSOR_KEY" (apply str (repeat 32 "k"))
   "EACL_DEMO_SHA" (apply str (repeat 40 "a"))
   "EACL_CORE_SHA" "8dc3b16498788dd822b68e1c4fe25b37a8e8879f"
   "EACL_ARTIFACT_SHA256" (apply str (repeat 64 "b"))
   "EACL_DEPLOYMENT_ID" "demo-test"
   "AWS_LAMBDA_FUNCTION_MEMORY_SIZE" "1024"})

(def basis
  {:behavior "fixed-environment"
   :id "datomic:eacl-demo-datomic-fixture-v1-green:eacl-demo:42"
   :capturedAt "2026-08-25T12:00:00Z"
   :fixedForEnvironment true})

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
  {:basis basis
   :capture-snapshot (fn [] {:value :fixed-snapshot
                             :basis basis
                             :release! (fn [])})})

(deftest closed-environment-builds-fixed-reader-identity-test
  (let [parsed (handler/parse-environment environment)]
    (is (= "eacl-demo-datomic-fixture-v1-green"
           (get-in parsed [:reader-config :table])))
    (is (= 2 (get-in parsed [:reader-config :maximum-concurrency])))
    (is (= "datomic-dynamodb" (get-in parsed [:identity :profileId]))))
  (doseq [changed [(dissoc environment "EACL_CURSOR_KEY")
                   (assoc environment "EACL_CORE_SHA" (apply str (repeat 40 "0")))
                   (assoc environment "EACL_MAXIMUM_CONCURRENCY" "0")
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
    (is (= 404 (:statusCode denied)))
    (is (= "route-not-found" (get-in denied-body [:error :code])))
    (is (= "demo-test" (get-in denied-body [:meta :revision])))
    (is (= #{:error :meta} (set (keys denied-body))))))

(deftest malformed-function-url-events-return-compact-redacted-envelope-test
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
