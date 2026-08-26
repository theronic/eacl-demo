(ns eacl-demo.datomic-dynamodb.seed
  "Idempotent, resumable Datomic fixture seeding. Never included in serving."
  (:require [clojure.data.json :as json]
            [clojure.string :as string]
            [datomic.api :as d]
            [eacl.core :as eacl]
            [eacl.datomic.core :as datomic-eacl]
            [eacl.datomic.schema :as datomic-schema])
  (:import [java.nio.charset StandardCharsets]
           [java.security MessageDigest]
           [java.time Instant]
           [java.util Date]
           [java.util.concurrent TimeUnit TimeoutException]))

(def ^:private maximum-batch-resources 250)
(def ^:private maximum-batch-records 1250)
(def ^:private maximum-batch-bytes 1048576)
(def ^:private digest-pattern #"sha256:[0-9a-f]{64}")
(def ^:private object-pattern #"[a-z][a-z0-9_-]{0,63}")
(def ^:private id-pattern #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}")

(declare batch-identity batch-records canonical-line canonical-value checkpoint-state
         count-datoms
         fail! object-tx relationship-update sha256 validate-batch
         validate-seed-options verify-counts)

(defn initialize-seed!
  "Installs history-preserving schemas and creates or validates one seed state."
  [connection {:keys [seed-id manifest-digest schema-source metadata-schema]
               :as options}]
  (validate-seed-options options)
  @(d/transact connection (into datomic-schema/v7-schema metadata-schema))
  (let [existing (checkpoint-state (d/db connection) seed-id)
        client (datomic-eacl/make-client
                connection
                {:source-lifecycle {:application :eacl-demo
                                    :profile :datomic-dynamodb
                                    :seed-id seed-id}})]
    (if existing
      (when-not (and (= manifest-digest (:eacl.demo/manifest-digest existing))
                     (contains? #{:seeding :ready}
                                (:eacl.demo/seed-status existing)))
        (fail! :seed-identity-mismatch))
      (do
        (eacl/write-schema! client schema-source)
        @(d/transact
          connection
          [{:db/id seed-id
            :eacl.demo/seed-id seed-id
            :eacl.demo/manifest-digest manifest-digest
            :eacl.demo/next-resource-ordinal 0
            :eacl.demo/record-count 0
            :eacl.demo/seed-status :seeding}])))
    {:connection connection
     :client client
     :seed-id seed-id
     :manifest-digest manifest-digest}))

(defn apply-batch!
  "Applies one deterministic batch and advances its checkpoint atomically.
  Content writes are replay-safe; a crash before checkpoint can repeat them."
  [{:keys [connection client seed-id manifest-digest]} batch]
  (let [{:keys [firstResourceOrdinal lastResourceOrdinal records digest]
         :as batch} (validate-batch batch)
        batch-id (batch-identity seed-id batch)
        database (d/db connection)
        state (checkpoint-state database seed-id)
        completed (d/entity database [:eacl.demo/batch-id batch-id])]
    (when-not (= manifest-digest (:eacl.demo/manifest-digest state))
      (fail! :seed-identity-mismatch))
    (cond
      (:eacl.demo/batch-id completed)
      (do
        (when-not (and (= digest (:eacl.demo/batch-digest completed))
                       (= firstResourceOrdinal
                          (:eacl.demo/batch-first-resource completed))
                       (= lastResourceOrdinal
                          (:eacl.demo/batch-last-resource completed)))
          (fail! :batch-identity-mismatch))
        {:status :already-committed
         :next-resource-ordinal (inc lastResourceOrdinal)
         :content-basis-t (:eacl.demo/content-basis-t completed)})

      (not= :seeding (:eacl.demo/seed-status state))
      (fail! :seed-not-writable)

      (not= firstResourceOrdinal
            (:eacl.demo/next-resource-ordinal state))
      (fail! :resume-boundary-mismatch)

      :else
      (let [{:keys [objects relationships]} (batch-records records)
            _ (when (seq objects)
                @(d/transact connection (mapv object-tx objects)))
            _ (when (seq relationships)
                (eacl/write-relationships!
                 client (mapv relationship-update relationships)))
            content-basis-t (d/basis-t (d/db connection))
            old-record-count (:eacl.demo/record-count state)
            new-record-count (+ old-record-count (count records))
            next-ordinal (inc lastResourceOrdinal)]
        (try
          (let [report
                @(d/transact
                  connection
                  [[:db.fn/cas [:eacl.demo/seed-id seed-id]
                    :eacl.demo/next-resource-ordinal firstResourceOrdinal
                    next-ordinal]
                   [:db.fn/cas [:eacl.demo/seed-id seed-id]
                    :eacl.demo/record-count old-record-count new-record-count]
                   [:db/add [:eacl.demo/seed-id seed-id]
                    :eacl.demo/last-batch-digest digest]
                   {:db/id batch-id
                    :eacl.demo/batch-id batch-id
                    :eacl.demo/manifest-digest manifest-digest
                    :eacl.demo/batch-first-resource firstResourceOrdinal
                    :eacl.demo/batch-last-resource lastResourceOrdinal
                    :eacl.demo/batch-record-count (count records)
                    :eacl.demo/batch-digest digest
                    :eacl.demo/content-basis-t content-basis-t}])]
            {:status :committed
             :next-resource-ordinal next-ordinal
             :content-basis-t content-basis-t
             :checkpoint-basis-t (d/basis-t (:db-after report))})
          (catch Throwable error
            ;; A competing exact replay may have won only the checkpoint CAS.
            (let [winner (d/entity (d/db connection)
                                   [:eacl.demo/batch-id batch-id])]
              (if (and (= digest (:eacl.demo/batch-digest winner))
                       (= lastResourceOrdinal
                          (:eacl.demo/batch-last-resource winner)))
                {:status :already-committed
                 :next-resource-ordinal next-ordinal
                 :content-basis-t (:eacl.demo/content-basis-t winner)}
                (throw error)))))))))

(defn finalize-seed!
  "Verifies exact logical counts, requests indexing, waits with a hard timeout,
  and moves the history-preserved lifecycle from :seeding to :ready."
  ([state expected]
   (finalize-seed! state expected
                   {:request-index d/request-index
                    :sync-index d/sync-index
                    :clock #(Instant/now)}))
  ([{:keys [connection seed-id manifest-digest]}
    {:keys [cutPointResources counts indexTimeoutSeconds] :as expected}
    {:keys [request-index sync-index clock]}]
   (when-not (and (pos-int? cutPointResources)
                  (map? counts)
                  (pos-int? indexTimeoutSeconds)
                  (every? fn? [request-index sync-index clock]))
     (fail! :invalid-finalization))
   (let [database (d/db connection)
         state (checkpoint-state database seed-id)]
     (when-not (and (= manifest-digest (:eacl.demo/manifest-digest state))
                    (= cutPointResources
                       (:eacl.demo/next-resource-ordinal state)))
       (fail! :seed-incomplete))
     (verify-counts database state counts)
     (case (:eacl.demo/seed-status state)
       :ready
       (let [content-basis-t (:eacl.demo/content-basis-t state)
             publication-basis-t (d/basis-t database)]
         (when-not (and (nat-int? content-basis-t)
                        (< content-basis-t publication-basis-t))
           (fail! :invalid-ready-basis))
         {:status :ready
          :replayed true
          :content-basis-t content-basis-t
          :publication-basis-t publication-basis-t
          :manifest-digest manifest-digest})

       :seeding
       (do
         (request-index connection)
         (let [content-basis-t (d/basis-t (d/db connection))]
           (try
             (.get ^java.util.concurrent.Future
                   (sync-index connection content-basis-t)
                   indexTimeoutSeconds TimeUnit/SECONDS)
             (catch TimeoutException _ (fail! :index-timeout)))
           (let [report
                 @(d/transact
                   connection
                   [[:db.fn/cas [:eacl.demo/seed-id seed-id]
                     :eacl.demo/seed-status :seeding :ready]
                    [:db/add [:eacl.demo/seed-id seed-id]
                     :eacl.demo/content-basis-t content-basis-t]
                    [:db/add [:eacl.demo/seed-id seed-id]
                     :eacl.demo/verified-at (Date/from (clock))]])]
             {:status :ready
              :replayed false
              :content-basis-t content-basis-t
              :publication-basis-t (d/basis-t (:db-after report))
              :manifest-digest manifest-digest})))

       (fail! :seed-incomplete)))))

(defn history-evidence
  "Proves normal-Peer as-of/history behavior before the writer is torn down."
  [{:keys [connection seed-id manifest-digest]}
   {:keys [cutPointResources]}
   {:keys [content-basis-t publication-basis-t] :as finalization}]
  (let [database (d/db connection)
        state (checkpoint-state database seed-id)
        batch-bases
        (sort
         (d/q '[:find [?basis ...]
                :where
                [?batch :eacl.demo/batch-id]
                [?batch :eacl.demo/content-basis-t ?basis]]
              database))
        prior-basis-t (first batch-bases)
        prior-database (when prior-basis-t (d/as-of database prior-basis-t))
        prior-resource-count
        (when prior-database
          (count-datoms
           (d/datoms prior-database :avet :eacl.demo/roles :resource)))
        final-resource-count
        (count-datoms (d/datoms database :avet :eacl.demo/roles :resource))
        history-statuses
        (set
         (d/q '[:find [?status ...]
                :in $ ?seed-id
                :where
                [?seed :eacl.demo/seed-id ?seed-id]
                [?seed :eacl.demo/seed-status ?status]]
              (d/history database) seed-id))
        eacl-attributes
        (->> (d/q '[:find [?ident ...]
                    :where
                    [?attribute :db/ident ?ident]
                    [?attribute :db/valueType]]
                  database)
             (filter #(string/starts-with? (or (namespace %) "") "eacl"))
             sort
             vec)
        no-history-attributes
        (->> eacl-attributes
             (filter #(true? (:db/noHistory (d/entity database %))))
             vec)]
    (when-not (and (= :ready (:eacl.demo/seed-status state))
                   (= manifest-digest (:eacl.demo/manifest-digest state))
                   (= cutPointResources final-resource-count)
                   (= content-basis-t (:eacl.demo/content-basis-t state))
                   (< prior-basis-t content-basis-t publication-basis-t)
                   (pos-int? prior-resource-count)
                   (< prior-resource-count final-resource-count)
                   (= #{:seeding :ready} history-statuses)
                   (seq eacl-attributes)
                   (empty? no-history-attributes))
      (throw (ex-info "Datomic history qualification failed."
                      {:type :eacl-demo/history-qualification-failed
                       :prior-basis-t prior-basis-t
                       :content-basis-t content-basis-t
                       :publication-basis-t publication-basis-t
                       :prior-resource-count prior-resource-count
                       :final-resource-count final-resource-count
                       :history-statuses history-statuses
                       :no-history-attributes no-history-attributes
                       :finalization-status (:status finalization)})))
    {:historyVerified true
     :normalPeer true
     :priorBasisT prior-basis-t
     :priorResourceCount prior-resource-count
     :contentBasisT content-basis-t
     :publicationBasisT publication-basis-t
     :finalResourceCount final-resource-count
     :historyStatuses (mapv name (sort history-statuses))
     :historyPreservedAttributeCount (count eacl-attributes)}))

(defn- verify-counts
  [database state expected]
  (let [actual
        {:objects (count-datoms (d/datoms database :avet :eacl.demo/type))
         :subjects (count-datoms
                    (d/datoms database :avet :eacl.demo/roles :subject))
         :resources (count-datoms
                     (d/datoms database :avet :eacl.demo/roles :resource))
         :relationships
         (count-datoms
          (d/datoms
           database :avet
           :eacl.v7.relationship/subject-type+relation+resource-type+resource))
         :records (:eacl.demo/record-count state)}]
    (when-not (= expected actual) (fail! :count-mismatch))
    actual))

(defn- count-datoms
  [datoms]
  (reduce (fn [total _] (inc total)) 0 (seq datoms)))

(defn- validate-seed-options
  [{:keys [seed-id manifest-digest schema-source metadata-schema] :as options}]
  (when-not (and (= #{:seed-id :manifest-digest :schema-source :metadata-schema}
                     (set (keys options)))
                 (string? seed-id) (re-matches id-pattern seed-id)
                 (string? manifest-digest)
                 (re-matches digest-pattern manifest-digest)
                 (string? schema-source) (not-empty schema-source)
                 (vector? metadata-schema) (seq metadata-schema))
    (fail! :invalid-seed-options)))

(defn- validate-batch
  [{:keys [firstResourceOrdinal lastResourceOrdinal resourceCount records
           canonicalBytes digest idempotencyKey]
    :as batch}]
  (let [allowed #{:firstResourceOrdinal :lastResourceOrdinal :resourceCount
                  :records :canonicalBytes :digest :idempotencyKey}
        _validated-records (when (vector? records) (batch-records records))
        lines (when (vector? records) (mapv canonical-line records))
        actual-bytes (when lines
                       (reduce + 0 (map #(alength (.getBytes ^String %
                                                             StandardCharsets/UTF_8))
                                        lines)))
        actual-digest (when lines (sha256 (apply str lines)))
        resource-records (when (vector? records)
                           (count (filter #(and (= "object" (:kind %))
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
  (throw (ex-info "Datomic fixture seed rejected." {:type type})))
