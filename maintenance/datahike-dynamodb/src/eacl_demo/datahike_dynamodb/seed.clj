(ns eacl-demo.datahike-dynamodb.seed
  "Idempotent, resumable canonical-fixture seeding for a private Datahike writer."
  (:require [clojure.data.json :as json]
            [datahike.api :as d]
            [eacl.core :as eacl]
            [eacl.datahike.core :as datahike-eacl]
            [eacl.relationships.storage :as relationship-storage])
  (:import [java.nio.charset StandardCharsets]
           [java.security MessageDigest]
           [java.time Instant]
           [java.util Date]))

(def ^:private maximum-batch-resources 250)
(def ^:private maximum-batch-records 1250)
(def ^:private maximum-batch-bytes 1048576)
(def ^:private maximum-group-batches 4)
(def ^:private maximum-group-resources 1000)
(def ^:private maximum-group-records 5000)
(def ^:private maximum-group-bytes 4194304)
(def ^:private digest-pattern #"sha256:[0-9a-f]{64}")
(def ^:private object-pattern #"[a-z][a-z0-9_-]{0,63}")
(def ^:private id-pattern #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}")

(declare apply-batch-group! batch-identity batch-records canonical-line canonical-value
         checkpoint-state count-datoms fail! object-tx relationship-update
         sha256 validate-batch validate-seed-options verify-counts)

(defn initialize-seed!
  "Installs the fixed Spice schema once and creates or validates seed state."
  [connection {:keys [seed-id manifest-digest schema-source] :as options}]
  (validate-seed-options options)
  (let [existing (checkpoint-state (d/db connection) seed-id)
        client (datahike-eacl/make-client
                connection
                {:source-lifecycle {:application :eacl-demo
                                    :profile :datahike-dynamodb
                                    :seed-id seed-id}})]
    (if existing
      (when-not (and (= manifest-digest (:eacl.demo/manifest-digest existing))
                     (contains? #{:seeding :ready}
                                (:eacl.demo/seed-status existing)))
        (fail! :seed-identity-mismatch))
      (do
        (eacl/write-schema! client schema-source)
        (d/transact
         connection
         [{:eacl.demo/seed-id seed-id
           :eacl.demo/manifest-digest manifest-digest
           :eacl.demo/next-resource-ordinal (long 0)
           :eacl.demo/record-count (long 0)
           :eacl.demo/seed-status :seeding}])))
    {:connection connection
     :client client
     :seed-id seed-id
     :manifest-digest manifest-digest}))

(defn apply-batch!
  "Applies one deterministic input batch. See `apply-batch-group!`."
  [state batch]
  (apply-batch-group! state [batch]))

(defn apply-batch-group!
  "Commits up to four contiguous wire batches as one bounded Datahike group.

  Content writes are replay-safe. The checkpoint and every input-batch digest
  are advanced atomically only after both object and relationship transactions
  succeed. A crash before that checkpoint can replay the same group without
  duplicating unique objects or set-valued relationships."
  [{:keys [connection client seed-id manifest-digest]} batches]
  (let [batches (mapv validate-batch batches)
        first-batch (first batches)
        last-batch (peek batches)
        total-resources (reduce + (map :resourceCount batches))
        total-records (reduce + (map #(count (:records %)) batches))
        total-bytes (reduce + (map :canonicalBytes batches))]
    (when-not (and (seq batches)
                   (<= (count batches) maximum-group-batches)
                   (<= total-resources maximum-group-resources)
                   (<= total-records maximum-group-records)
                   (<= total-bytes maximum-group-bytes)
                   (every? true?
                           (map (fn [left right]
                                  (= (inc (:lastResourceOrdinal left))
                                     (:firstResourceOrdinal right)))
                                batches (next batches))))
      (fail! :invalid-batch-group))
    (let [database (d/db connection)
          state (checkpoint-state database seed-id)
          completed (mapv #(d/entity database
                                     [:eacl.demo/batch-id
                                      (batch-identity seed-id %)])
                          batches)
          completed? (mapv #(some? (:eacl.demo/batch-id %)) completed)]
      (when-not (= manifest-digest (:eacl.demo/manifest-digest state))
        (fail! :seed-identity-mismatch))
      (cond
        (every? true? completed?)
        (do
          (doseq [[batch entity] (map vector batches completed)]
            (when-not (and (= (:digest batch)
                              (:eacl.demo/batch-digest entity))
                           (= (:firstResourceOrdinal batch)
                              (:eacl.demo/batch-first-resource entity))
                           (= (:lastResourceOrdinal batch)
                              (:eacl.demo/batch-last-resource entity)))
              (fail! :batch-identity-mismatch)))
          {:status :already-committed
           :next-resource-ordinal (inc (:lastResourceOrdinal last-batch))
           :content-basis-t (:eacl.demo/content-basis-t (peek completed))})

        (some true? completed?)
        (fail! :partial-group-checkpoint)

        (not= :seeding (:eacl.demo/seed-status state))
        (fail! :seed-not-writable)

        (not= (:firstResourceOrdinal first-batch)
              (:eacl.demo/next-resource-ordinal state))
        (fail! :resume-boundary-mismatch)

        :else
        (let [{:keys [objects relationships]}
              (batch-records (into [] (mapcat :records) batches))
              _ (when (seq objects)
                  (d/transact connection (mapv object-tx objects)))
              _ (when (seq relationships)
                  (eacl/write-relationships!
                   client (mapv relationship-update relationships)))
              content-basis-t (:max-tx (d/db connection))
              old-record-count (:eacl.demo/record-count state)
          new-record-count (+ old-record-count total-records)
          first-ordinal (:firstResourceOrdinal first-batch)
          next-ordinal (inc (:lastResourceOrdinal last-batch))
          seed-entity-id (:db/id state)
          next-resource-attribute
          (:db/id (d/entity database :eacl.demo/next-resource-ordinal))
          record-count-attribute
          (:db/id (d/entity database :eacl.demo/record-count))
          last-batch-attribute
          (:db/id (d/entity database :eacl.demo/last-batch-digest))
          checkpoint
          (into
               [[:db.fn/cas seed-entity-id next-resource-attribute
                 first-ordinal next-ordinal]
                [:db.fn/cas seed-entity-id record-count-attribute
                 old-record-count new-record-count]
                [:db/add seed-entity-id last-batch-attribute
                 (:digest last-batch)]]
               (map
                (fn [batch]
                  {:eacl.demo/batch-id (batch-identity seed-id batch)
                   :eacl.demo/manifest-digest manifest-digest
                   :eacl.demo/batch-first-resource
                   (long (:firstResourceOrdinal batch))
                   :eacl.demo/batch-last-resource
                   (long (:lastResourceOrdinal batch))
                   :eacl.demo/batch-record-count
                   (long (count (:records batch)))
                   :eacl.demo/batch-digest (:digest batch)
                   :eacl.demo/content-basis-t content-basis-t})
                batches))]
          (try
            (let [report (d/transact connection checkpoint)]
              {:status :committed
               :next-resource-ordinal next-ordinal
               :content-basis-t content-basis-t
               :checkpoint-basis-t (:max-tx (:db-after report))})
            (catch Throwable error
              (let [winner-db (d/db connection)
                    winners (mapv #(d/entity
                                    winner-db
                                    [:eacl.demo/batch-id
                                     (batch-identity seed-id %)])
                                  batches)]
                (if (every? true?
                            (map (fn [batch winner]
                                   (and (= (:digest batch)
                                           (:eacl.demo/batch-digest winner))
                                        (= (:lastResourceOrdinal batch)
                                           (:eacl.demo/batch-last-resource winner))))
                                 batches winners))
                  {:status :already-committed
                   :next-resource-ordinal next-ordinal
                   :content-basis-t
                   (:eacl.demo/content-basis-t (peek winners))}
                  (throw error))))))))))

(defn finalize-seed!
  "Verifies exact counts and freezes the compact-source lifecycle at ready."
  [{:keys [connection seed-id manifest-digest]}
   {:keys [cutPointResources counts] :as expected}]
  (when-not (and (pos-int? cutPointResources) (map? counts))
    (fail! :invalid-finalization))
  (let [database (d/db connection)
        state (checkpoint-state database seed-id)]
    (when-not (and (= manifest-digest (:eacl.demo/manifest-digest state))
                   (= cutPointResources
                      (:eacl.demo/next-resource-ordinal state)))
      (fail! :seed-incomplete))
    (let [actual (verify-counts database state counts)]
      (case (:eacl.demo/seed-status state)
        :ready
        {:status :ready
         :replayed true
         :content-basis-t (:eacl.demo/content-basis-t state)
         :publication-basis-t (:max-tx database)
         :manifest-digest manifest-digest
         :counts actual}

        :seeding
        (let [content-basis-t (:max-tx database)
              seed-entity-id (:db/id state)
              status-attribute
              (:db/id (d/entity database :eacl.demo/seed-status))
              content-basis-attribute
              (:db/id (d/entity database :eacl.demo/content-basis-t))
              verified-at-attribute
              (:db/id (d/entity database :eacl.demo/verified-at))
              report
              (d/transact
               connection
               [[:db.fn/cas seed-entity-id status-attribute
                 :seeding :ready]
                [:db/add seed-entity-id content-basis-attribute
                 content-basis-t]
                [:db/add seed-entity-id verified-at-attribute
                 (Date/from (Instant/now))]])]
          {:status :ready
           :replayed false
           :content-basis-t content-basis-t
           :publication-basis-t (:max-tx (:db-after report))
           :manifest-digest manifest-digest
           :counts actual})

        (fail! :seed-incomplete)))))

(defn compact-store!
  "Runs exact single-writer local-file reachability GC after final verification."
  [{:keys [connection seed-id]}]
  (let [state (checkpoint-state (d/db connection) seed-id)]
    (when-not (= :ready (:eacl.demo/seed-status state))
      (fail! :seed-not-ready-for-compaction))
    (if (= :compacted (:eacl.demo/compaction-status state))
      {:status :already-compacted
       :deleted-key-count 0
       :retained-basis-t (:max-tx (d/db connection))}
      ;; This fixture advertises only its final current snapshot. Advance the
      ;; commit cutoff just beyond now so every superseded seed commit becomes
      ;; collectable while Datahike still retains the branch head unconditionally.
      ;; A beginning-of-time cutoff would retain every intermediate index root
      ;; and reproduce the write-amplified multi-gigabyte store we are avoiding.
      (let [deleted (d/gc-storage
                     connection
                     (Date. (inc (System/currentTimeMillis)))
                     {:min-age-ms 0})
            deleted (if (instance? clojure.lang.IDeref deleted) @deleted deleted)]
        (when (instance? Throwable deleted) (throw deleted))
        (let [database (d/db connection)
              seed-entity-id (:db/id (checkpoint-state database seed-id))
              status-attribute
              (:db/id (d/entity database :eacl.demo/compaction-status))
              compacted-at-attribute
              (:db/id (d/entity database :eacl.demo/compacted-at))
              report (d/transact
                      connection
                      [[:db/add seed-entity-id status-attribute :compacted]
                       [:db/add seed-entity-id compacted-at-attribute
                        (Date/from (Instant/now))]])]
          {:status :compacted
           :deleted-key-count (count deleted)
           :retained-basis-t (:max-tx (:db-after report))})))))

(defn verify-counts
  [database state expected]
  (let [actual
        {:objects (count-datoms (d/datoms database :avet :eacl.demo/type))
         :subjects (count-datoms
                    (d/datoms database :avet :eacl.demo/roles :subject))
         :resources (count-datoms
                     (d/datoms database :avet :eacl.demo/roles :resource))
         :relationships
         (count-datoms
          (d/datoms database :avet relationship-storage/forward-attribute))
         :records (:eacl.demo/record-count state)}]
    (when-not (= expected actual) (fail! :count-mismatch))
    actual))

(defn- count-datoms
  [datoms]
  (reduce (fn [total _] (inc total)) 0 (seq datoms)))

(defn- validate-seed-options
  [{:keys [seed-id manifest-digest schema-source] :as options}]
  (when-not (and (= #{:seed-id :manifest-digest :schema-source}
                    (set (keys options)))
                 (string? seed-id) (re-matches id-pattern seed-id)
                 (string? manifest-digest)
                 (re-matches digest-pattern manifest-digest)
                 (string? schema-source) (not-empty schema-source))
    (fail! :invalid-seed-options)))

(defn validate-batch
  [{:keys [firstResourceOrdinal lastResourceOrdinal resourceCount records
           canonicalBytes digest idempotencyKey]
    :as batch}]
  (let [allowed #{:firstResourceOrdinal :lastResourceOrdinal :resourceCount
                  :records :canonicalBytes :digest :idempotencyKey}
        _validated-records (when (vector? records) (batch-records records))
        lines (when (vector? records) (mapv canonical-line records))
        actual-bytes (when lines
                       (reduce + 0
                               (map #(alength (.getBytes ^String %
                                                        StandardCharsets/UTF_8))
                                    lines)))
        actual-digest (when lines (sha256 (apply str lines)))
        resource-records (when (vector? records)
                           (count
                            (filter #(and (= "object" (:kind %))
                                          (= "resource" (:role %)))
                                    records)))]
    (when-not (and (= allowed (set (keys batch)))
                   (nat-int? firstResourceOrdinal)
                   (nat-int? lastResourceOrdinal)
                   (pos-int? resourceCount)
                   (<= resourceCount maximum-batch-resources)
                   (= lastResourceOrdinal
                      (+ firstResourceOrdinal resourceCount -1))
                   (vector? records) (seq records)
                   (<= (count records) maximum-batch-records)
                   (= resourceCount resource-records)
                   (= canonicalBytes actual-bytes)
                   (<= canonicalBytes maximum-batch-bytes)
                   (= digest actual-digest)
                   (= idempotencyKey
                      (str "eacl-demo-fixture-v1:" firstResourceOrdinal
                           "-" lastResourceOrdinal)))
      (fail! :invalid-batch))
    batch))

(defn- batch-records
  [records]
  (reduce
   (fn [result record]
     (case (:kind record)
       "object"
       (let [{:keys [role object]} record]
         (when-not (and (= #{:kind :object :role} (set (keys record)))
                        (contains? #{"subject" "resource"} role)
                        (= #{:type :id} (set (keys object)))
                        (re-matches object-pattern (:type object))
                        (re-matches id-pattern (:id object)))
           (fail! :invalid-record))
         (update result :objects conj record))

       "relationship"
       (let [{:keys [subject resource relation]} record]
         (when-not (and (= #{:kind :subject :relation :resource}
                           (set (keys record)))
                        (re-matches object-pattern relation)
                        (every? #(and (= #{:type :id} (set (keys %)))
                                      (re-matches object-pattern (:type %))
                                      (re-matches id-pattern (:id %)))
                                [subject resource]))
           (fail! :invalid-record))
         (update result :relationships conj record))

       (fail! :invalid-record)))
   {:objects [] :relationships []}
   records))

(defn- object-tx
  [{:keys [role object]}]
  {:eacl/id (:id object)
   :eacl.demo/type (keyword (:type object))
   :eacl.demo/roles #{(keyword role)}})

(defn- relationship-update
  [{:keys [subject relation resource]}]
  (eacl/->RelationshipUpdate
   :touch
   (eacl/->Relationship
    (eacl/spice-object (keyword (:type subject)) (:id subject))
    (keyword relation)
    (eacl/spice-object (keyword (:type resource)) (:id resource)))))

(defn- canonical-line
  [record]
  (str (json/write-str (canonical-value record) :escape-unicode false) "\n"))

(defn- canonical-value
  [value]
  (cond
    (map? value)
    (into (sorted-map)
          (map (fn [[key nested]] [(name key) (canonical-value nested)]))
          value)

    (vector? value) (mapv canonical-value value)
    (sequential? value) (mapv canonical-value value)
    :else value))

(defn- checkpoint-state
  [database seed-id]
  (d/entity database [:eacl.demo/seed-id seed-id]))

(defn- batch-identity
  [seed-id {:keys [idempotencyKey]}]
  (str seed-id ":" idempotencyKey))

(defn- sha256
  [value]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (str "sha256:"
         (apply str
                (map #(format "%02x" (bit-and 255 %))
                     (.digest digest
                              (.getBytes ^String value
                                         StandardCharsets/UTF_8)))))))

(defn- fail!
  [type]
  (throw (ex-info "Datahike fixture seed validation failed."
                  {:type (keyword "eacl-demo.datahike-seed" (name type))})))
