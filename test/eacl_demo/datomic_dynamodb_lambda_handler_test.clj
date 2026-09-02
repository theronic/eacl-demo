(ns eacl-demo.datomic-dynamodb-lambda-handler-test
  (:require [clojure.data.json :as json]
            [clojure.test :refer [deftest is use-fixtures]]
            [eacl-demo.contracts.build-identity :as build-identity]
            [eacl-demo.contracts.cache-metrics :as cache-metrics]
            [eacl-demo.datomic-dynamodb.boundary :as boundary]
            [eacl-demo.datomic-dynamodb.http-server :as http-server]
            [eacl-demo.datomic-dynamodb.lambda-handler :as handler]
            [eacl-demo.datomic-dynamodb.reader :as reader])
  (:import [java.net URI]
           [java.net.http HttpClient HttpRequest HttpRequest$BodyPublishers
            HttpResponse$BodyHandlers]))

(def baked-eacl-sha "340b355915bf752afb0ee52a323c3c89e11f247e")
(use-fixtures :each
  (fn [run]
    (with-redefs [build-identity/eacl-sha (constantly baked-eacl-sha)]
      (run))))

(def environment
  {"AWS_REGION" "us-east-1"
   "EACL_DATOMIC_TABLE" "eacl-demo-datomic-fixture-v1-green"
   "EACL_DATOMIC_DATABASE" "eacl-demo"
   "EACL_MAXIMUM_CONCURRENCY" "2"
   "EACL_CURSOR_KEY" (apply str (repeat 32 "k"))
   "EACL_DEMO_SHA" (apply str (repeat 40 "a"))
   "EACL_CORE_SHA" "340b355915bf752afb0ee52a323c3c89e11f247e"
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
   :capture-snapshot (fn [& _] {:value :fixed-snapshot
                                :basis basis
                                :release! (fn [])})})

(deftest closed-environment-builds-fixed-reader-identity-test
  (let [parsed (handler/parse-environment environment)]
    (is (= "eacl-demo-datomic-fixture-v1-green"
           (get-in parsed [:reader-config :table])))
    (is (= 2 (get-in parsed [:reader-config :maximum-concurrency])))
    (is (= "datomic-dynamodb" (get-in parsed [:identity :profileId])))
    (is (= baked-eacl-sha (get-in parsed [:identity :eaclSha])))
    (is (= baked-eacl-sha
           (get-in (handler/parse-environment (dissoc environment "EACL_CORE_SHA"))
                   [:identity :eaclSha])))
    (is (= baked-eacl-sha
           (get-in (handler/parse-environment
                    (assoc environment "EACL_CORE_SHA"
                           (apply str (repeat 40 "0"))))
                   [:identity :eaclSha])))
    (is (= "lambda" (:execution parsed))))
  (let [parsed (handler/parse-environment
                (-> environment
                    (dissoc "AWS_LAMBDA_FUNCTION_MEMORY_SIZE")
                    (assoc "EACL_RUNTIME_EXECUTION" "ec2"
                           "EACL_RUNTIME_MEMORY_MIB" "1024")))]
    (is (= "ec2" (:execution parsed)))
    (is (= 1024 (:memory-mib parsed))))
  (doseq [changed [(dissoc environment "EACL_CURSOR_KEY")
                   (assoc environment "EACL_MAXIMUM_CONCURRENCY" "0")
                   (assoc environment "EACL_ARTIFACT_SHA256" "not-a-digest")
                   (assoc environment "EACL_RUNTIME_EXECUTION" "container")]]
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
    (is (= baked-eacl-sha
           (get-in health-body [:data :identity :eaclSha])))
    (is (= (:id basis) (get-in health-body [:meta :revision])))
    (is (= #{:data :meta} (set (keys health-body))))
    (is (= "enabled"
           (get-in runtime [:descriptor :runtime :snapStart])))
    (is (= 404 (:statusCode denied)))
    (is (= "route-not-found" (get-in denied-body [:error :code])))
    (is (= "demo-test" (get-in denied-body [:meta :revision])))
    (is (= #{:error :meta} (set (keys denied-body))))))

(deftest warmup-compiles-both-canonical-cache-hit-paths-test
  (let [calls (atom {})
        requests (atom {})
        operation-metrics (cache-metrics/create-operation-metrics)
        running {:boundary ::boundary
                 :descriptor {:identity {}}
                 :operation-metrics operation-metrics}]
    (with-redefs
     [boundary/invoke!
      (fn [actual request]
        (when-not (= ::boundary actual)
          (throw (ex-info "unexpected boundary" {})))
        (swap! calls update (:path request) (fnil inc 0))
        (swap! requests assoc (:path request) request)
        (case (:path request)
          "/lookup-resources"
          {:data {:items (mapv (fn [index] {:id (str index)}) (range 64))
                  :pageInfo {:hasNextPage false
                             :endCursor nil
                             :pageSize 64}}
           :meta {:cacheStatus "hit"}}

          "/count-resources"
          {:data {:kind "objects" :value 64 :exact true :ceiling 1000}
           :meta {:cacheStatus "hit"}}))]
      (is (= running (handler/warm-hot-path! running))))
    (is (= 20000 @#'handler/hot-path-warmup-iterations))
    ;; Ten thousand direct calls plus one full Function URL verification per
    ;; operation exercises both the timed boundary and transport metrics.
    (is (= {"/lookup-resources" 10001
            "/count-resources" 10001}
           @calls))
    (is (= {:subjectType "user" :subjectId "user-1"
            :resourceType "server" :permission "view"
            :pageSize 100 :cache true :populateCache true
            :consistency "minimize"}
           (get-in @requests ["/lookup-resources" :input])))
    (is (= 1000 (get-in @requests ["/count-resources" :input :ceiling])))
    (let [metrics (cache-metrics/operation-snapshot operation-metrics)]
      (is (= 1 (get-in metrics ["lookup-resources" :count])))
      (is (= 1 (get-in metrics ["count-resources" :count]))))))

(deftest lambda-and-persistent-ec2-startup-warm-before-serving-test
  (let [warmed (atom [])
        lambda-runtime {:descriptor {:runtime {:execution "lambda"}}}
        ec2-runtime {:descriptor {:runtime {:execution "ec2"}}}]
    (with-redefs [handler/warm-hot-path! #(swap! warmed conj %)]
      (is (= ec2-runtime (#'handler/prepare-runtime! ec2-runtime)))
      (is (= lambda-runtime (#'handler/prepare-runtime! lambda-runtime)))
      (is (= [ec2-runtime lambda-runtime] @warmed)))))

(deftest failed-hot-path-warmup-closes-either-process-reader-test
  (doseq [execution ["lambda" "ec2"]]
    (let [closed (atom [])
          fixed-reader (keyword (str execution "-reader"))
          running {:reader fixed-reader
                   :descriptor {:runtime {:execution execution}}}]
      (with-redefs [handler/warm-hot-path!
                    (fn [_] (throw (ex-info "warmup failed" {})))
                    reader/close-reader! #(swap! closed conj %)]
        (is (thrown-with-msg? clojure.lang.ExceptionInfo #"warmup failed"
                              (#'handler/prepare-runtime! running))))
      (is (= [fixed-reader] @closed)))))

(deftest runtime-close-delegates-to-the-process-reader-test
  (let [closed (atom [])]
    (with-redefs [reader/close-reader! #(swap! closed conj %)]
      (is (nil? (handler/close-runtime! {:reader :fixed-reader})))
      (is (= [:fixed-reader] @closed)))))

(deftest failed-runtime-construction-closes-the-opened-reader-test
  (let [close-calls (atom 0)
        opened {:basis {}
                :capture-snapshot (fn [& _] :unused)
                :close! #(swap! close-calls inc)}]
    (is (thrown-with-msg?
         clojure.lang.ExceptionInfo
         #"Invalid Datomic/DynamoDB profile descriptor input"
         (handler/initialize environment (constantly opened))))
    (is (= 1 @close-calls))))

(deftest hot-path-warmup-requires-both-caches-to-converge-test
  (with-redefs [boundary/invoke!
                (fn [_ request]
                  (case (:path request)
                    "/lookup-resources"
                    {:data {:items (vec (repeat 64 {}))
                            :pageInfo {:pageSize 64}}
                     :meta {:cacheStatus "miss"}}

                    "/count-resources"
                    {:data {:value 64 :exact true :ceiling 1000}
                     :meta {:cacheStatus "miss"}}))]
    (is (thrown-with-msg?
         clojure.lang.ExceptionInfo
         #"cache did not converge"
         (handler/warm-hot-path!
          {:boundary ::boundary
           :descriptor {:identity {}}
           :operation-metrics (cache-metrics/create-operation-metrics)})))))

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

(deftest ec2-http-adapter-preserves-the-closed-boundary-and-cors-test
  (let [seen (atom nil)
        running
        (http-server/start-server!
         0
         (fn [request _remaining-time-ms]
           (reset! seen request)
           {:statusCode 200
            :headers {"content-type" "application/json; charset=utf-8"}
            :body "{}"}))
        client (HttpClient/newHttpClient)
        origin (str "http://127.0.0.1:" (:port running))]
    (try
      (let [request (-> (HttpRequest/newBuilder
                         (URI/create (str origin "/health")))
                        (.header "x-eacl-request-id" "http-test")
                        (.GET)
                        (.build))
            response (.send client request (HttpResponse$BodyHandlers/ofString))]
        (is (= 200 (.statusCode response)))
        (is (= "https://demo.eacl.dev"
               (.orElse (.firstValue (.headers response)
                                     "access-control-allow-origin")
                        "missing")))
        (is (= "/health" (:rawPath @seen)))
        (is (= "GET" (get-in @seen [:requestContext :http :method]))))
      (let [request (-> (HttpRequest/newBuilder
                         (URI/create (str origin "/lookup-resources")))
                        (.method "OPTIONS" (HttpRequest$BodyPublishers/noBody))
                        (.build))
            response (.send client request (HttpResponse$BodyHandlers/ofString))]
        (is (= 204 (.statusCode response))))
      (finally
        (http-server/stop-server! running)))))

(deftest ec2-http-contention-queues-all-requests-before-snapshot-capture-test
  (let [entered (promise)
        continue (promise)
        captures (atom 0)
        releases (atom 0)
        calls (atom 0)
        ec2-environment
        (-> environment
            (dissoc "AWS_LAMBDA_FUNCTION_MEMORY_SIZE")
            (assoc "EACL_RUNTIME_EXECUTION" "ec2"
                   "EACL_RUNTIME_MEMORY_MIB" "1024"
                   "EACL_MAXIMUM_CONCURRENCY" "1"))
        runtime
        (handler/initialize
         ec2-environment
         (fn [_]
           {:basis basis
            :capture-snapshot
            (fn [& _]
              (swap! captures inc)
              {:value :fixed-snapshot
               :basis basis
               :release! #(swap! releases inc)})}))
        runtime
        (assoc-in
         runtime [:boundary :handlers "check-permission"]
         (fn [_]
           (let [index (swap! calls inc)]
             (when (= 1 index)
               (deliver entered true)
               @continue)
             {:allowed true})))
        running
        (http-server/start-server!
         0 #(handler/handle-event runtime %1 %2))
        client (HttpClient/newHttpClient)
        origin (str "http://127.0.0.1:" (:port running))
        body (json/write-str
              {:subjectType "user" :subjectId "user-1"
               :resourceType "account" :resourceId "account-0"
               :permission "admin" :consistency "minimize"})
        create-request
        (fn [index]
          (-> (HttpRequest/newBuilder
               (URI/create (str origin "/check-permission")))
              (.header "content-type" "application/json")
              (.header "x-eacl-request-id" (str "http-queue-" index))
              (.POST (HttpRequest$BodyPublishers/ofString body))
              (.build)))
        send #(-> client
                  (.sendAsync (create-request %)
                              (HttpResponse$BodyHandlers/ofString)))]
    (try
      (let [first-response (send 1)]
        (is (= true (deref entered 2000 ::timed-out)))
        (let [waiting-responses (mapv send (range 2 65))]
          (Thread/sleep 100)
          (is (every? #(not (.isDone %)) waiting-responses)
              "all contending HTTP requests must still be queued")
          (is (= 1 @captures)
              "queued HTTP requests must not capture Datomic snapshots")
          (deliver continue true)
          (let [responses (mapv #(.join %) (into [first-response]
                                                 waiting-responses))
                envelopes (mapv #(json/read-str (.body %) :key-fn keyword)
                                responses)]
            (is (every? #(= 200 (.statusCode %)) responses))
            (is (every? #(true? (get-in % [:data :allowed])) envelopes))
            (is (every? #(not= "overloaded" (get-in % [:error :code]))
                        envelopes)))))
      (finally
        (deliver continue true)
        (http-server/stop-server! running)))
    (is (= 64 @calls))
    (is (= 64 @captures))
    (is (= 64 @releases))))
