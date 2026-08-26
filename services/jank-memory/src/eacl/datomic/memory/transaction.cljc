(ns eacl.datomic.memory.transaction
  "Pure, retry-safe transaction planning over one immutable memory snapshot."
  (:require [eacl.datomic.memory.datom :as datom]
            [eacl.datomic.memory.db :as memory-db]
            [eacl.datomic.memory.order :as order]))

(def maximum-transaction-forms 10000)
(def ^:private auto-temp-kind :eacl.transaction/auto-temp)

(defn- transaction-error!
  ([reason]
   (transaction-error! reason {}))
  ([reason data]
   (throw
    (ex-info
     "Invalid or conflicting EACL memory transaction."
     (merge {:type :eacl.transaction/invalid
             :eacl/error :eacl.transaction/invalid
             :reason reason}
            data)))))

(defn- conflict!
  [reason data]
  (throw
   (ex-info
    "EACL memory transaction precondition failed."
    (merge {:type :eacl.transaction/conflict
            :eacl/error :eacl.transaction/conflict
            :reason reason}
           data))))

(defn- auto-temp
  [position]
  [auto-temp-kind position])

(defn- auto-temp?
  [value]
  (and (vector? value)
       (= 2 (count value))
       (= auto-temp-kind (first value))
       (order/non-negative-id? (second value))))

(defn- supplied-temp?
  [value]
  (and (integer? value) (neg? value)))

(defn- temp?
  [value]
  (or (auto-temp? value) (supplied-temp? value)))

(defn- lookup-ref?
  [value]
  (and (vector? value)
       (= 2 (count value))
       (keyword? (first value))
       (not= auto-temp-kind (first value))))

(defn- normalize-form
  [position form]
  (cond
    (map? form)
    (do
      (when (empty? (dissoc form :db/id))
        (transaction-error! :empty-entity-map {:form-index position}))
      (doseq [attribute (keys (dissoc form :db/id))]
        (when-not (keyword? attribute)
          (transaction-error! :invalid-entity-map-attribute
                              {:form-index position})))
      (if (contains? form :db/id)
        form
        (assoc form :db/id (auto-temp position))))

    (vector? form)
    (let [operation (first form)
          expected-count (case operation
                           :db/add 4
                           :db/retract 4
                           :db/cas 5
                           :db/retractEntity 2
                           :eacl.tx/assert-relationship-absent 8
                           :eacl.tx/retract-relationship-halves 5
                           :eacl.tx/assert-relation-unused 4
                           nil)]
      (when-not expected-count
        (transaction-error! :unsupported-form {:form-index position}))
      (when-not (= expected-count (count form))
        (transaction-error! :invalid-form-arity
                            {:form-index position
                             :operation operation}))
      form)

    :else
    (transaction-error! :invalid-form {:form-index position})))

(defn normalize-tx-data
  [tx-data]
  (when-not (vector? tx-data)
    (transaction-error! :transaction-must-be-vector {}))
  (when (> (count tx-data) maximum-transaction-forms)
    (transaction-error! :too-many-forms
                        {:maximum maximum-transaction-forms}))
  (loop [position 0
         result []]
    (if (= position (count tx-data))
      result
      (recur (inc position)
             (conj result (normalize-form position
                                          (nth tx-data position)))))))

(defn- form-entity-ref
  [form]
  (if (map? form) (:db/id form) (second form)))

(defn- allocate-tempids
  [forms next-eid]
  (loop [remaining (seq forms)
         next-eid next-eid
         tempids {}]
    (if-not remaining
      {:tempids tempids :next-eid next-eid}
      (let [entity-ref (form-entity-ref (first remaining))]
        (if (and (temp? entity-ref) (not (contains? tempids entity-ref)))
          (do
            (when-not (order/non-negative-id? next-eid)
              (transaction-error! :entity-id-exhausted {}))
            (recur (next remaining) (inc (bigint next-eid))
                   (assoc tempids entity-ref next-eid)))
          (recur (next remaining) next-eid tempids))))))

(defn- exact-prefix-first
  [database index-name components]
  (let [candidate
        (first (memory-db/seek-datoms-chunk
                database index-name components 1))]
    (when (and candidate
               (= components
                  (subvec
                   (case index-name
                     :eavt [(:e candidate) (:a candidate)
                            (:v candidate) (:tx candidate)]
                     :avet [(:a candidate) (:v candidate)
                            (:e candidate) (:tx candidate)])
                   0 (count components))))
      candidate)))

(defn- current-entity-exists?
  [database entity]
  (boolean (exact-prefix-first database :eavt [entity])))

(defn- current-lookup
  [database unique-attributes lookup-ref]
  (let [[attribute value] lookup-ref]
    (when-not (contains? unique-attributes attribute)
      (transaction-error! :lookup-attribute-not-unique
                          {:attribute attribute}))
    (some-> (exact-prefix-first database :avet [attribute value]) :e)))

(defn- base-resolve-entity
  [database unique-attributes tempids entity-ref]
  (cond
    (temp? entity-ref) (get tempids entity-ref)

    (order/non-negative-id? entity-ref)
    (when (current-entity-exists? database entity-ref) entity-ref)

    (lookup-ref? entity-ref)
    (current-lookup database unique-attributes entity-ref)

    :else nil))

(defn- unique-additions
  [form unique-attributes]
  (cond
    (map? form)
    (keep (fn [[attribute value]]
            (when (contains? unique-attributes attribute)
              [attribute value]))
          (dissoc form :db/id))

    (and (= :db/add (first form))
         (contains? unique-attributes (nth form 2)))
    [[(nth form 2) (nth form 3)]]

    :else []))

(defn- register-pending-unique
  [pending attribute value entity]
  (when (and (= :eacl/id attribute)
             (not (and (string? value) (not (empty? value)))))
    (transaction-error! :invalid-eacl-id {}))
  (let [key [attribute value]
        existing (get pending key)]
    (when (and existing (not= existing entity))
      (conflict! :unique-value-conflict
                 {:attribute attribute :value value}))
    (assoc pending key entity)))

(defn- resolve-deferred-unique
  [database unique-attributes tempids deferred pending]
  (loop [remaining (seq deferred)
         pending pending]
    (if-not remaining
      pending
      (let [[entity-ref attribute value] (first remaining)
            entity (or (base-resolve-entity
                        database unique-attributes tempids entity-ref)
                       (get pending entity-ref))]
        (when-not entity
          (transaction-error! :unresolved-entity
                              {:entity-ref entity-ref}))
        (recur (next remaining)
               (register-pending-unique
                pending attribute value entity))))))

(defn- collect-pending-unique
  [database forms unique-attributes tempids]
  (loop [remaining (seq forms)
         deferred []
         pending {}]
    (if-not remaining
      (resolve-deferred-unique database unique-attributes tempids
                               deferred pending)
      (let [form (first remaining)
            entity-ref (form-entity-ref form)
            entity (base-resolve-entity
                    database unique-attributes tempids entity-ref)
            additions (unique-additions form unique-attributes)]
        (if entity
          (recur
           (next remaining)
           deferred
           (reduce (fn [result [attribute value]]
                     (register-pending-unique
                      result attribute value entity))
                   pending additions))
          (recur
           (next remaining)
           (into deferred
                 (map (fn [[attribute value]]
                        [entity-ref attribute value]) additions))
           pending))))))

(defn- resolve-entity!
  [database unique-attributes tempids pending entity-ref]
  (or (base-resolve-entity database unique-attributes tempids entity-ref)
      (when (lookup-ref? entity-ref) (get pending entity-ref))
      (transaction-error! :unresolved-entity {:entity-ref entity-ref})))

(defn- resolve-value!
  [database unique-attributes reference-attributes tempids pending
   attribute value transaction]
  (if (= :db/current-tx value)
    transaction
    (if (contains? reference-attributes attribute)
      (resolve-entity! database unique-attributes tempids pending value)
      value)))

(defn- assertion-map
  [database]
  (into {} (map (fn [value]
                  [[(:e value) (:a value) (:v value)] value])
                (:datoms database))))

(defn- entity-attribute-keys
  [assertions entity attribute]
  (filterv (fn [[candidate-entity candidate-attribute _]]
             (and (= entity candidate-entity)
                  (= attribute candidate-attribute)))
           (keys assertions)))

(defn- apply-add
  [assertions entity attribute value transaction cardinality-many-attributes]
  (let [new-datom (datom/datom entity attribute value transaction true)
        identity [entity attribute value]]
    (if (contains? assertions identity)
      assertions
      (let [assertions
            (if (contains? cardinality-many-attributes attribute)
              assertions
              (reduce dissoc assertions
                      (entity-attribute-keys assertions entity attribute)))]
        (assoc assertions identity new-datom)))))

(defn- apply-retract
  [assertions entity attribute value]
  ;; Validate the whole retraction even when it is currently absent.
  (datom/datom entity attribute value 0 true)
  (dissoc assertions [entity attribute value]))

(defn- current-values
  [assertions entity attribute]
  (mapv (fn [[_ _ value]] value)
        (entity-attribute-keys assertions entity attribute)))

(defn- apply-cas
  [assertions entity attribute expected replacement transaction
   cardinality-many-attributes]
  (when (contains? cardinality-many-attributes attribute)
    (transaction-error! :cas-on-cardinality-many {:attribute attribute}))
  (let [actual-values (current-values assertions entity attribute)
        actual (when (= 1 (count actual-values)) (first actual-values))]
    (when-not (and (<= (count actual-values) 1)
                   (= expected actual))
      (let [data {:entity entity :attribute attribute
                  :expected expected :actual actual-values
                  :reason :compare-and-set-failed}]
        (cond
          (contains? #{:eacl/schema-generation :eacl/relation-version}
                     attribute)
          (throw
           (ex-info
            "EACL generation changed concurrently."
            (merge {:type :eacl.schema/concurrent-write
                    :eacl/error :eacl.schema/concurrent-write}
                   data)))

          (= :eacl/id attribute)
          (throw
           (ex-info
            "EACL object identity changed concurrently."
            (merge {:type :eacl/unknown-object
                    :eacl/error :eacl/unknown-object}
                   data)))

          :else
          (conflict! :compare-and-set-failed
                     (dissoc data :reason)))))
    (let [without-current
          (reduce dissoc assertions
                  (entity-attribute-keys assertions entity attribute))]
      (if (nil? replacement)
        without-current
        (apply-add without-current entity attribute replacement transaction
                   cardinality-many-attributes)))))

(defn- apply-retract-entity
  [assertions entity reference-attributes]
  (into {}
        (remove
         (fn [[[candidate-entity attribute value] _]]
           (or (= entity candidate-entity)
               (and (contains? reference-attributes attribute)
                    (= entity value))))
         assertions)))

(defn- endpoint-value?
  [value]
  (and (vector? value)
       (= 4 (count value))
       (keyword? (nth value 0))
       (order/non-negative-id? (nth value 1))
       (keyword? (nth value 2))
       (order/non-negative-id? (nth value 3))))

(defn- require-endpoint-value!
  [value]
  (when-not (endpoint-value? value)
    (transaction-error! :malformed-relationship-half {:value value}))
  value)

(defn- retract-touching-relationship-halves
  [assertions target forward-attribute reverse-attribute
   relation-version-attribute transaction cardinality-many-attributes]
  (reduce
   (fn [result value]
     (let [attribute (:a value)]
       (if (and (contains? #{forward-attribute reverse-attribute} attribute)
                (let [endpoint (require-endpoint-value! (:v value))]
                  (or (= target (:e value))
                      (= target (nth endpoint 3)))))
         (let [endpoint (require-endpoint-value! (:v value))
               endpoint-entity (:e value)
               relation (nth endpoint 1)
               peer (nth endpoint 3)
               peer-attribute (if (= forward-attribute attribute)
                                reverse-attribute forward-attribute)
               peer-value [(nth endpoint 2) relation
                           (nth endpoint 0) endpoint-entity]
               without-halves
               (-> result
                   (dissoc [endpoint-entity attribute endpoint])
                   (dissoc [peer peer-attribute peer-value]))]
           (apply-add without-halves relation
                      relation-version-attribute transaction transaction
                      cardinality-many-attributes))
         result)))
   assertions (vals assertions)))

(defn- assert-relation-unused!
  [assertions relation forward-attribute reverse-attribute]
  (when
   (some
    (fn [value]
      (when (contains? #{forward-attribute reverse-attribute} (:a value))
        (let [endpoint (require-endpoint-value! (:v value))]
          (= relation (nth endpoint 1)))))
    (vals assertions))
    (throw
     (ex-info
      "Cannot remove an EACL relation used by relationships."
      {:type :eacl.schema/relation-in-use
       :eacl/error :eacl.schema/relation-in-use
       :relation-eid relation})))
  assertions)

(defn- apply-form
  [database assertions form transaction config tempids pending]
  (let [{:keys [unique-attributes reference-attributes
                cardinality-many-attributes]} config
        resolve-entity
        #(resolve-entity! database unique-attributes tempids pending %)]
    (cond
      (map? form)
      (let [entity (resolve-entity (:db/id form))]
        (reduce
         (fn [result [attribute raw-value]]
           (apply-add
            result entity attribute
            (resolve-value! database unique-attributes reference-attributes
                            tempids pending attribute raw-value transaction)
            transaction cardinality-many-attributes))
         assertions
         (dissoc form :db/id)))

      (= :db/add (first form))
      (let [[_ entity-ref attribute raw-value] form]
        (apply-add
         assertions (resolve-entity entity-ref) attribute
         (resolve-value! database unique-attributes reference-attributes
                         tempids pending attribute raw-value transaction)
         transaction cardinality-many-attributes))

      (= :db/retract (first form))
      (let [[_ entity-ref attribute raw-value] form]
        (apply-retract
         assertions (resolve-entity entity-ref) attribute
         (resolve-value! database unique-attributes reference-attributes
                         tempids pending attribute raw-value transaction)))

      (= :db/cas (first form))
      (let [[_ entity-ref attribute raw-expected raw-replacement] form
            resolve #(when-not (nil? %)
                       (resolve-value!
                        database unique-attributes reference-attributes
                        tempids pending attribute % transaction))]
        (apply-cas assertions (resolve-entity entity-ref) attribute
                   (resolve raw-expected) (resolve raw-replacement)
                   transaction cardinality-many-attributes))

      (= :db/retractEntity (first form))
      (apply-retract-entity assertions (resolve-entity (second form))
                            reference-attributes)

      (= :eacl.tx/assert-relationship-absent (first form))
      (let [[_ subject forward-attribute forward-value
             resource reverse-attribute reverse-value relationship] form
            subject (resolve-entity subject)
            resource (resolve-entity resource)]
        (require-endpoint-value! forward-value)
        (require-endpoint-value! reverse-value)
        (when (and (contains? assertions
                              [subject forward-attribute forward-value])
                   (contains? assertions
                              [resource reverse-attribute reverse-value]))
          (throw
           (ex-info
            "Relationship already exists."
            {:type :eacl/relationship-conflict
             :eacl/error :eacl/relationship-conflict
             :reason :relationship-already-exists
             :relationship relationship})))
        assertions)

      (= :eacl.tx/retract-relationship-halves (first form))
      (let [[_ target forward-attribute reverse-attribute
             relation-version-attribute] form]
        (retract-touching-relationship-halves
         assertions (resolve-entity target) forward-attribute reverse-attribute
         relation-version-attribute transaction
         cardinality-many-attributes))

      (= :eacl.tx/assert-relation-unused (first form))
      (let [[_ relation forward-attribute reverse-attribute] form]
        (assert-relation-unused! assertions (resolve-entity relation)
                                 forward-attribute reverse-attribute)))))

(defn- validate-unique!
  [assertions unique-attributes]
  (loop [remaining (seq (vals assertions))
         seen {}]
    (when remaining
      (let [{:keys [e a v]} (first remaining)]
        (if (contains? unique-attributes a)
          (let [prior (get seen [a v])]
            (when (and prior (not= prior e))
              (conflict! :unique-value-conflict
                         {:attribute a :value v}))
            (recur (next remaining) (assoc seen [a v] e)))
          (recur (next remaining) seen))))))

(defn- tx-datoms
  [before after transaction]
  (let [removed
        (->> before
             (keep (fn [[identity value]]
                     (when-not (contains? after identity)
                       (assoc value :tx transaction :added false))))
             vec)
        added
        (->> after
             (keep (fn [[identity value]]
                     (when-not (contains? before identity) value)))
             vec)]
    (into removed added)))

(defn apply-transaction
  "Pure transition. All state-dependent checks and allocations happen here so
  an atom retry recomputes them from the state actually being replaced."
  [database next-eid new-basis normalized-tx-data config]
  (when-not (and (order/non-negative-id? new-basis)
                 (pos? new-basis))
    (transaction-error! :basis-exhausted {}))
  (let [{:keys [tempids next-eid]}
        (allocate-tempids normalized-tx-data next-eid)
        pending
        (collect-pending-unique database normalized-tx-data
                                (:unique-attributes config) tempids)
        before (assertion-map database)
        after
        (reduce (fn [assertions form]
                  (apply-form database assertions form new-basis
                              config tempids pending))
                before normalized-tx-data)]
    (validate-unique! after (:unique-attributes config))
    {:next-eid next-eid
     :tempids tempids
     :assertions (vec (vals after))
     :tx-data (tx-datoms before after new-basis)}))
