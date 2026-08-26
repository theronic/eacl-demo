(ns eacl.datomic.memory.api
  "Narrow Datomic-shaped memory API. Reads are ordered seeks; no query API is
  present. The bundled store is a conformance backend, not Datomic Pro."
  (:require [eacl.datomic.memory.datom :as memory-datom]
            [eacl.datomic.memory.db :as memory-db]
            [eacl.datomic.memory.order :as memory-order]
            #?(:jank [eacl.datomic.memory.consistency :as memory-consistency])
            #?(:jank [eacl.datomic.memory.schema :as memory-schema])
            #?(:jank [eacl.datomic.memory.store :as memory-store])))

(def ordering-abi memory-order/ordering-abi)

(defn datom
  [entity attribute value transaction added]
  (memory-datom/datom entity attribute value transaction added))

(defn snapshot
  [basis datoms reference-attributes]
  (memory-db/database basis datoms reference-attributes))

(defn db?
  [value]
  (memory-db/database? value))

(defn basis-t
  [value]
  (memory-db/basis-t value))

(defn seek-datoms
  [value index-name & components]
  (apply memory-db/seek-datoms value index-name components))

(defn rseek-datoms
  [value index-name & components]
  (apply memory-db/rseek-datoms value index-name components))

(defn connect
  ([] #?(:jank (memory-store/connect)
         :clj (throw (ex-info "Jank runtime required." {}))))
  ([options] #?(:jank (memory-store/connect options)
                :clj (throw (ex-info "Jank runtime required." {})))))

(defn db
  [connection]
  #?(:jank (memory-store/db connection)
     :clj (throw (ex-info "Jank runtime required." {}))))

(defn transact!
  [connection tx-data]
  #?(:jank (memory-store/transact! connection tx-data)
     :clj (throw (ex-info "Jank runtime required." {}))))

(defn as-of
  [connection basis]
  #?(:jank (memory-store/as-of connection basis)
     :clj (throw (ex-info "Jank runtime required." {}))))

(defn causal-token
  [connection]
  #?(:jank (memory-store/causal-token connection)
     :clj (throw (ex-info "Jank runtime required." {}))))

#?(:jank
   ;; A forwarding defn frame triggers a pinned-Jank unwinder abort when an
   ;; immediate deadline or cancellation exception crosses it. Directly expose
   ;; the already closed, validated selector until that toolchain defect is
   ;; fixed; this retains both supported arities and their exact behavior.
   (def select-snapshot memory-consistency/select)
   :clj
   (defn select-snapshot
     ([connection descriptor]
      (throw (ex-info "Jank runtime required." {})))
     ([connection descriptor controls]
      (throw (ex-info "Jank runtime required." {})))))

(defn read-schema
  [database]
  #?(:jank (memory-schema/read-schema database)
     :clj (throw (ex-info "Jank runtime required." {}))))

(defn schema-generation
  [database]
  #?(:jank (memory-schema/schema-generation database)
     :clj (throw (ex-info "Jank runtime required." {}))))

#?(:jank
   ;; See select-snapshot above: immediate validation exceptions must not cross
   ;; a forwarding defn frame on the pinned Jank toolchain.
   (def write-schema! memory-schema/write-schema!)
   :clj
   (defn write-schema!
     ([connection source]
      (throw (ex-info "Jank runtime required." {})))
     ([connection source options]
      (throw (ex-info "Jank runtime required." {})))))
