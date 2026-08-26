(ns eacl.datomic.memory.db
  "Immutable database values and ordered seek-only read operations."
  (:require [eacl.datomic.memory.datom :as datom]
            [eacl.datomic.memory.index :as index]
            [eacl.datomic.memory.order :as order]
            [eacl.relationships.endpoint-pair :as endpoint-pair]
            [eacl.relationships.storage :as relationship-storage]))

(def ^:private database-kind ::database)
(def ^:private database-fields
  #{::kind :basis :reference-attributes :datoms :indexes
    :relationship-halves-certified?})

(defn- certify-relationship-halves
  [datoms]
  (let [forward (volatile! (transient #{}))
        reverse-as-forward (volatile! (transient #{}))
        valid? (volatile! true)]
    (loop [remaining (seq datoms)]
      (when remaining
        (let [value (first remaining)
              attribute (:a value)]
          (cond
            (= relationship-storage/forward-attribute attribute)
            (if (endpoint-pair/endpoint-value? (:v value))
              (vreset! forward (conj! @forward [(:e value) (:v value)]))
              (vreset! valid? false))

            (= relationship-storage/reverse-attribute attribute)
            (if-let [peer (endpoint-pair/peer-half
                           :reverse (:e value) (:v value))]
              (vreset! reverse-as-forward
                       (conj! @reverse-as-forward
                              [(:endpoint-eid peer) (:value peer)]))
              (vreset! valid? false))))
        (recur (next remaining))))
    (let [forward (persistent! @forward)
          reverse-as-forward (persistent! @reverse-as-forward)]
      (and @valid? (= forward reverse-as-forward)))))

(defn- database-error!
  [reason data]
  (throw
   (ex-info
    "Invalid EACL memory database value or read."
    (merge {:type :eacl.store/invalid-database
            :eacl/error :eacl.store/invalid-database
            :reason reason}
           data))))

(defn database
  "Construct one immutable database snapshot from current assertions."
  [basis datoms reference-attributes]
  (when-not (order/non-negative-id? basis)
    (database-error! :invalid-basis {}))
  (let [datoms (vec datoms)
        certified? (certify-relationship-halves datoms)
        indexes (index/build-indexes datoms reference-attributes)]
    {::kind database-kind
     :basis basis
     :reference-attributes reference-attributes
     :datoms (get-in indexes [:eavt :datoms])
     :indexes indexes
     :relationship-halves-certified? certified?}))

(defn database?
  [value]
  (and (map? value)
       (= database-fields (set (keys value)))
       (= database-kind (::kind value))
       (order/non-negative-id? (:basis value))
       (set? (:reference-attributes value))
       (vector? (:datoms value))
       (map? (:indexes value))
       (boolean? (:relationship-halves-certified? value))))

(defn- require-database!
  [value]
  (when-not (database? value)
    (database-error! :invalid-database-value {}))
  value)

(defn basis-t
  [value]
  (:basis (require-database! value)))

(defn relationship-halves-certified?
  [value]
  (:relationship-halves-certified? (require-database! value)))

(defn- index-data
  [value index-name]
  (require-database! value)
  (or (get (:indexes value) index-name)
      (database-error! :unsupported-index {:index index-name})))

(defn seek-datoms
  "Return an immutable forward view starting at the inclusive lower bound."
  [value index-name & components]
  (index/seek (index-data value index-name) (vec components)))

(defn rseek-datoms
  "Return a lazy descending stream starting at the inclusive upper bound."
  [value index-name & components]
  (index/rseek (index-data value index-name) (vec components)))

(defn seek-datoms-chunk
  "Internal bounded forward wrapper used by engine reads."
  [value index-name components chunk-size]
  (index/seek-chunk (index-data value index-name)
                    (vec components) chunk-size))

(defn rseek-datoms-chunk
  "Internal bounded reverse wrapper used by engine reads."
  [value index-name components chunk-size]
  (index/rseek-chunk (index-data value index-name)
                     (vec components) chunk-size))

(defn- trusted-index-data
  [value index-name]
  (or (get (:indexes value) index-name)
      (database-error! :unsupported-index {:index index-name})))

(defn- engine-seek-datoms-chunk
  [value index-name components chunk-size]
  (index/seek-chunk-trusted (trusted-index-data value index-name)
                            (vec components) chunk-size))

(defn- engine-rseek-datoms-chunk
  [value index-name components chunk-size]
  (index/rseek-chunk-trusted (trusted-index-data value index-name)
                             (vec components) chunk-size))

(def ^:private read-operations
  {:relationship-halves-certified? relationship-halves-certified?
   :seek-datoms-chunk engine-seek-datoms-chunk
   :rseek-datoms-chunk engine-rseek-datoms-chunk})

(defn read-operation-table
  "Internal factory used when constructing the one bundled engine client.
  The returned table is closed and has no caller-supplied implementation."
  []
  read-operations)
