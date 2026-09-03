(ns eacl-demo.datalevin-memory-lambda-handler-test
  (:require [clojure.test :refer [deftest is use-fixtures]]
            [eacl-demo.contracts.build-identity :as build-identity]
            [eacl-demo.datalevin-memory.http-server :as http-server]
            [eacl-demo.datalevin-memory.lambda-handler :as handler])
  (:import [java.net URI]
           [java.net.http HttpClient HttpRequest HttpRequest$BodyPublishers
            HttpResponse$BodyHandlers]))

(def baked-eacl-sha "21e661e09988dca6e416454dd7a29321076c17ac")

(use-fixtures :each
  (fn [run]
    (with-redefs [build-identity/eacl-sha (constantly baked-eacl-sha)]
      (run))))

(def environment
  {"EACL_CURSOR_KEY" (apply str (repeat 32 "k"))
   "EACL_DEMO_SHA" (apply str (repeat 40 "a"))
   "EACL_CORE_SHA" baked-eacl-sha
   "EACL_ARTIFACT_SHA256" (apply str (repeat 64 "b"))
   "EACL_DEPLOYMENT_ID" "demo-test"
   "EACL_DATALEVIN_DIRECTORY" "/tmp/eacl-demo-datalevin-handler-test"
   "AWS_LAMBDA_FUNCTION_MEMORY_SIZE" "1024"})

(deftest environment-distinguishes-lambda-and-ec2-test
  (let [lambda (handler/parse-environment environment)
        ec2 (handler/parse-environment
             (-> environment
                 (dissoc "AWS_LAMBDA_FUNCTION_MEMORY_SIZE")
                 (assoc "EACL_RUNTIME_EXECUTION" "ec2"
                        "EACL_RUNTIME_MEMORY_MIB" "1024"
                        "EACL_MAXIMUM_CONCURRENCY" "1")))]
    (is (= "lambda" (:execution lambda)))
    (is (= "/tmp/eacl-demo-datalevin-handler-test"
           (str (:database-directory lambda))))
    (is (= 1 (:maximum-concurrency lambda)))
    (is (= "ec2" (:execution ec2)))
    (is (= 1 (:maximum-concurrency ec2)))
    (is (= 1024 (:memory-mib ec2)))
    (is (= baked-eacl-sha
           (get-in (handler/parse-environment
                    (assoc environment "EACL_CORE_SHA"
                           (apply str (repeat 40 "0"))))
                   [:identity :eaclSha]))))
  (doseq [changed [(assoc environment "EACL_RUNTIME_EXECUTION" "container")
                   (-> environment
                       (dissoc "AWS_LAMBDA_FUNCTION_MEMORY_SIZE")
                       (assoc "EACL_RUNTIME_EXECUTION" "ec2"
                              "EACL_RUNTIME_MEMORY_MIB" "1024"))]]
    (is (thrown? clojure.lang.ExceptionInfo
                 (handler/parse-environment changed)))))

(deftest ec2-http-adapter-preserves-the-closed-boundary-and-cors-test
  (let [seen (atom nil)
        running
        (http-server/start-server!
         0
         (fn [request _remaining-time-ms]
           (reset! seen request)
           {:statusCode 200
            :headers {"content-type" "application/json; charset=utf-8"}
            :body "{}"})
         1)
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
        (is (= "/health" (:rawPath @seen))))
      (let [request (-> (HttpRequest/newBuilder
                         (URI/create (str origin "/lookup-resources")))
                        (.method "OPTIONS" (HttpRequest$BodyPublishers/noBody))
                        (.build))
            response (.send client request (HttpResponse$BodyHandlers/ofString))]
        (is (= 204 (.statusCode response))))
      (finally
        (http-server/stop-server! running)))))
