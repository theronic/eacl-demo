(ns eacl-demo.datahike-dynamodb.export
  "Bounded, replay-safe export of one compact Konserve file store to DynamoDB."
  (:import [java.nio ByteBuffer]
           [java.nio.charset StandardCharsets]
           [java.nio.file Files LinkOption Path Paths]
           [java.security MessageDigest]
           [java.util ArrayList HashMap]
           [software.amazon.awssdk.core.exception SdkClientException
            SdkServiceException]
           [software.amazon.awssdk.core SdkBytes]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]
           [software.amazon.awssdk.services.dynamodb.model
            AttributeValue BatchWriteItemRequest BatchWriteItemResponse
            PutRequest WriteRequest]))

(def ^:private header-size 20)
(def ^:private absolute-item-limit (* 400 1024))
(def ^:private guarded-item-limit (* 380 1024))
(def ^:private maximum-request-bytes (* 15 1024 1024))
(def ^:private maximum-request-items 25)
(def ^:private target-request-write-units 125)
(def ^:private maximum-retry-attempts 12)
(def ^:private store-key-pattern
  #"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.ksv")

(declare attribute-bytes batch-write-request blob-item blob-paths byte-length
         digest-hex entry-write-request fail! item-size request-groups retryable?
         sha256 update-digest! write-group! write-key)

(defn read-blob
  "Reads one post-compaction Konserve blob without deserializing its contents."
  [store-path ^Path path]
  (let [store-root (.normalize (.toAbsolutePath (Paths/get store-path
                                                           (make-array String 0))))
        path (.normalize (.toAbsolutePath path))
        filename (str (.getFileName path))]
    (when-not (and (= store-root (.getParent path))
                   (re-matches store-key-pattern filename)
                   (Files/isRegularFile path (make-array LinkOption 0)))
      (fail! :invalid-store-object {:filename filename}))
    (let [file-size (Files/size path)]
      ;; Refuse to materialize anything that could not possibly be a legal item.
      (when-not (<= header-size file-size guarded-item-limit)
        (fail! :oversized-store-object {:filename filename
                                        :fileBytes file-size}))
      (let [content (Files/readAllBytes path)
            version (bit-and 0xff (aget content 0))
            meta-size (.getInt (ByteBuffer/wrap content 4 4))
            value-offset (+ header-size meta-size)]
        (when-not (and (= 1 version)
                       (not (neg? meta-size))
                       (<= value-offset (alength content)))
          (fail! :invalid-store-object {:filename filename}))
        (let [blob {:key filename
                    :header (java.util.Arrays/copyOfRange content 0 header-size)
                    :meta (java.util.Arrays/copyOfRange content header-size
                                                        value-offset)
                    :value (java.util.Arrays/copyOfRange content value-offset
                                                         (alength content))}
              bytes (item-size blob)]
          (when (> bytes absolute-item-limit)
            (fail! :oversized-dynamodb-item {:filename filename
                                             :itemBytes bytes}))
          (when (> bytes guarded-item-limit)
            (fail! :guarded-item-limit-exceeded {:filename filename
                                                 :itemBytes bytes}))
          (assoc blob
                 :item-bytes bytes
                 :write-units (long (Math/ceil (/ (double bytes) 1024.0)))
                 :sha256 (sha256 content)))))))

(defn preflight-store
  "Validates every object and returns a deterministic identity before any write."
  [store-path]
  (let [paths (blob-paths store-path)
        digest (MessageDigest/getInstance "SHA-256")]
    (when (empty? paths) (fail! :empty-store {}))
    (let [entries
          (mapv
           (fn [^Path path]
             (let [{:keys [key item-bytes write-units sha256]}
                   (read-blob store-path path)]
               (update-digest! digest
                               (str key "\t" item-bytes "\t" sha256 "\n"))
               {:path (str path)
                :key key
                :item-bytes item-bytes
                :write-units write-units
                :sha256 sha256}))
           paths)]
      {:entries entries
       :object-count (count entries)
       :item-bytes (reduce + (map :item-bytes entries))
       :write-units (reduce + (map :write-units entries))
       :store-digest (str "sha256:" (digest-hex digest))})))

(defn export-store!
  "Exports a preflighted store. Confirmed batches advance an optional checkpoint.

  `configured` may inject :call-batch-write, :clock, :sleep and :checkpoint! for
  deterministic tests. Replayed PutRequests replace the same immutable bytes."
  [^DynamoDbClient client table store-path preflight configured]
  (let [{:keys [entries store-digest]} preflight
        {:keys [start-index call-batch-write clock sleep checkpoint!]
         :or {start-index 0
              call-batch-write (fn [client request]
                                 (.batchWriteItem client request))
              clock #(System/currentTimeMillis)
              sleep #(Thread/sleep %)
              checkpoint! (fn [_] nil)}} configured]
    (when-not (and (string? table) (not-empty table)
                   (vector? entries) (seq entries)
                   (re-matches #"sha256:[0-9a-f]{64}" (or store-digest ""))
                   (nat-int? start-index) (<= start-index (count entries))
                   (fn? call-batch-write) (fn? clock) (fn? sleep)
                   (fn? checkpoint!))
      (fail! :invalid-export-options {}))
    (loop [groups (request-groups (subvec entries start-index))
           confirmed start-index
           requests 0]
      (if-let [group (first groups)]
        (let [writes (mapv #(entry-write-request store-path %) group)
              started (clock)
              _ (write-group! client table writes call-batch-write sleep)
              elapsed (- (clock) started)
              minimum-elapsed
              (long (Math/ceil
                     (* 1000.0
                        (/ (double (reduce + (map :write-units group)))
                           target-request-write-units))))
              _ (when (< elapsed minimum-elapsed)
                  (sleep (- minimum-elapsed elapsed)))
              next-confirmed (+ confirmed (count group))]
          (checkpoint! {:next-index next-confirmed
                        :last-key (:key (peek group))
                        :store-digest store-digest})
          (recur (next groups) next-confirmed (inc requests)))
        {:status :exported
         :store-digest store-digest
         :object-count (count entries)
         :confirmed-count confirmed
         :request-count requests}))))

(defn entry-write-request
  [store-path {:keys [path key item-bytes sha256]}]
  (let [blob (read-blob store-path (Paths/get path (make-array String 0)))]
    (when-not (and (= key (:key blob))
                   (= item-bytes (:item-bytes blob))
                   (= sha256 (:sha256 blob)))
      (fail! :store-changed-after-preflight {:filename key}))
    (let [put (-> (PutRequest/builder)
                  (.item (blob-item blob))
                  .build)]
      (-> (WriteRequest/builder)
          (.putRequest put)
          .build))))

(defn blob-item
  [{:keys [key header meta value]}]
  (doto (HashMap.)
    (.put "Key" (-> (AttributeValue/builder) (.s key) .build))
    (.put "Header" (attribute-bytes header))
    (.put "Meta" (attribute-bytes meta))
    (.put "Value" (attribute-bytes value))))

(defn batch-write-request
  [table writes]
  (let [values (ArrayList.)]
    (doseq [write writes] (.add values write))
    (-> (BatchWriteItemRequest/builder)
        (.requestItems {table values})
        .build)))

(defn- write-group!
  [client table writes call-batch-write sleep]
  (loop [pending writes attempt 1]
    (let [request (batch-write-request table pending)
          outcome (try {:response (call-batch-write client request)}
                       (catch Throwable error {:error error}))]
      (if-let [error (:error outcome)]
        (if (and (< attempt maximum-retry-attempts) (retryable? error))
          (do
            (sleep (min 5000 (* 50 (bit-shift-left 1 (dec attempt)))))
            (recur pending (inc attempt)))
          (throw error))
        (let [^BatchWriteItemResponse response (:response outcome)]
          (when-not (instance? BatchWriteItemResponse response)
            (fail! :invalid-batch-write-response {}))
          (let [tables (set (keys (.unprocessedItems response)))
                unprocessed (vec (get (.unprocessedItems response) table []))
                pending-keys (mapv write-key pending)
                unprocessed-keys (mapv write-key unprocessed)]
            (when (or (seq (disj tables table))
                      (not= (count pending-keys) (count (distinct pending-keys)))
                      (not= (count unprocessed-keys)
                            (count (distinct unprocessed-keys)))
                      (seq (remove (set pending-keys) unprocessed-keys)))
              (fail! :invalid-batch-write-response {}))
            (if (empty? unprocessed)
              true
              (do
                (when (>= attempt maximum-retry-attempts)
                  (fail! :unprocessed-write-limit
                         {:attempts attempt
                          :unprocessed (count unprocessed)}))
                (sleep (min 5000 (* 50 (bit-shift-left 1 (dec attempt)))))
                (recur unprocessed (inc attempt))))))))))

(defn- request-groups
  [entries]
  (when (seq entries)
    (loop [remaining entries groups [] current [] bytes 0 units 0]
      (if-let [entry (first remaining)]
        (let [next-bytes (+ bytes (:item-bytes entry))
              next-units (+ units (:write-units entry))
              full? (or (= (count current) maximum-request-items)
                        (> next-bytes maximum-request-bytes)
                        (and (seq current)
                             (> next-units target-request-write-units)))]
          (if full?
            (recur remaining (conj groups current) [] 0 0)
            (recur (next remaining) groups (conj current entry)
                   next-bytes next-units)))
        (cond-> groups (seq current) (conj current))))))

(defn- blob-paths
  [store-path]
  (let [root (.normalize (.toAbsolutePath (Paths/get store-path
                                                     (make-array String 0))))]
    (when-not (Files/isDirectory root (make-array LinkOption 0))
      (fail! :invalid-store-path {:path store-path}))
    (with-open [stream (Files/list root)]
      (->> (.iterator stream)
           iterator-seq
           (filter #(re-matches store-key-pattern (str (.getFileName ^Path %))))
           (sort-by #(str (.getFileName ^Path %)))
           vec))))

(defn- item-size
  [{:keys [key header meta value]}]
  (+ (byte-length "Key") (byte-length key)
     (byte-length "Header") (alength ^bytes header)
     (byte-length "Meta") (alength ^bytes meta)
     (byte-length "Value") (alength ^bytes value)))

(defn- write-key
  [^WriteRequest write]
  (some-> write .putRequest .item (get "Key") .s))

(defn- retryable?
  [error]
  (or (instance? SdkClientException error)
      (and (instance? SdkServiceException error)
           (let [^SdkServiceException service-error error
                 status (.statusCode service-error)]
             (or (.isThrottlingException service-error)
                 (= 429 status)
                 (<= 500 status 599))))))

(defn- attribute-bytes
  [value]
  (-> (AttributeValue/builder)
      (.b (SdkBytes/fromByteArray value))
      .build))

(defn- byte-length
  [value]
  (alength (.getBytes ^String value StandardCharsets/UTF_8)))

(defn- sha256
  [value]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (.update digest ^bytes value)
    (str "sha256:" (digest-hex digest))))

(defn- update-digest!
  [^MessageDigest digest value]
  (.update digest (.getBytes ^String value StandardCharsets/UTF_8)))

(defn- digest-hex
  [^MessageDigest digest]
  (apply str (map #(format "%02x" (bit-and 0xff %)) (.digest digest))))

(defn- fail!
  [type data]
  (throw (ex-info "Datahike DynamoDB export validation failed."
                  (assoc data :type (keyword "eacl-demo" (name type))))))
