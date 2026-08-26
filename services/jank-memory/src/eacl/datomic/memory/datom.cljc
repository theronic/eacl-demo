(ns eacl.datomic.memory.datom
  "Validated plain-map datoms used by immutable memory snapshots."
  (:require [eacl.datomic.memory.order :as order]))

(def datom-fields #{:e :a :v :tx :added})

(defn- invalid-datom!
  [reason data]
  (throw
   (ex-info
    "Invalid EACL memory-store datom."
    (merge {:type :eacl.store/invalid-datom
            :eacl/error :eacl.store/invalid-datom
            :reason reason}
           data))))

(defn datom
  "Construct a validated Datomic-shaped immutable datom map."
  [entity attribute value transaction added]
  (when-not (order/non-negative-id? entity)
    (invalid-datom! :invalid-entity {:field :e}))
  (when-not (keyword? attribute)
    (invalid-datom! :invalid-attribute {:field :a}))
  (try
    (order/value-order-key value)
    (catch #?(:jank cpp/jank.runtime.object_ref
              :clj clojure.lang.ExceptionInfo)
           error
      (if (= :eacl.store/invalid-indexed-value (:type (ex-data error)))
        (invalid-datom! :invalid-value
                        {:field :v :value-reason (:reason (ex-data error))})
        (throw error))))
  (when-not (order/non-negative-id? transaction)
    (invalid-datom! :invalid-transaction {:field :tx}))
  (when-not (or (true? added) (false? added))
    (invalid-datom! :invalid-added {:field :added}))
  {:e entity :a attribute :v value :tx transaction :added added})

(defn datom?
  [value]
  (and (map? value)
       (= datom-fields (set (keys value)))
       (try
         (datom (:e value) (:a value) (:v value)
                (:tx value) (:added value))
         true
         (catch #?(:jank cpp/jank.runtime.object_ref
                   :clj clojure.lang.ExceptionInfo)
                _
           false))))

(defn require-assertion!
  [value]
  (when-not (datom? value)
    (invalid-datom! :invalid-shape {}))
  (when-not (true? (:added value))
    (invalid-datom! :retraction-in-snapshot {}))
  value)
