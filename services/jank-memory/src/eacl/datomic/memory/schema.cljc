(ns eacl.datomic.memory.schema
  "Seek-only logical schema persistence for the bundled memory store."
  (:require [eacl.datomic.memory.db :as memory-db]
            [eacl.datomic.memory.store :as store]
            [eacl.schema.model :as model]
            [eacl.spicedb.parser :as parser]))

(def schema-control-id "eacl.schema/control")
(def ^:private relation-kind :eacl.schema/relation)
(def ^:private permission-kind :eacl.schema/permission)
(def ^:private control-kind :eacl.schema/control)
(def ^:private relation-fields
  #{:eacl/id :eacl.relation/resource-type
    :eacl.relation/relation-name :eacl.relation/subject-type})
(def ^:private permission-fields
  #{:eacl/id :eacl.permission/resource-type
    :eacl.permission/permission-name
    :eacl.permission/source-relation-name
    :eacl.permission/target-type :eacl.permission/target-name})

(defn- schema-error!
  [type reason data]
  (throw
   (ex-info
    "EACL memory schema operation failed."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn- index-components
  [index-name value]
  (case index-name
    :eavt [(:e value) (:a value) (:v value) (:tx value)]
    :aevt [(:a value) (:e value) (:v value) (:tx value)]
    :avet [(:a value) (:v value) (:e value) (:tx value)]))

(defn- exact-datoms
  [database index-name components]
  (let [width (count components)]
    (->> (apply memory-db/seek-datoms database index-name components)
         (take-while
          (fn [value]
            (= components
               (subvec (index-components index-name value) 0 width))))
         vec)))

(defn- control-entity
  [database]
  (some-> (first (exact-datoms database :avet
                               [:eacl/id schema-control-id]))
          :e))

(defn- entity-map
  [database entity]
  (reduce (fn [result value]
            (assoc result (:a value) (:v value)))
          {}
          (exact-datoms database :eavt [entity])))

(defn- control-map
  [database]
  (when-let [entity (control-entity database)]
    (entity-map database entity)))

(defn- entities-of-kind
  [database kind fields]
  (->> (exact-datoms database :avet [:eacl/schema-kind kind])
       (map #(select-keys (entity-map database (:e %)) fields))
       (sort-by :eacl/id)
       vec))

(defn read-schema
  [database]
  {:relations (entities-of-kind database relation-kind relation-fields)
   :permissions
   (entities-of-kind database permission-kind permission-fields)})

(defn schema-generation
  [database]
  (or (:eacl/schema-generation (control-map database)) 0))

(defn stored-source
  [database]
  (:eacl/schema-source (control-map database)))

(defn- stored-definitions
  [database]
  (or (:eacl/schema-definitions (control-map database)) []))

(defn- schema-entity
  [kind generation value]
  (cond->
   (assoc value
          :eacl/schema-kind kind
          :eacl/schema-generation generation)
    (= relation-kind kind)
    (assoc
     :eacl/relation-version :db/current-tx
     :eacl.relation/resource-type+relation-name
     [(:eacl.relation/resource-type value)
      (:eacl.relation/relation-name value)])

    (= permission-kind kind)
    (assoc
     :eacl.permission/resource-type+permission-name
     [(:eacl.permission/resource-type value)
      (:eacl.permission/permission-name value)])))

(defn- initial-tx
  [source compiled]
  (let [generation 1]
    (into
     [{:db/id -1
       :eacl/id schema-control-id
       :eacl/schema-kind control-kind
       :eacl/schema-source source
       :eacl/schema-definitions (:definitions compiled)
       :eacl/schema-generation generation}]
     (concat
      (map #(schema-entity relation-kind generation %)
           (:relations compiled))
      (map #(schema-entity permission-kind generation %)
           (:permissions compiled))))))

(defn- schema-entity-id!
  [database value]
  (or (some-> (first (exact-datoms database :avet
                                    [:eacl/id (:eacl/id value)]))
              :e)
      (schema-error! :eacl.store/integrity-error
                     :missing-schema-entity
                     {:eacl/id (:eacl/id value)})))

(defn- relation-removal-guard
  [database relation]
  (let [entity (schema-entity-id! database relation)
        generation
        (some-> (first (exact-datoms database :eavt
                                     [entity :eacl/relation-version]))
                :v)]
    (when-not generation
      (schema-error! :eacl.cache/generation-unprepared
                     :relation-version-missing
                     {:relation-id (:eacl/id relation)}))
    [[:eacl.tx/assert-relation-unused
      entity
      :eacl.v7.relationship/subject-type+relation+resource-type+resource
      :eacl.v7.relationship/resource-type+relation+subject-type+subject]
     [:db/cas entity :eacl/relation-version generation generation]]))

(defn- removal-plan
  [database relation-retractions permission-retractions]
  (let [relations
        (loop [remaining (seq relation-retractions)
               guards []
               removals []]
          (if-not remaining
            {:guards guards :removals removals}
            (let [relation (first remaining)
                  entity (schema-entity-id! database relation)]
              (recur (next remaining)
                     (into guards
                           (relation-removal-guard database relation))
                     (conj removals [:db/retractEntity entity])))))
        permission-removals
        (loop [remaining (seq permission-retractions)
               result []]
          (if-not remaining
            result
            (recur
             (next remaining)
             (conj result
                   [:db/retractEntity
                    (schema-entity-id! database (first remaining))]))))]
    {:guards (:guards relations)
     :removals (into (:removals relations) permission-removals)}))

(defn- schema-entities
  [kind generation values]
  (loop [remaining (seq values)
         result []]
    (if-not remaining
      result
      (recur (next remaining)
             (conj result
                   (schema-entity kind generation (first remaining)))))))

(defn- replacement-tx
  [database source compiled generation deltas]
  (let [next-generation (inc (bigint generation))
        control [:eacl/id schema-control-id]
        relation-retractions (get-in deltas [:relations :retractions])
        permission-retractions (get-in deltas [:permissions :retractions])
        removal-plan
        (removal-plan database relation-retractions permission-retractions)]
    {:generation next-generation
     :tx-data
     (into
      [[:db/cas control :eacl/schema-generation
        generation next-generation]
       [:db/add control :eacl/schema-source source]
       [:db/add control :eacl/schema-definitions (:definitions compiled)]]
      (concat
       (:guards removal-plan)
       (schema-entities relation-kind next-generation
                        (get-in deltas [:relations :additions]))
       (schema-entities permission-kind next-generation
                        (get-in deltas [:permissions :additions]))
       (:removals removal-plan)))}))

(defn- changed-schema?
  [database source compiled deltas]
  (or (not= source (stored-source database))
      (not= (:definitions compiled) (stored-definitions database))
      (seq (get-in deltas [:relations :additions]))
      (seq (get-in deltas [:relations :retractions]))
      (seq (get-in deltas [:permissions :additions]))
      (seq (get-in deltas [:permissions :retractions]))))

(defn- concurrent-write!
  [expected data]
  (schema-error!
   :eacl.schema/concurrent-write :schema-generation-changed
   {:expected-generation expected
    :transaction-reason (:reason data)}))

(defn write-schema!
  ([connection source]
   (write-schema! connection source {}))
  ([connection source options]
   (when-not (= {} options)
     (schema-error! :eacl/invalid-request :unknown-schema-options {}))
   ;; Parsing, restriction checks, and reference checks complete before any
   ;; transaction. Relationship-use and generation checks are deliberately
   ;; repeated inside the one retry-safe state transition.
   (let [compiled (parser/->eacl-schema (parser/parse-schema source))
         database (store/db connection)
         generation (schema-generation database)
         before (read-schema database)
         deltas (model/compare-schema before compiled)
         initial? (zero? generation)
         plan (if initial?
                {:generation 1 :tx-data (initial-tx source compiled)}
                (replacement-tx database source compiled generation deltas))]
     (if (and (not initial?)
              (not (changed-schema? database source compiled deltas)))
       {:db-before database
        :db-after database
        :basis (:basis database)
        :schema-generation generation
        :causal-token (store/causal-token connection)
        :schema before
        :relations (:relations deltas)
        :permissions (:permissions deltas)
        :no-op? true}
       (try
         (let [report (store/transact-internal! connection (:tx-data plan))]
           {:db-before (:db-before report)
            :db-after (:db-after report)
            :basis (:basis report)
            :schema-generation (:generation plan)
            :causal-token (:causal-token report)
            :schema (read-schema (:db-after report))
            :relations (:relations deltas)
            :permissions (:permissions deltas)
            :no-op? false})
         (catch #?(:jank cpp/jank.runtime.object_ref
                   :clj clojure.lang.ExceptionInfo)
                error
           (let [data (ex-data error)]
             (if (and (contains? #{:eacl.transaction/conflict
                                  :eacl.transaction/invalid}
                                (:type data))
                      (contains? #{:compare-and-set-failed
                                   :unique-value-conflict}
                                 (:reason data)))
               (concurrent-write! generation data)
               (throw error)))))))))
