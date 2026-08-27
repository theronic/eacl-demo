(ns eacl-demo.contracts.function-url
  "AWS Lambda Function URL v2 normalization and bounded JSON responses."
  (:require [clojure.data.json :as json]
            [clojure.string :as str]
            [eacl-demo.contracts.http :as http])
  (:import [java.nio.charset StandardCharsets]
           [java.util Base64]))

(def ^:private maximum-request-body-bytes 65536)
(def ^:private maximum-response-body-bytes 1048576)
(def ^:private event-keys
  #{:version :routeKey :rawPath :rawQueryString :headers :requestContext
    :isBase64Encoded :body :cookies})
(def ^:private base64-pattern #"[A-Za-z0-9+/]*={0,2}")

(def ^:private status-by-code
  {"validation-error" 400
   "request-too-large" 413
   "method-not-allowed" 405
   "route-not-found" 404
   "unsupported-media-type" 415
   "cursor-invalid" 400
   "cursor-expired" 410
   "cursor-scope-mismatch" 409
   "unsupported-consistency" 422
   "freshness-unavailable" 409
   "cancelled" 499
   "deadline-exceeded" 504
   "overloaded" 503
   "throttled" 429
   "dependency-unavailable" 503
   "storage-missing" 503
   "storage-corrupt" 503
   "identity-mismatch" 409
   "response-too-large" 500
   "internal-error" 500})

(declare rejected decode-body parse-input encode-envelope json-safe byte-count)

(defn event-request-id
  "Returns the same bounded request ID for normal and rejected Function URL events."
  [event]
  (let [headers (:headers event)
        client-request-id
        (when (map? headers)
          (some (fn [[key value]]
                  (when (and (or (string? key) (keyword? key))
                             (= "x-eacl-request-id"
                                (str/lower-case (name key))))
                    value))
                headers))
        aws-request-id (get-in event [:requestContext :requestId])]
    (cond
      (http/valid-request-id? client-request-id) client-request-id
      (http/valid-request-id? aws-request-id) aws-request-id
      :else "invalid")))

(defn normalize-event
  "Converts one closed Function URL v2 event into the internal JVM request.
  JSON is decoded only after transport limits and media type checks pass."
  [event]
  (cond
    (not (map? event)) (rejected "validation-error")
    (not= event-keys (into event-keys (keys event)))
    (rejected "validation-error")
    (not= "2.0" (:version event)) (rejected "validation-error")
    (not (map? (:headers event))) (rejected "validation-error")
    (not (map? (:requestContext event))) (rejected "validation-error")
    (not (every? #(or (string? %) (keyword? %)) (keys (:headers event))))
    (rejected "validation-error")
    :else
    (let [http (get-in event [:requestContext :http])
          method (when (string? (:method http))
                   (-> (:method http) str/lower-case keyword))
          headers (into {} (map (fn [[key value]]
                                  [(str/lower-case (name key)) value]))
                        (:headers event))
          request-id (event-request-id event)
          body-result (decode-body (:body event) (:isBase64Encoded event))]
      (cond
        (not (map? http)) (rejected "validation-error")
        (not (string? (:method http))) (rejected "validation-error")
        (not (http/valid-request-id? request-id)) (rejected "validation-error")
        (not (:ok? body-result)) body-result
        (not (string? (:rawPath event))) (rejected "validation-error")
        (not (string? (:rawQueryString event))) (rejected "validation-error")
        (not-empty (:rawQueryString event)) (rejected "validation-error")
        :else
        (let [body (:body body-result)
              get? (= method :get)
              content-type (get headers "content-type")]
          (cond
            (and get? (or (some? content-type)
                          (not (or (nil? body) (= "" body)))))
            (rejected "unsupported-media-type")

            (and (some? content-type) (not (string? content-type)))
            (rejected "unsupported-media-type")

            (and (not get?)
                 (not (contains? #{"application/json"
                                   "application/json; charset=utf-8"}
                                 (some-> content-type str/lower-case))))
            (rejected "unsupported-media-type")

            :else
            (let [input-result (if get?
                                 {:ok? true :input {}}
                                 (parse-input body))]
              (if-not (:ok? input-result)
                input-result
                {:ok? true
                 :request {:path (:rawPath event)
                           :method method
                           :request-id request-id
                           :input (:input input-result)}}))))))))

(defn create-response
  "Serializes one explorer envelope into a bounded Function URL response."
  ([envelope]
   (create-response envelope nil))
  ([envelope allowed-method]
   (let [body (encode-envelope envelope)
         code (get-in envelope [:error :code])
         status (if (and (contains? envelope :data)
                         (not (contains? envelope :error)))
                  200
                  (get status-by-code code 500))
         headers (cond-> {"content-type" "application/json; charset=utf-8"
                          "cache-control" "no-store"
                          "x-content-type-options" "nosniff"}
                   (and (= 405 status) (keyword? allowed-method))
                   (assoc "allow" (str/upper-case (name allowed-method))))]
     {:statusCode status
      :headers headers
      :body body
      :isBase64Encoded false})))

(defn internal-error-response
  "Produces the same compact public failure shape when a handler itself fails."
  [event revision]
  (create-response
   {:error {:code "internal-error"
            :message "The request failed internally."}
    :meta {:revision (if (and (string? revision)
                              (not-empty revision)
                              (<= (byte-count revision) 256))
                       revision
                       "invalid")
           :requestId (event-request-id event)}}))

(defn- parse-input
  [body]
  (cond
    (not (string? body)) (rejected "validation-error")
    (> (byte-count body) maximum-request-body-bytes)
    (rejected "request-too-large")
    :else
    (try
      (let [value (json/read-str body :key-fn keyword)]
        (if (map? value)
          {:ok? true :input value}
          (rejected "validation-error")))
      (catch Throwable _
        (rejected "validation-error")))))

(defn- decode-body
  [body encoded?]
  (cond
    (false? encoded?) {:ok? true :body body}
    (not (true? encoded?)) (rejected "validation-error")
    (not (string? body)) (rejected "validation-error")
    (not (re-matches base64-pattern body)) (rejected "validation-error")
    :else
    (try
      (let [decoded (.decode (Base64/getDecoder) ^String body)]
        (if (> (alength decoded) maximum-request-body-bytes)
          (rejected "request-too-large")
          {:ok? true :body (String. decoded StandardCharsets/UTF_8)}))
      (catch IllegalArgumentException _
        (rejected "validation-error")))))

(defn- encode-envelope
  [envelope]
  (let [body (json/write-str (json-safe envelope))]
    (if (<= (byte-count body) maximum-response-body-bytes)
      body
      (json/write-str
       (json-safe
        {:meta (:meta envelope)
         :error {:code "response-too-large"
                 :message "The bounded response could not be produced."}})))))

(defn- json-safe
  [value]
  (cond
    (keyword? value) (name value)
    (symbol? value) (str value)
    (map? value) (into {} (map (fn [[key item]]
                                 [(if (keyword? key) (name key) (str key))
                                  (json-safe item)])) value)
    (set? value) (mapv json-safe (sort-by str value))
    (sequential? value) (mapv json-safe value)
    :else value))

(defn- byte-count
  [value]
  (alength (.getBytes ^String value StandardCharsets/UTF_8)))

(defn- rejected
  [code]
  {:ok? false :code code})
