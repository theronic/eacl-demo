(ns eacl-demo.datomic-dynamodb.reader
  "Read-only Datomic/DynamoDB reader fixed to one initialization DB value."
  (:require [datomic.api :as d]
            [eacl.causal-token :as causal-token]
            [eacl.core :as eacl]
            [eacl.datomic.core :as datomic-eacl]
            [eacl.datomic.schema :as datomic-schema]
            [eacl.datomic.storage :as datomic-storage]
            [eacl.secure-format :as secure]
            [eacl.spicedb.consistency :as consistency])
  (:import [java.nio.charset StandardCharsets]
           [java.security MessageDigest]
           [java.time Instant]
           [java.util Date]
           [java.util.concurrent.locks StampedLock]
           [java.util.concurrent.atomic AtomicBoolean]))

(def ^:private fixture-schema-sha256
  "7fa7ae57dec4e442c66815ea74a63b08f12a79d7e9a716ebc8f1d6b03ee2262c")

(declare sha256)

(def ^:private region-pattern
  #"[a-z]{2}(?:-[a-z0-9]+)+-[0-9]")

(def ^:private table-pattern
  #"eacl-demo-datomic-[a-z0-9-]{3,80}")

(def ^:private database-pattern
  #"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")

(defn validate-config
  [{:keys [region table database maximum-concurrency security-key] :as config}]
  (when-not (and (= #{:region :table :database :maximum-concurrency :security-key}
                     (set (keys config)))
                 (string? region) (re-matches region-pattern region)
                 (string? table) (re-matches table-pattern table)
                 (string? database) (re-matches database-pattern database)
                 (pos-int? maximum-concurrency)
                 (string? security-key)
                 (<= 32 (alength (.getBytes ^String security-key
                                            StandardCharsets/UTF_8))))
    (throw (ex-info "Invalid Datomic/DynamoDB reader configuration."
                    {:type :eacl-demo/invalid-config})))
  config)

(defn connection-uri
  "Builds the only serving URI form. Callers cannot supply query parameters,
  credentials, endpoints, protocols, or an already-assembled URI."
  [config]
  (let [{:keys [region table database]} (validate-config config)]
    (str "datomic:ddb://" region "/" table "/" database
         "?read-only=true")))

(defn public-basis
  [{:keys [table database]} revision captured-at]
  {:behavior "fixed-environment"
   :id (str "datomic:" table ":" database ":" revision)
   :capturedAt (str captured-at)
   :fixedForEnvironment true})

(defn historical-public-basis
  [{:keys [table database]} revision captured-at]
  {:behavior "request-snapshot"
   :id (str "datomic:" table ":" database ":" revision)
   :capturedAt (str captured-at)
   :fixedForEnvironment false})

(defn- token-format-options
  [security-key]
  {:current-kid :default
   :keyring {:default (secure/normalize-key security-key)}})

(defn- decode-token
  [format-options token]
  (causal-token/token-data format-options token))

(defn- issue-exact-token
  [format-options token-scope revision]
  (causal-token/issue
   format-options
   (-> token-scope
       (assoc :revision revision :exact-locator revision)
       (dissoc :issued-at :expires-at))))

(defn- resolve-as-of
  [database instant]
  (let [date (Date/from instant)
        historical-db (d/as-of database date)
        ;; A Date cutoff can fall in a gap between transaction IDs. Select
        ;; a real transaction inside Datomic's native as-of view, preserving
        ;; its same-millisecond semantics and the retained database boundary.
        transaction (first (d/index-pull historical-db
                                         {:index :avet
                                          :selector [:db/id :db/txInstant]
                                          :start [:db/txInstant date]
                                          :reverse true}))]
    {:revision (some-> transaction :db/id d/tx->t)
     :captured-at (some-> transaction :db/txInstant (.toInstant))}))

(defn- release-once
  "Wraps one acquired resource release. A failed release remains retryable."
  [release! resource]
  (let [released? (AtomicBoolean.)]
    (fn []
      (if-not (.compareAndSet released? false true)
        false
        (try
          (release! resource)
          true
          (catch Throwable error
            (.set released? false)
            (throw error)))))))

(defn- reader-closed!
  []
  (throw
   (ex-info "Datomic reader is closed."
            {:type :eacl-demo/reader-closed})))

(defn- acquire-lease!
  "Acquires a cross-thread request lease or rejects a closing reader."
  [^StampedLock lease-lock ^AtomicBoolean closing?]
  (when (.get closing?)
    (reader-closed!))
  (let [stamp (.readLock lease-lock)]
    (if (.get closing?)
      (do
        (.unlockRead lease-lock stamp)
        (reader-closed!))
      stamp)))

(defn- select-supported-historical-snapshot
  [client token]
  (let [snapshot (eacl/snapshot client (consistency/at-exact-snapshot token))]
    (try
      (let [database (datomic-eacl/db snapshot)]
        ;; Reject an unfinished historical generation before traversing its
        ;; filtered relationship indexes for the full native admission check.
        (when-not (= :complete (:phase (datomic-storage/read-state database)))
          (throw (ex-info "Historical requests require a completed v8 storage revision."
                          {:code "unsupported-consistency"})))
        (datomic-storage/assert-compatible! database)
        (when-not (contains? #{:expression :none}
                             (datomic-schema/permission-storage-shape database))
          (throw (ex-info "Historical permission storage predates v8."
                          {:type :eacl/permission-storage-version}))))
      snapshot
      (catch Throwable error
        (try (eacl/release! snapshot)
             (catch Throwable cleanup-error
               (.addSuppressed error cleanup-error)))
        (if (contains? #{:eacl/storage-version :eacl/permission-storage-version}
                       (:type (ex-data error)))
          (throw (ex-info "Historical requests require a completed v8 storage revision."
                          {:code "unsupported-consistency"} error))
          (throw error))))))

(defn open-reader!
  "Connects without a transactor, retains exactly one current DB value, and
  lends that immutable EACL Snapshot to ordinary requests. Historical-date
  requests still select and own request-scoped exact Snapshots."
  ([config]
   (open-reader!
    config
    {:connect d/connect
     :current-db d/db
     :basis-t d/basis-t
     :make-client datomic-eacl/make-client
     :select-current-snapshot eacl/snapshot
     :select-exact-snapshot select-supported-historical-snapshot
     :snapshot-db datomic-eacl/db
     :snapshot-token eacl/basis-token
     :resolve-as-of resolve-as-of
     :decode-token decode-token
     :issue-exact-token issue-exact-token
     :release-snapshot eacl/release!
     :release-connection d/release
     :read-schema-source (fn [database]
                           (:eacl/schema-string
                            (d/entity database [:eacl/id "schema-string"])))
     :clock #(Instant/now)}))
  ([config {:keys [connect current-db basis-t make-client
                   select-current-snapshot select-exact-snapshot snapshot-db
                   snapshot-token resolve-as-of decode-token issue-exact-token
                   release-snapshot release-connection
                   read-schema-source clock]}]
   (when-not (every? fn? [connect current-db basis-t make-client
                          select-current-snapshot select-exact-snapshot
                          snapshot-db snapshot-token resolve-as-of decode-token
                          issue-exact-token release-snapshot
                          release-connection read-schema-source clock])
     (throw (ex-info "Invalid Datomic/DynamoDB reader operations."
                     {:type :eacl-demo/invalid-reader-operations})))
   (let [config (validate-config config)
         connection (connect (connection-uri config))
         release-connection! (release-once release-connection connection)
         release-fixed-snapshot!* (volatile! nil)]
     (try
       (let [fixed-db (current-db connection)
             fixed-revision (basis-t fixed-db)
             schema-source (read-schema-source fixed-db)
             _ (when-not (and (string? schema-source)
                              (= fixture-schema-sha256
                                 (sha256 schema-source)))
                 (throw (ex-info "Datomic fixture schema identity mismatch."
                                 {:type :eacl-demo/schema-identity-mismatch})))
             client
             (make-client
              connection
              {:source-lifecycle
               ;; Share across workers and restarts; rotate on history replacement.
               #uuid "744a0882-13ec-450a-ad28-ec73495f974d"
               :read-only? true
               :security-key (:security-key config)})
             fixed-snapshot (select-current-snapshot client)
             release-fixed-snapshot!
             (release-once release-snapshot fixed-snapshot)
             _ (vreset! release-fixed-snapshot!*
                        release-fixed-snapshot!)
             fixed-token
             (let [selected-revision
                   (basis-t (snapshot-db fixed-snapshot))]
               (when-not (= fixed-revision selected-revision)
                 (throw
                  (ex-info
                   "Datomic reader advanced while fixing its serving basis."
                   {:type :eacl-demo/initialization-basis-drift
                    :expected fixed-revision
                    :actual selected-revision})))
               (snapshot-token fixed-snapshot))
             format-options (token-format-options (:security-key config))
             fixed-token-scope (decode-token format-options fixed-token)
             fixed-basis (public-basis config fixed-revision (clock))
             lease-lock (StampedLock.)
             closing? (AtomicBoolean.)
             closed? (AtomicBoolean.)
             close-monitor (Object.)
             close!
             (fn []
               (locking close-monitor
                 (if (.get closed?)
                   false
                   (do
                     ;; Reject new captures before waiting for every borrowed
                     ;; request lease. StampedLock leases may be released by a
                     ;; different request thread than the capturer.
                     (.set closing? true)
                     (let [stamp (.writeLock lease-lock)]
                       (try
                         ;; A failed Snapshot release stays retryable while
                         ;; its Datomic connection is still open. If only the
                         ;; connection release fails, release-once skips the
                         ;; already-completed Snapshot on the retry.
                         (release-fixed-snapshot!)
                         (release-connection!)
                         (.set closed? true)
                         true
                         (finally
                           (.unlockWrite lease-lock stamp))))))))]
         {:config config
          :connection connection
          :client client
          :fixed-db fixed-db
          :basis fixed-basis
          :close! close!
          :capture-snapshot
          (fn capture-snapshot
            ([] (capture-snapshot {}))
            ([input]
             (let [stamp (acquire-lease! lease-lock closing?)
                   release-lease!
                   (release-once
                    (fn [stamp]
                      (.unlockRead lease-lock stamp))
                    stamp)]
               (try
                 (if (= "historical-date" (:consistency input))
                   (let [instant (Instant/parse (:atExactSnapshotAt input))
                         {:keys [revision captured-at]}
                         (resolve-as-of fixed-db instant)]
                     (when-not (and (integer? revision)
                                    (not (neg? revision))
                                    (instance? Instant captured-at))
                       (throw
                        (ex-info
                         "Datomic historical basis could not be resolved."
                         {:type :eacl-demo/historical-basis-unavailable
                          :code "unsupported-consistency"})))
                     (let [token
                           (issue-exact-token
                            format-options fixed-token-scope revision)
                           snapshot (select-exact-snapshot client token)
                           release-owned!
                           (release-once release-snapshot snapshot)]
                       {:value snapshot
                        :basis
                        (historical-public-basis config revision captured-at)
                        :release!
                        (fn []
                          (try
                            (release-owned!)
                            (finally
                              (release-lease!))))}))
                   {:value fixed-snapshot
                    :basis fixed-basis
                    ;; Ordinary requests borrow the process-owned immutable
                    ;; Snapshot. Their release ends only the request lease;
                    ;; close-reader! owns the underlying Snapshot release.
                    :release! release-lease!})
                 (catch Throwable error
                   (release-lease!)
                   (throw error))))))})
       (catch Throwable error
         (try
           (try
             (when-let [release-fixed-snapshot! @release-fixed-snapshot!*]
               (release-fixed-snapshot!))
             (finally
               (release-connection!)))
           (catch Throwable cleanup-error
             (.addSuppressed ^Throwable error cleanup-error)))
         (throw error))))))

(defn close-reader!
  [{:keys [close!]}]
  (when close!
    (close!))
  nil)

(defn- sha256
  [value]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (apply str
           (map #(format "%02x" (bit-and 255 %))
                (.digest digest
                         (.getBytes ^String value StandardCharsets/UTF_8))))))
