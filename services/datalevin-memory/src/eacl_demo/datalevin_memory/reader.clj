(ns eacl-demo.datalevin-memory.reader
  "Bootstraps one embedded LMDB Datalevin environment and exposes only
  request-owned EACL snapshots."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [datalevin.core :as d]
            [eacl-demo.datalevin-memory.profile :as profile]
            [eacl.core :as eacl]
            [eacl.datalevin.core :as datalevin-eacl]
            [eacl.datalevin.schema :as datalevin-schema]
            [eacl.relationships.endpoint-pair :as endpoint-pair]
            [eacl.relationships.storage :as relationship-storage]
            [eacl.schema.model :as schema-model])
  (:import [java.nio.charset StandardCharsets]
           [java.nio.file Files Path]
           [java.time Instant]
           [java.util UUID]))

(def ^:private physical-schema
  {:demo/type {:db/valueType :db.type/keyword
               :db/cardinality :db.cardinality/one
               :db/index true}
   :demo/roles {:db/valueType :db.type/keyword
                :db/cardinality :db.cardinality/many
                :db/index true}
   :demo/data-manifest-sha256 {:db/valueType :db.type/string
                               :db/cardinality :db.cardinality/one
                               :db/index true}})

(def ^:private seed-batch-size 5000)
(def ^:private expected-object-count 10080)
(def ^:private expected-relationship-count 38613)

(def fixture-source-id
  "The lineage shared by every replica of the exact immutable fixture.

  Relay cursors commit to this identity. Deriving it from the fixture manifest
  makes cursors portable across Lambda execution environments while rotating
  the identity whenever the fixture changes."
  (UUID/nameUUIDFromBytes
   (.getBytes
    (str "eacl-demo/datalevin-memory/fixture/"
         profile/data-manifest-sha256)
    StandardCharsets/UTF_8)))

(defn- install-fixture-source-identity!
  [conn]
  (let [database (d/db conn)
        metadata (d/entity database [:eacl/id "datalevin-metadata"])
        existing (:eacl.datalevin/source-id metadata)]
    (cond
      (= fixture-source-id existing) fixture-source-id

      (some? existing)
      (throw
       (ex-info
        "Datalevin fixture source identity conflicts with the manifest."
        {:type :eacl-demo/datalevin-source-identity-mismatch
         :expected fixture-source-id
         :actual existing}))

      :else
      (do
        (d/transact!
         conn
         [{:eacl/id "datalevin-metadata"
           :eacl.datalevin/source-id fixture-source-id}])
        fixture-source-id))))

(defn- read-fixture-batches!
  [kind consume!]
  (with-open [reader (io/reader (or (io/resource "fixture-10000.ndjson")
                                    (throw (ex-info "Fixture is absent."
                                                    {:type :eacl-demo/missing-fixture}))))]
    (let [lines (line-seq reader)
          header (some-> (first lines) (json/read-str :key-fn keyword))]
      (when-not (and (= "fixture" (:kind header))
                     (= "eacl-demo-fixture-v1" (:fixtureId header))
                     (= 10000 (:cutPointResources header)))
        (throw (ex-info "Fixture identity mismatch."
                        {:type :eacl-demo/fixture-identity-mismatch})))
      (loop [remaining (next lines)
             batch []
             matched 0]
        (if-let [line (first remaining)]
          (let [record (json/read-str line :key-fn keyword)
                matching? (= kind (:kind record))
                next-batch (if matching?
                             (conj batch record)
                             batch)
                next-matched (if matching? (inc matched) matched)]
            (if (= seed-batch-size (count next-batch))
              (do
                (consume! next-batch)
                (recur (next remaining) [] next-matched))
              (recur (next remaining) next-batch next-matched)))
          (do
            (when (seq batch)
              (consume! batch))
            matched))))))

(defn- seed-objects!
  [conn]
  (let [actual
        (read-fixture-batches!
         "object"
         (fn [batch]
           (d/transact!
            conn
            (map-indexed
             (fn [index {:keys [object role]}]
               {:db/id (- (inc index))
                :eacl/id (:id object)
                :demo/type (keyword (:type object))
                :demo/roles #{(keyword role)}})
             batch))))]
    (when-not (= expected-object-count actual)
      (throw (ex-info "Fixture object count mismatch."
                      {:type :eacl-demo/fixture-count-mismatch
                       :kind "object"
                       :expected expected-object-count
                       :actual actual})))))

(defn- entity-ids
  [database]
  (persistent!
   (reduce (fn [index datom]
             (assoc! index (:v datom) (:e datom)))
           (transient {})
           (d/datoms database :ave :eacl/id))))

(defn- lookup-eid!
  [entity-ids id]
  (or (get entity-ids id)
      (throw (ex-info "Fixture relationship endpoint is absent."
                      {:type :eacl-demo/missing-fixture-endpoint}))))

(defn- physical-relationship
  [entity-ids {:keys [subject relation resource]}]
  (let [subject-type (keyword (:type subject))
        resource-type (keyword (:type resource))
        relation-name (keyword relation)
        subject-eid (lookup-eid! entity-ids (:id subject))
        resource-eid (lookup-eid! entity-ids (:id resource))
        relation-eid
        (lookup-eid!
         entity-ids
         (schema-model/->relation-id resource-type relation-name subject-type))]
    {:relation-eid relation-eid
     :tx-data
     [[:db/add subject-eid relationship-storage/forward-attribute
       (endpoint-pair/forward-value subject-type relation-eid
                                    resource-type resource-eid)]
      [:db/add resource-eid relationship-storage/reverse-attribute
       (endpoint-pair/reverse-value resource-type relation-eid
                                    subject-type subject-eid)]]}))

(defn- seed-relationships!
  [conn watermark write-token]
  (let [entity-ids (entity-ids (d/db conn))
        actual
        (read-fixture-batches!
         "relationship"
         (fn [batch]
           (let [physical (mapv #(physical-relationship entity-ids %) batch)
                 relation-stamps
                 (mapv (fn [relation-eid]
                         [:db/add relation-eid
                          :eacl.datalevin/relation-generation :db/current-tx])
                       (distinct (map :relation-eid physical)))]
             (d/transact! conn
                          (into relation-stamps (mapcat :tx-data physical))
                          {:datalevin/write-token write-token})
             (reset! watermark (:max-tx (d/db conn))))))]
    (when-not (= expected-relationship-count actual)
      (throw (ex-info "Fixture relationship count mismatch."
                      {:type :eacl-demo/fixture-count-mismatch
                       :kind "relationship"
                       :expected expected-relationship-count
                       :actual actual})))))

(defn- installed-data-manifest
  [conn]
  (:demo/data-manifest-sha256
   (d/entity (d/db conn) [:eacl/id "datalevin-metadata"])))

(defn- install-fixture!
  [conn watermark write-token]
  (let [installed (installed-data-manifest conn)]
    (cond
      (= profile/data-manifest-sha256 installed)
      (reset! watermark (:max-tx (d/db conn)))

      (some? installed)
      (throw
       (ex-info
        "Embedded Datalevin fixture conflicts with this artifact."
        {:type :eacl-demo/datalevin-data-manifest-mismatch
         :expected profile/data-manifest-sha256
         :actual installed}))

      :else
      (do
        (seed-objects! conn)
        (seed-relationships! conn watermark write-token)
        ;; The marker is deliberately the final transaction. A process killed
        ;; during bootstrap retries the idempotent seed instead of accepting a
        ;; partial database as ready.
        (d/transact! conn
                     [{:eacl/id "datalevin-metadata"
                       :demo/data-manifest-sha256
                       profile/data-manifest-sha256}])
        (reset! watermark (:max-tx (d/db conn)))))))

(defn- public-basis
  [snapshot]
  (let [{:keys [max-tx]} (d/read-snapshot-revision-info
                          (datalevin-eacl/db snapshot))]
    {:behavior "request-snapshot"
     :id (str "datalevin:" max-tx)
     :capturedAt (str (Instant/now))
     :fixedForEnvironment false}))

(defn open-reader!
  [{:keys [security-key database-directory] :as config}]
  (when-not (and (= #{:security-key :database-directory} (set (keys config)))
                 (string? security-key)
                 (<= 32 (alength (.getBytes ^String security-key "UTF-8")))
                 (instance? Path database-directory)
                 (.isAbsolute ^Path database-directory))
    (throw (ex-info "Invalid Datalevin reader configuration."
                    {:type :eacl-demo/invalid-config})))
  (Files/createDirectories ^Path database-directory
                           (make-array java.nio.file.attribute.FileAttribute 0))
  (let [conn (datalevin-eacl/create-conn (str database-directory) physical-schema)
        watermark (atom 0)]
    (try
      (install-fixture-source-identity! conn)
      (let [write-token (:write-token
                         (datalevin-schema/ensure-physical-schema! conn))
            client (datalevin-eacl/make-client
                    conn
                    {:source-lifecycle "eacl-demo-datalevin-memory-v1"
                     :revision-watermark watermark
                     :advance-revision-watermark! #(swap! watermark max %)
                     :security-key security-key})
            schema-source (slurp (or (io/resource "schema.v1.zed")
                                     (throw (ex-info "Schema is absent."
                                                     {:type :eacl-demo/missing-schema}))))]
        (eacl/write-schema! client schema-source)
        (install-fixture! conn watermark write-token)
        {:connection conn
         :client client
         :capture-snapshot
         (fn []
           (let [snapshot (eacl/snapshot client)]
             (try
               {:value snapshot
                :basis (public-basis snapshot)
                :release! #(eacl/release! snapshot)}
               (catch Throwable error
                 (eacl/release! snapshot)
                 (throw error)))))} )
      (catch Throwable error
        (d/close conn)
        (throw error)))))

(defn close-reader!
  [{:keys [connection]}]
  (when connection (d/close connection)))
