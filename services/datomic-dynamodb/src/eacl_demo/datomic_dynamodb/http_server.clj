(ns eacl-demo.datomic-dynamodb.http-server
  "Bounded http-kit EC2 adapter for the fixed Datomic/DynamoDB reader."
  (:gen-class)
  (:require [clojure.string :as str]
            [eacl-demo.contracts.function-url :as function-url]
            [eacl-demo.datomic-dynamodb.lambda-handler :as handler]
            [org.httpkit.server :as http-kit])
  (:import [java.io InputStream]
           [java.nio.charset StandardCharsets]
           [java.util UUID]))

(def ^:private maximum-request-body-bytes 65536)
(def ^:private maximum-header-line-bytes 8192)
(def ^:private default-port 8080)
(def ^:private cors-origin "https://demo.eacl.dev")

(declare handle-request parse-positive-int request-event ring-response)

(defn start-server!
  "Start the bounded http-kit adapter. The injectable arity exists for
  contract tests; production invokes the shared Datomic runtime boundary."
  ([port]
   (start-server! port handler/invoke-event!))
  ([port invoke!]
   (when-not (and (int? port) (<= 0 port 65535) (fn? invoke!))
     (throw (ex-info "Invalid Datomic HTTP server configuration."
                     {:type :eacl-demo/invalid-http-server})))
   (let [server
         (http-kit/run-server
          #(handle-request invoke! %)
          {:ip "0.0.0.0"
           :port port
           :max-body (inc maximum-request-body-bytes)
           :max-line maximum-header-line-bytes
           ;; http-kit 2.9 uses virtual threads on Java 21+ by default. Keep
           ;; that choice explicit: admission waits must not consume a bounded
           ;; platform-thread pool while the fair semaphore is contended.
           :pool-opts {:allow-virtual? true}
           :server-header nil
           :legacy-return-value? false})]
     {:server server
      :port (http-kit/server-port server)})))

(defn stop-server!
  [{:keys [server]}]
  (when-let [stopped (and server
                          (http-kit/server-stop! server {:timeout 1000}))]
    (deref stopped 2000 nil))
  nil)

(defn- handle-request
  [invoke! request]
  (let [event* (atom nil)]
    (try
      (let [event (request-event request)]
        (reset! event* event)
        (ring-response
         (if (= :options (:request-method request))
           {:statusCode 204 :headers {} :body ""}
           (invoke! event 30000))))
      (catch Throwable _
        (ring-response
         (function-url/internal-error-response
          @event* "ec2-http-adapter"))))))

(defn- request-event
  [{:keys [request-method uri query-string headers body]}]
  (let [method (-> request-method name str/upper-case)
        body-bytes (when (and (not= :get request-method) body)
                     (.readNBytes ^InputStream body
                                  (inc maximum-request-body-bytes)))
        body (when body-bytes
               (String. ^bytes body-bytes StandardCharsets/UTF_8))]
    {:version "2.0"
     :rawPath uri
     :rawQueryString (or query-string "")
     :headers (into {}
                    (map (fn [[key value]]
                           [(str/lower-case (name key)) value]))
                    headers)
     :requestContext
     {:requestId (str (UUID/randomUUID))
      :http {:method method}}
     :isBase64Encoded false
     :body body}))

(defn- ring-response
  [{:keys [statusCode headers body]}]
  (let [status (if (and (integer? statusCode) (<= 100 statusCode 599))
                 statusCode 500)
        body (if (string? body) body "")
        headers (merge headers
                       {"access-control-allow-origin" cors-origin
                        "access-control-allow-methods"
                        "GET, POST, OPTIONS"
                        "access-control-allow-headers"
                        "accept, content-type, x-eacl-request-id"
                        "vary" "Origin"})]
    {:status status :headers headers :body (when-not (= 204 status) body)}))

(defn -main
  [& _arguments]
  (let [environment (System/getenv)
        port (or (parse-positive-int (get environment "EACL_HTTP_PORT"))
                 default-port)
        ;; Fail the process before binding the port when the retained Datomic
        ;; reader cannot be opened. systemd can then retry transient boot-time
        ;; credential/network races instead of serving permanent health 500s
        ;; from a live process whose delayed initialization has failed.
        _ (handler/initialize-runtime!)
        running (start-server! port handler/invoke-event!)]
    (.addShutdownHook
     (Runtime/getRuntime)
     (Thread.
      #(try
         ;; Stop new admission first. Reader leases then keep the fixed
         ;; Snapshot alive until every request already inside the boundary has
         ;; released it.
         (stop-server! running)
         (finally
           (handler/close-runtime!)))
      "eacl-demo-http-shutdown"))
    (println (str "Datomic/DynamoDB EC2 reader listening on port "
                  (:port running)))
    (flush)))

(defn- parse-positive-int
  [value]
  (when (and (string? value) (re-matches #"[1-9][0-9]{0,8}" value))
    (try
      (let [parsed (Integer/parseInt value)]
        (when (pos-int? parsed) parsed))
      (catch NumberFormatException _ nil))))
