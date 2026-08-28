(ns eacl-demo.datalevin-memory.http-server
  "Bounded EC2 HTTP adapter for the immutable Datalevin reader."
  (:gen-class)
  (:require [clojure.string :as str]
            [eacl-demo.contracts.function-url :as function-url]
            [eacl-demo.datalevin-memory.lambda-handler :as handler])
  (:import [com.sun.net.httpserver HttpExchange HttpHandler HttpServer]
           [java.net InetSocketAddress]
           [java.nio.charset StandardCharsets]
           [java.util UUID]
           [java.util.concurrent Executors]))

(def ^:private maximum-request-body-bytes 65536)
(def ^:private default-port 8081)
(def ^:private default-workers 1)
(def ^:private cors-origin "https://demo.eacl.dev")

(declare exchange-event handle-exchange! parse-positive-int write-response!)

(defn start-server!
  ([port]
   (start-server! port handler/invoke-event! default-workers))
  ([port invoke! workers]
   (when-not (and (int? port) (<= 0 port 65535)
                  (fn? invoke!) (pos-int? workers))
     (throw (ex-info "Invalid Datalevin HTTP server configuration."
                     {:type :eacl-demo/invalid-http-server})))
   (let [server (HttpServer/create (InetSocketAddress. port) 0)
         executor (Executors/newFixedThreadPool workers)]
     (.createContext
      server "/"
      (reify HttpHandler
        (handle [_ exchange]
          (handle-exchange! invoke! exchange))))
     (.setExecutor server executor)
     (.start server)
     {:server server
      :executor executor
      :port (.getPort (.getAddress server))})))

(defn stop-server!
  [{:keys [^HttpServer server executor]}]
  (when server (.stop server 1))
  (when executor (.shutdownNow executor))
  nil)

(defn- handle-exchange!
  [invoke! ^HttpExchange exchange]
  (try
    (if (= "OPTIONS" (.getRequestMethod exchange))
      (write-response! exchange {:statusCode 204 :headers {} :body ""})
      (write-response! exchange (invoke! (exchange-event exchange) 30000)))
    (catch Throwable _
      (write-response!
       exchange
       (function-url/internal-error-response
        (try (exchange-event exchange) (catch Throwable _ nil))
        "ec2-http-adapter")))
    (finally
      (.close exchange))))

(defn- exchange-event
  [^HttpExchange exchange]
  (let [method (.getRequestMethod exchange)
        body-bytes (when-not (= "GET" method)
                     (.readNBytes (.getRequestBody exchange)
                                  (inc maximum-request-body-bytes)))
        body (when body-bytes
               (String. ^bytes body-bytes StandardCharsets/UTF_8))
        uri (.getRequestURI exchange)]
    {:version "2.0"
     :rawPath (.getRawPath uri)
     :rawQueryString (or (.getRawQuery uri) "")
     :headers (into {}
                    (map (fn [[key values]]
                           [(str/lower-case key) (first values)]))
                    (.entrySet (.getRequestHeaders exchange)))
     :requestContext
     {:requestId (str (UUID/randomUUID))
      :http {:method method}}
     :isBase64Encoded false
     :body body}))

(defn- write-response!
  [^HttpExchange exchange {:keys [statusCode headers body]}]
  (let [status (if (and (integer? statusCode) (<= 100 statusCode 599))
                 statusCode 500)
        body (if (string? body) body "")
        bytes (.getBytes ^String body StandardCharsets/UTF_8)
        response-headers (.getResponseHeaders exchange)]
    (doseq [[key value] headers]
      (.set response-headers key value))
    (.set response-headers "access-control-allow-origin" cors-origin)
    (.set response-headers "access-control-allow-methods" "GET, POST, OPTIONS")
    (.set response-headers "access-control-allow-headers"
          "accept, content-type, x-eacl-request-id")
    (.set response-headers "vary" "Origin")
    (if (= 204 status)
      (.sendResponseHeaders exchange status -1)
      (do
        (.sendResponseHeaders exchange status (alength bytes))
        (with-open [output (.getResponseBody exchange)]
          (.write output bytes))))))

(defn -main
  [& _arguments]
  (let [environment (System/getenv)
        port (or (parse-positive-int (get environment "EACL_HTTP_PORT"))
                 default-port)
        workers (or (parse-positive-int (get environment "EACL_HTTP_WORKERS"))
                    default-workers)
        _ (handler/initialize-runtime!)
        running (start-server! port handler/invoke-event! workers)]
    (.addShutdownHook
     (Runtime/getRuntime)
     (Thread. #(stop-server! running) "eacl-demo-datalevin-http-shutdown"))
    (println (str "Datalevin/Memory EC2 reader listening on port "
                  (:port running)))
    (flush)))

(defn- parse-positive-int
  [value]
  (when (and (string? value) (re-matches #"[1-9][0-9]{0,8}" value))
    (try
      (let [parsed (Integer/parseInt value)]
        (when (pos-int? parsed) parsed))
      (catch NumberFormatException _ nil))))
