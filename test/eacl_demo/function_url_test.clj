(ns eacl-demo.function-url-test
  (:require [clojure.data.json :as json]
            [clojure.test :refer [deftest is testing]]
            [eacl-demo.contracts.function-url :as function-url])
  (:import [java.util Base64]))

(defn event
  [path method body]
  {:version "2.0"
   :routeKey "$default"
   :rawPath path
   :rawQueryString ""
   :headers (if body {"Content-Type" "application/json"} {})
   :requestContext {:requestId "request-1" :http {:method method}}
   :isBase64Encoded false
   :body body})

(deftest function-url-event-normalization-test
  (is (= {:ok? true
          :request {:path "/api/v1/datomic-dynamodb/health"
                    :method :get :request-id "request-1" :input {}}}
         (function-url/normalize-event
          (event "/api/v1/datomic-dynamodb/health" "GET" nil))))
  (let [body (json/write-str {:subjectType "user" :subjectId "user-1"
                              :resourceType "account"
                              :resourceId "account-0"
                              :permission "admin"})
        normalized (function-url/normalize-event
                    (event "/api/v1/datomic-dynamodb/authorize" "POST" body))]
    (is (:ok? normalized))
    (is (= "user-1" (get-in normalized [:request :input :subjectId]))))
  (is (= "browser-7-2"
         (get-in (function-url/normalize-event
                  (assoc-in (event "/api/v1/datomic-dynamodb/health"
                                   "GET" nil)
                            [:headers "X-EACL-Request-ID"] "browser-7-2"))
                 [:request :request-id])))
  (is (= "request-1"
         (get-in (function-url/normalize-event
                  (assoc-in (event "/api/v1/datomic-dynamodb/health"
                                   "GET" nil)
                            [:headers "X-EACL-Request-ID"] ""))
                 [:request :request-id])))
  (let [body "{\"type\":\"server\",\"id\":\"server-1\"}"
        encoded (.encodeToString (Base64/getEncoder) (.getBytes body "UTF-8"))]
    (is (= "server-1"
           (get-in (function-url/normalize-event
                    (assoc (event "/api/v1/datomic-dynamodb/get-object"
                                  "POST" encoded)
                           :isBase64Encoded true))
                   [:request :input :id])))))

(deftest malformed-transport-fails-before-boundary-test
  (doseq [[expected malformed]
          [["validation-error" (assoc (event "/api/v1/datomic-dynamodb/health"
                                             "GET" nil)
                                      :unexpected true)]
           ["validation-error" (assoc (event "/api/v1/datomic-dynamodb/health"
                                             "GET" nil)
                                      :rawQueryString "debug=true")]
           ["unsupported-media-type" (event "/api/v1/datomic-dynamodb/authorize"
                                             "POST" nil)]
           ["validation-error" (assoc (event "/api/v1/datomic-dynamodb/authorize"
                                             "POST" "***")
                                      :isBase64Encoded true)]
           ["validation-error" (event "/api/v1/datomic-dynamodb/authorize"
                                       "POST" "[]")]]]
    (is (= expected (:code (function-url/normalize-event malformed))))))

(deftest bounded-function-url-response-test
  (let [base {:meta {:contractVersion "explorer.v1" :operation "authorize"
                     :requestId "r" :identity {} :basis nil}}
        success (function-url/create-response
                 (assoc base :ok true :data {:allowed true}))
        failure (function-url/create-response
                 (assoc base :ok false
                        :error {:code "method-not-allowed"
                                :message "The HTTP method is not allowed."
                                :retryable false :details []})
                 :post)
        oversized (function-url/create-response
                   (assoc base :ok true :data {:value (apply str (repeat 1048576 "a"))}))]
    (is (= 200 (:statusCode success)))
    (is (= "no-store" (get-in success [:headers "cache-control"])))
    (is (= 405 (:statusCode failure)))
    (is (= "POST" (get-in failure [:headers "allow"])))
    (is (= "response-too-large"
           (get-in (json/read-str (:body oversized) :key-fn keyword)
                   [:error :code])))))
