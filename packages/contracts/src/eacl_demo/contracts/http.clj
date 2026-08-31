(ns eacl-demo.contracts.http
  "Closed, bounded internal request validation shared by JVM profiles."
  (:import [java.nio.charset StandardCharsets]))

(def ^:private maximum-request-id-bytes 128)
(def ^:private maximum-identifier-bytes 256)
(def ^:private maximum-cursor-bytes 4096)
(def ^:private maximum-page-size 1000)
(def ^:private maximum-count-ceiling 1000000)

(def ^:private consistency-fields
  #{:consistency :atLeastAsFreshAs :atLeastAsFreshBasisId
    :atLeastAsFreshBasisCapturedAt :atExactSnapshotAt})

(def ^:private identifier-pattern
  #"[A-Za-z0-9][A-Za-z0-9._:@/-]*")

(def ^:private fields-by-operation
  {"health" {:required #{} :optional #{}}
   "bootstrap" {:required #{} :optional #{}}
   "list-subjects" {:required #{} :optional #{:type :pageSize :cursor}}
   "get-object" {:required #{:type :id} :optional consistency-fields}
   "list-relationships"
   {:required #{:resourceType :resourceId}
    :optional (into #{:relation :pageSize :cursor :cache :populateCache} consistency-fields)}
   "reverse-relationships"
   {:required #{:subjectType :subjectId}
    :optional (into #{:relation :pageSize :cursor :cache :populateCache} consistency-fields)}
   "check-permission"
   {:required #{:subjectType :subjectId :resourceType :resourceId :permission}
    :optional (into #{:cache :populateCache} consistency-fields)}
   "lookup-resources"
   {:required #{:subjectType :subjectId :resourceType :permission}
    :optional (into #{:pageSize :cursor :cache :populateCache} consistency-fields)}
   "lookup-subjects"
   {:required #{:resourceType :resourceId :subjectType :permission}
    :optional (into #{:pageSize :cursor :cache :populateCache} consistency-fields)}
   "count-resources"
   {:required #{:subjectType :subjectId :resourceType :permission}
    :optional (into #{:ceiling :cache :populateCache} consistency-fields)}
   "get-schema" {:required #{} :optional consistency-fields}
   "get-cache-info" {:required #{} :optional #{}}
   "count-objects"
   {:required #{:kind} :optional (into #{:type :ceiling} consistency-fields)}})

(defn valid-request-id?
  [value]
  (and (string? value)
       (not-empty value)
       (<= (alength (.getBytes ^String value StandardCharsets/UTF_8))
           maximum-request-id-bytes)))

(defn success-envelope
  "The original Explorer response contract shared by every backend."
  ([request identity basis data]
   (success-envelope request identity basis data nil nil))
  ([request identity basis data elapsed-ms cache-status]
   {:data data
    :meta (cond-> {:revision (or (:id basis) (:deploymentId identity))
                   :requestId (:request-id request)}
            (some? elapsed-ms) (assoc :elapsedMs elapsed-ms)
            (some? cache-status) (assoc :cacheStatus cache-status))}))

(defn failure-envelope
  "The original compact Explorer error contract shared by every backend."
  [request identity basis code]
  {:error {:code code
           :message (case code
                      "route-not-found" "The route is not available."
                      "method-not-allowed" "The HTTP method is not allowed."
                      "unsupported-consistency" "The consistency mode is not supported."
                      "freshness-unavailable" "The requested freshness floor is unavailable."
                      "cancelled" "The request was cancelled."
                      "deadline-exceeded" "The request deadline was exceeded."
                      "overloaded" "The profile has reached its admission limit."
                      "throttled" "A dependency throttled the request."
                      "dependency-unavailable" "A required dependency is unavailable."
                      "storage-missing" "Required immutable storage data is missing."
                      "storage-corrupt" "Required immutable storage data failed integrity checks."
                      "internal-error" "The request failed internally."
                      "The request is invalid.")}
   :meta {:revision (or (:id basis) (:deploymentId identity))
          :requestId (:request-id request)}})

(declare value-error)

(defn normalize-input
  "Validates one already-decoded request body and returns a keyword-keyed map.
  String keys are accepted only as an unmixed internal test/adapter form; mixed
  string/keyword keys are rejected so aliases cannot smuggle duplicate fields."
  [operation input supported-consistency]
  (let [{:keys [required optional]} (get fields-by-operation operation)]
    (cond
      (nil? required)
      {:ok? false :code "route-not-found"}

      (not (map? input))
      {:ok? false :code "validation-error"}

      (> (count input) 32)
      {:ok? false :code "validation-error"}

      :else
      (let [raw-keys (keys input)
            keyword-keys? (every? keyword? raw-keys)
            string-keys? (every? string? raw-keys)]
        (if-not (or keyword-keys? string-keys?)
          {:ok? false :code "validation-error"}
          (let [normalized (if keyword-keys?
                             input
                             (into {} (map (fn [[key value]]
                                             [(keyword key) value])) input))
                keys* (set (keys normalized))
                allowed (into required optional)]
            (cond
              (not (every? keys* required))
              {:ok? false :code "validation-error"}

              (not (every? allowed keys*))
              {:ok? false :code "validation-error"}

              :else
              (if-let [code (or (when (and (or (contains? normalized :atLeastAsFreshAs)
                                                (contains? normalized :atLeastAsFreshBasisId)
                                                (contains? normalized :atLeastAsFreshBasisCapturedAt))
                                           (not= "at-least" (:consistency normalized)))
                                  "validation-error")
                                (when (and (contains? normalized :atLeastAsFreshBasisId)
                                           (not (contains? normalized :atLeastAsFreshAs)))
                                  "validation-error")
                                (when (and (contains? normalized :atLeastAsFreshBasisCapturedAt)
                                           (not (and (contains? normalized :atLeastAsFreshAs)
                                                     (contains? normalized :atLeastAsFreshBasisId))))
                                  "validation-error")
                                (when (and (contains? normalized :atExactSnapshotAt)
                                           (not= "historical-date" (:consistency normalized)))
                                  "validation-error")
                                (when (and (= "historical-date" (:consistency normalized))
                                           (not (contains? normalized :atExactSnapshotAt)))
                                  "validation-error")
                                (value-error normalized supported-consistency))]
                {:ok? false :code code}
                {:ok? true :input normalized}))))))))

(defn- value-error
  [input supported-consistency]
  (some
   (fn [[key value]]
     (cond
       (= key :pageSize)
       (when-not (and (pos-int? value) (<= value maximum-page-size))
         "validation-error")

       (= key :ceiling)
       (when-not (and (pos-int? value) (<= value maximum-count-ceiling))
         "validation-error")

       (= key :cursor)
       (when-not (and (string? value)
                      (not-empty value)
                      (<= (alength (.getBytes ^String value StandardCharsets/UTF_8))
                          maximum-cursor-bytes))
         "validation-error")

       (contains? #{:cache :populateCache} key)
       (when-not (instance? Boolean value)
         "validation-error")

       (= key :consistency)
       (cond
         (not (string? value)) "validation-error"
         (not (contains? supported-consistency value)) "unsupported-consistency"
         :else nil)

       (contains? #{:atLeastAsFreshAs :atLeastAsFreshBasisCapturedAt
                    :atExactSnapshotAt} key)
       (when-not (and (string? value)
                      (<= (alength (.getBytes ^String value StandardCharsets/UTF_8)) 64)
                      (try
                        (java.time.Instant/parse value)
                        true
                        (catch Exception _ false)))
         "validation-error")

       (= key :atLeastAsFreshBasisId)
       (when-not (and (string? value)
                      (<= (alength (.getBytes ^String value StandardCharsets/UTF_8))
                          maximum-identifier-bytes)
                      (re-matches identifier-pattern value))
         "validation-error")

       :else
       (when-not (and (string? value)
                      (<= (alength (.getBytes ^String value StandardCharsets/UTF_8))
                          maximum-identifier-bytes)
                      (re-matches identifier-pattern value))
         "validation-error")))
   input))

(defn freshness-floor-available?
  "Returns true when an immutable selected basis can satisfy an at-least floor.
  A selected basis timestamp proves floors no newer than that snapshot across
  execution environments. Older clients retain basis-ID compatibility, while
  timestamp comparison remains the fallback when basis identity differs."
  [input public-basis]
  (if-let [requested-at-value (:atLeastAsFreshAs input)]
    (let [requested-basis-id (:atLeastAsFreshBasisId input)
          current-basis-id (:id public-basis)
          requested-at (java.time.Instant/parse requested-at-value)
          selected-captured-at (some-> (:atLeastAsFreshBasisCapturedAt input)
                                       java.time.Instant/parse)]
      (cond
        (and requested-basis-id
             (= requested-basis-id current-basis-id)
             selected-captured-at)
        (not (.isAfter requested-at selected-captured-at))

        (and requested-basis-id
             (= requested-basis-id current-basis-id))
        true

        :else
        (let [captured-at (some-> (:capturedAt public-basis)
                                  java.time.Instant/parse)]
          (not (and captured-at
                    (.isAfter requested-at captured-at))))))
    true))
