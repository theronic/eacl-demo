(ns eacl.datomic.memory.relationships
  "Atomic paired relationship storage using only immutable index seeks."
  (:require [eacl.domain :as eacl]
            [eacl.datomic.memory.db :as memory-db]
            [eacl.datomic.memory.order :as memory-order]
            [eacl.datomic.memory.schema :as memory-schema]
            [eacl.datomic.memory.store :as store]
            [eacl.relationships.endpoint-pair :as endpoint-pair]
            [eacl.relationships.filters :as filters]
            [eacl.relationships.mutations :as mutations]
            [eacl.relationships.storage :as relationship-storage]
            [eacl.schema.model :as model]
            [eacl.execution :as execution]))

(def ^:private relation-version-attribute :eacl/relation-version)

(defn- relationship-error!
  [type reason data]
  (throw
   (ex-info
    "EACL relationship operation failed."
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

(defn- entity-id-by-external-id
  [database external-id]
  (some-> (first (exact-datoms database :avet [:eacl/id external-id])) :e))

(defn- external-id-by-entity
  [database entity]
  (some-> (first (exact-datoms database :eavt [entity :eacl/id])) :v))

(defn- existing-object!
  [database object]
  (or (entity-id-by-external-id database (:id object))
      (relationship-error! :eacl/unknown-object :unknown-object
                           {:object object})))

(defn- relation-id!
  [database resource-type relation subject-type]
  (or
   (entity-id-by-external-id
    database (model/->relation-id resource-type relation subject-type))
   (relationship-error!
    :eacl/unknown-relation-or-permission :unknown-relation
    {:operation :write-relationships
     :definition resource-type
     :relation relation
     :relation-or-permission relation
     :schema-kind :relation
     :subject/type subject-type})))

(defn- relation-name-by-entity
  [database entity]
  (or (some-> (first (exact-datoms
                      database :eavt
                      [entity :eacl.relation/relation-name])) :v)
      (relationship-error! :eacl.store/integrity-error
                           :missing-relation-entity
                           {:relation-eid entity})))

(defn- relation-definition-map
  [database datom]
  (reduce (fn [result value]
            (assoc result (:a value) (:v value)))
          {:db/id (:e datom)}
          (exact-datoms database :eavt [(:e datom)])))

(defn- relation-definitions-named
  [database relation-name]
  (mapv #(relation-definition-map database %)
        (exact-datoms database :avet
                      [:eacl.relation/relation-name relation-name])))

(defn- schema-guard
  [database]
  (let [generation (memory-schema/schema-generation database)
        control (entity-id-by-external-id
                 database memory-schema/schema-control-id)]
    (when-not (and control (pos? generation))
      (relationship-error! :eacl.cache/generation-unprepared
                           :schema-not-installed {}))
    [:db/cas control :eacl/schema-generation generation generation]))

(defn- identity-guard
  [entity object]
  [:db/cas entity :eacl/id (:id object) (:id object)])

(defn- resolve-relationship
  [database relationship]
  (let [relationship (eacl/normalize-relationship relationship)
        subject (:subject relationship)
        resource (:resource relationship)
        subject-id (existing-object! database subject)
        resource-id (existing-object! database resource)
        relation-id (relation-id! database (:type resource)
                                  (:relation relationship) (:type subject))
        forward
        (endpoint-pair/forward-value
         (:type subject) relation-id (:type resource) resource-id)
        reverse
        (endpoint-pair/reverse-value
         (:type resource) relation-id (:type subject) subject-id)]
    {:relationship relationship
     :subject subject :subject-id subject-id
     :resource resource :resource-id resource-id
     :relation-id relation-id
     :forward-value forward :reverse-value reverse}))

(defn- relationship-complete?
  [database resolved]
  (and
   (seq (exact-datoms
         database :eavt
         [(:subject-id resolved) relationship-storage/forward-attribute
          (:forward-value resolved)]))
   (seq (exact-datoms
         database :eavt
         [(:resource-id resolved) relationship-storage/reverse-attribute
          (:reverse-value resolved)]))))

(defn direct-match?
  [database subject-type subject-id relation-id resource-type resource-id]
  (boolean
   (seq
    (exact-datoms
     database :eavt
     [subject-id relationship-storage/forward-attribute
      (endpoint-pair/forward-value
       subject-type relation-id resource-type resource-id)]))))

(defn subject->resources
  [database subject-type subject-id relation-id resource-type]
  (->> (exact-datoms database :eavt
                     [subject-id relationship-storage/forward-attribute])
       (keep (fn [value]
               (when (endpoint-pair/value-prefix?
                      (:v value) [subject-type relation-id resource-type])
                 (nth (:v value) 3))))))

(defn resource->subjects
  [database resource-type resource-id relation-id subject-type]
  (->> (exact-datoms database :eavt
                     [resource-id relationship-storage/reverse-attribute])
       (keep (fn [value]
               (when (endpoint-pair/value-prefix?
                      (:v value) [resource-type relation-id subject-type])
                 (nth (:v value) 3))))))

(defn- endpoint-adds
  [resolved]
  [[:db/add (:subject-id resolved)
    relationship-storage/forward-attribute (:forward-value resolved)]
   [:db/add (:resource-id resolved)
    relationship-storage/reverse-attribute (:reverse-value resolved)]])

(defn- endpoint-retracts
  [resolved]
  [[:db/retract (:subject-id resolved)
    relationship-storage/forward-attribute (:forward-value resolved)]
   [:db/retract (:resource-id resolved)
    relationship-storage/reverse-attribute (:reverse-value resolved)]])

(defn- create-precondition
  [resolved]
  [:eacl.tx/assert-relationship-absent
   (:subject-id resolved) relationship-storage/forward-attribute
   (:forward-value resolved)
   (:resource-id resolved) relationship-storage/reverse-attribute
   (:reverse-value resolved) (:relationship resolved)])

(defn- plan-update
  [database update]
  (let [resolved (resolve-relationship database (:relationship update))
        complete? (relationship-complete? database resolved)]
    (case (:operation update)
      :create
      (if complete?
        (relationship-error! :eacl/relationship-conflict
                             :relationship-already-exists
                             {:relationship (:relationship update)})
        {:resolved resolved
         :forms (into [(create-precondition resolved)]
                      (endpoint-adds resolved))})

      :touch
      {:resolved resolved
       :forms (if complete? [] (endpoint-adds resolved))}

      :delete
      {:resolved resolved :forms (endpoint-retracts resolved)})))

(defn- distinct-values
  [values]
  (vec (distinct values)))

(defn write-relationships!
  [connection updates]
  (let [updates (mutations/normalize-batch updates)
        database (store/db connection)]
    (if (empty? updates)
      {:db-before database :db-after database
       :basis (:basis database) :tx-data [] :no-op? true
       :causal-token (store/causal-token connection)}
      (let [plans (mapv #(plan-update database %) updates)
            changed-plans (filterv #(seq (:forms %)) plans)]
        (if (empty? changed-plans)
          {:db-before database :db-after database
           :basis (:basis database) :tx-data [] :no-op? true
           :causal-token (store/causal-token connection)}
          (let [resolved (mapv :resolved changed-plans)
                guards
                (distinct-values
                 (mapcat (fn [value]
                           [(identity-guard (:subject-id value)
                                            (:subject value))
                            (identity-guard (:resource-id value)
                                            (:resource value))])
                         resolved))
                forms (distinct-values (mapcat :forms changed-plans))
                preconditions
                (filterv #(= :eacl.tx/assert-relationship-absent (first %))
                         forms)
                mutations
                (filterv #(not= :eacl.tx/assert-relationship-absent (first %))
                         forms)
                stamps
                (mapv (fn [relation]
                        [:db/add relation relation-version-attribute
                         :db/current-tx])
                      (distinct (map :relation-id resolved)))
                tx-data (into [(schema-guard database)]
                              (concat guards preconditions mutations stamps))]
            (assoc (store/transact-internal! connection tx-data)
                   :no-op? false)))))))

(defn delete-object!
  [connection object]
  (let [object (eacl/normalize-object object)
        database (store/db connection)
        entity (existing-object! database object)
        tx-data
        [(schema-guard database)
         (identity-guard entity object)
         [:eacl.tx/retract-relationship-halves
          entity relationship-storage/forward-attribute
          relationship-storage/reverse-attribute
          relation-version-attribute]]]
    (let [report (store/transact-internal! connection tx-data)
          retracted
          (count
           (filter
            #(and (false? (:added %))
                  (contains? relationship-storage/attributes (:a %)))
            (:tx-data report)))]
      (assoc report :retracted-endpoint-datoms retracted))))

(defn- candidate-datoms
  [database filters]
  (cond
    (contains? filters :subject/id)
    (if-let [entity (entity-id-by-external-id database (:subject/id filters))]
      (exact-datoms database :eavt
                    [entity relationship-storage/forward-attribute])
      [])

    (contains? filters :resource/id)
    (if-let [entity (entity-id-by-external-id database (:resource/id filters))]
      (exact-datoms database :eavt
                    [entity relationship-storage/reverse-attribute])
      [])

    (contains? filters :resource/relation)
    (->> (relation-definitions-named
          database (:resource/relation filters))
         (filter
          (fn [definition]
            (and
             (or (not (contains? filters :subject/type))
                 (= (:subject/type filters)
                    (:eacl.relation/subject-type definition)))
             (or (not (contains? filters :resource/type))
                 (= (:resource/type filters)
                    (:eacl.relation/resource-type definition))))))
         (mapcat
          (fn [definition]
            (let [prefix
                  [(:eacl.relation/subject-type definition)
                   (:db/id definition)
                   (:eacl.relation/resource-type definition)]]
              (->> (apply memory-db/seek-datoms
                          database :avet
                          [relationship-storage/forward-attribute prefix])
                   (take-while
                    #(and (= relationship-storage/forward-attribute (:a %))
                          (endpoint-pair/value-prefix? (:v %) prefix)))))))
         vec)

    (contains? filters :subject/type)
    (->> (apply memory-db/seek-datoms
                database :avet
                [relationship-storage/forward-attribute
                 [(:subject/type filters)]])
         (take-while
          #(and (= relationship-storage/forward-attribute (:a %))
                (endpoint-pair/value-prefix?
                 (:v %) [(:subject/type filters)])))
         vec)

    (contains? filters :resource/type)
    (->> (apply memory-db/seek-datoms
                database :avet
                [relationship-storage/reverse-attribute
                 [(:resource/type filters)]])
         (take-while
          #(and (= relationship-storage/reverse-attribute (:a %))
                (endpoint-pair/value-prefix?
                 (:v %) [(:resource/type filters)])))
         vec)

    :else []))

(declare decode-candidate! matches-filters?)

(defn- candidate-groups
  "Return a finite route description whose physical order is the raw Relay
  order for this exact normalized filter map."
  [database filters]
  (cond
    (contains? filters :subject/id)
    (if-let [entity (entity-id-by-external-id database (:subject/id filters))]
      [{:index :eavt
        :prefix [entity relationship-storage/forward-attribute]}]
      [])

    (contains? filters :resource/id)
    (if-let [entity (entity-id-by-external-id database (:resource/id filters))]
      [{:index :eavt
        :prefix [entity relationship-storage/reverse-attribute]}]
      [])

    (contains? filters :resource/relation)
    (->> (relation-definitions-named
          database (:resource/relation filters))
         (filter
          (fn [definition]
            (and
             (or (not (contains? filters :subject/type))
                 (= (:subject/type filters)
                    (:eacl.relation/subject-type definition)))
             (or (not (contains? filters :resource/type))
                 (= (:resource/type filters)
                    (:eacl.relation/resource-type definition))))))
         (mapv
          (fn [definition]
            {:index :avet
             :prefix
             [relationship-storage/forward-attribute
              [(:eacl.relation/subject-type definition)
               (:db/id definition)
               (:eacl.relation/resource-type definition)]]})))

    (contains? filters :subject/type)
    [{:index :avet
      :prefix [relationship-storage/forward-attribute
               [(:subject/type filters)]]}]

    (contains? filters :resource/type)
    [{:index :avet
      :prefix [relationship-storage/reverse-attribute
               [(:resource/type filters)]]}]

    :else []))

(defn- datom-prefix?
  [index-name prefix value]
  (let [actual (index-components index-name value)]
    (and (<= (count prefix) (count actual))
         (every?
          true?
          (map
           (fn [expected observed]
             (if (vector? expected)
               (and (vector? observed)
                    (endpoint-pair/value-prefix? observed expected))
               (= expected observed)))
           prefix (subvec actual 0 (count prefix)))))))

(defn- group-stream
  [database group direction bound]
  (let [index-name (:index group)
        prefix (:prefix group)
        relation-tuple-prefix?
        (and (nil? bound) (= :avet index-name)
             (vector? (second prefix))
             (= 3 (count (second prefix))))
        nested-reverse-start?
        (and (= :backward direction) (nil? bound)
             (= :avet index-name) (vector? (second prefix)))
        components
        (or
         bound
         (cond
           relation-tuple-prefix?
           [(first prefix)
            (conj (second prefix)
                  (if (= :forward direction)
                    0 memory-order/maximum-integer))]

           nested-reverse-start? [(first prefix)]
           :else prefix))
        values
        (if (= :forward direction)
          (apply memory-db/seek-datoms database index-name components)
          (apply memory-db/rseek-datoms database index-name components))]
    (->> values
         (drop-while
          #(or (and bound
                    (= bound (index-components index-name %)))
               (and nested-reverse-start?
                    (not (datom-prefix? index-name prefix %)))))
         (take-while #(datom-prefix? index-name prefix %)))))

(defn- valid-anchor?
  [groups anchor]
  (or
   (nil? anchor)
   (and (vector? anchor) (= 2 (count anchor))
        (integer? (first anchor))
        (<= 0 (first anchor))
        (< (first anchor) (count groups))
        (vector? (second anchor))
        (= 4 (count (second anchor))))))

(defn read-relationship-window
  "Return at most `requested` accepted relationships in physical route order.

  `requested` normally equals page-size + one sentinel. The encrypted cursor
  carries the opaque `[group index-key]` anchor, so no internal entity ID is
  exposed to callers."
  [database raw-filters direction anchor requested candidate-limit contract]
  (let [filters (filters/validate! raw-filters)
        groups (candidate-groups database filters)]
    (when-not (contains? #{:forward :backward} direction)
      (relationship-error! :eacl/invalid-request
                           :invalid-page-direction {}))
    (when-not (and (integer? requested) (pos? requested)
                   (integer? candidate-limit) (pos? candidate-limit))
      (relationship-error! :eacl/invalid-request
                           :invalid-window-limit {}))
    (when-not (and (map? contract) (map? (:limits contract)))
      (relationship-error! :eacl/invalid-request
                           :invalid-window-contract {}))
    (when-not (valid-anchor? groups anchor)
      (relationship-error! :eacl.pagination/invalid-cursor
                           :invalid-relationship-anchor {}))
    (let [initial-group
          (if anchor
            (first anchor)
            (if (= :forward direction) 0 (dec (count groups))))
          step (if (= :forward direction) inc dec)]
      (loop [group-index initial-group
             stream nil
             examined 0
             seen #{}
             result []]
        (execution/check! contract :raw-relationship-window
                          {:candidates-examined examined})
        (cond
          (= requested (count result))
          {:entries result :examined examined}

          (or (neg? group-index) (>= group-index (count groups)))
          {:entries result :examined examined}

          :else
          (let [group (nth groups group-index)
                stream
                (or stream
                    (group-stream
                     database group direction
                     (when (and anchor (= group-index (first anchor)))
                       (second anchor))))]
            (if-not (seq stream)
              (recur (step group-index) nil examined seen result)
              (let [value (first stream)
                    next-examined (inc examined)]
                (when (> next-examined candidate-limit)
                  (relationship-error!
                   :eacl.execution/resource-limit-exceeded
                   :aggregate-limit-exceeded
                   {:limit-kind :candidates-examined
                    :limit candidate-limit :actual next-examined}))
                (let [relationship (decode-candidate! database value)
                      identity
                      [(get-in relationship [:subject :type])
                       (get-in relationship [:subject :id])
                       (:relation relationship)
                       (get-in relationship [:resource :type])
                       (get-in relationship [:resource :id])]
                      accepted?
                      (and (not (contains? seen identity))
                           (matches-filters? relationship filters))
                      remaining-stream (next stream)
                      next-group-index
                      (if remaining-stream group-index (step group-index))]
                  (recur
                   next-group-index remaining-stream next-examined
                   (if accepted? (conj seen identity) seen)
                   (if accepted?
                     (conj result
                           {:relationship relationship
                            :anchor
                            [group-index
                             (index-components (:index group) value)]})
                     result)))))))))))

(defn- decode-candidate!
  [database datom]
  (let [direction (if (= relationship-storage/forward-attribute (:a datom))
                    :forward :reverse)
        decoded (case direction
                  :forward (endpoint-pair/decode-forward (:e datom) (:v datom))
                  :reverse (endpoint-pair/decode-reverse (:e datom) (:v datom)))]
    (when-not decoded
      (relationship-error! :eacl.store/integrity-error
                           :malformed-relationship-half {}))
    (let [peer (endpoint-pair/peer-half direction (:e datom) (:v datom))
          peer-attribute (case direction
                           :forward relationship-storage/reverse-attribute
                           :reverse relationship-storage/forward-attribute)]
      (when-not (seq (exact-datoms
                      database :eavt
                      [(:endpoint-eid peer) peer-attribute (:value peer)]))
        (relationship-error! :eacl.store/integrity-error
                             :dangling-relationship-half {})))
    (let [subject-external (external-id-by-entity database
                                                  (:subject-eid decoded))
          resource-external (external-id-by-entity database
                                                   (:resource-eid decoded))]
      (when-not (and subject-external resource-external)
        (relationship-error! :eacl.store/integrity-error
                             :missing-relationship-endpoint {}))
      (eacl/relationship
       (eacl/spice-object (:subject-type decoded) subject-external)
       (relation-name-by-entity database (:relation-eid decoded))
       (eacl/spice-object (:resource-type decoded) resource-external)))))

(defn- matches-filters?
  [relationship filters]
  (let [subject (:subject relationship)
        resource (:resource relationship)]
    (and (or (not (contains? filters :subject/type))
             (= (:subject/type filters) (:type subject)))
         (or (not (contains? filters :subject/id))
             (= (:subject/id filters) (:id subject)))
         (or (not (contains? filters :resource/type))
             (= (:resource/type filters) (:type resource)))
         (or (not (contains? filters :resource/id))
             (= (:resource/id filters) (:id resource)))
         (or (not (contains? filters :resource/relation))
             (= (:resource/relation filters) (:relation relationship))))))

(defn read-relationships
  [database raw-filters]
  (let [filters (filters/validate! raw-filters)]
    (->> (candidate-datoms database filters)
         (map #(decode-candidate! database %))
         (filter #(matches-filters? % filters))
         distinct
         (sort-by (fn [value]
                    [(str (get-in value [:subject :type]))
                     (get-in value [:subject :id])
                     (str (:relation value))
                     (str (get-in value [:resource :type]))
                     (get-in value [:resource :id])]))
         vec)))
