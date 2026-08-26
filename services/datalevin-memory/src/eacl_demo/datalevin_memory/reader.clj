(ns eacl-demo.datalevin-memory.reader
  "Bootstraps one real LMDB in-memory Datalevin environment and exposes only
  request-owned EACL snapshots."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [datalevin.core :as d]
            [eacl.core :as eacl]
            [eacl.datalevin.core :as datalevin-eacl]
            [eacl.datalevin.schema :as datalevin-schema]
            [eacl.relationships.endpoint-pair :as endpoint-pair]
            [eacl.relationships.storage :as relationship-storage]
            [eacl.schema.model :as schema-model])
  (:import [java.time Instant]))

(def ^:private physical-schema
  {:demo/type {:db/valueType :db.type/keyword
               :db/cardinality :db.cardinality/one
               :db/index true}
   :demo/roles {:db/valueType :db.type/keyword
                :db/cardinality :db.cardinality/many
                :db/index true}})

(def ^:private seed-batch-size 5000)

(defn- fixture-records
  []
  (with-open [reader (io/reader (or (io/resource "fixture-10000.ndjson")
                                    (throw (ex-info "Fixture is absent."
                                                    {:type :eacl-demo/missing-fixture}))))]
    (let [records (mapv #(json/read-str % :key-fn keyword) (line-seq reader))
          header (first records)]
      (when-not (and (= "fixture" (:kind header))
                     (= "eacl-demo-fixture-v1" (:fixtureId header))
                     (= 10000 (:cutPointResources header)))
        (throw (ex-info "Fixture identity mismatch."
                        {:type :eacl-demo/fixture-identity-mismatch})))
      (subvec records 1))))

(defn- seed-objects!
  [conn records]
  (doseq [batch (partition-all seed-batch-size
                               (filter #(= "object" (:kind %)) records))]
    (d/transact!
     conn
     (map-indexed
      (fn [index {:keys [object role]}]
        {:db/id (- (inc index))
         :eacl/id (:id object)
         :demo/type (keyword (:type object))
         :demo/roles #{(keyword role)}})
      batch))))

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
  [conn watermark write-token records]
  (let [entity-ids (entity-ids (d/db conn))]
    (doseq [batch (partition-all seed-batch-size
                                 (filter #(= "relationship" (:kind %)) records))]
      (let [physical (mapv #(physical-relationship entity-ids %) batch)
            relation-stamps
            (mapv (fn [relation-eid]
                    [:db/add relation-eid
                     :eacl.datalevin/relation-generation :db/current-tx])
                  (distinct (map :relation-eid physical)))]
        (d/transact! conn
                     (into relation-stamps (mapcat :tx-data physical))
                     {:datalevin/write-token write-token})
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
  [{:keys [security-key] :as config}]
  (when-not (and (= #{:security-key} (set (keys config)))
                 (string? security-key)
                 (<= 32 (alength (.getBytes ^String security-key "UTF-8"))))
    (throw (ex-info "Invalid Datalevin reader configuration."
                    {:type :eacl-demo/invalid-config})))
  (let [conn (datalevin-eacl/create-conn nil physical-schema)
        watermark (atom 0)]
    (try
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
                                                     {:type :eacl-demo/missing-schema}))))
            records (fixture-records)]
        (eacl/write-schema! client schema-source)
        (seed-objects! conn records)
        (seed-relationships! conn watermark write-token records)
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
