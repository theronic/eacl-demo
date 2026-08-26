(ns eacl.datomic.memory
  "Public constructor for the bundled Datomic-shaped in-memory EACL backend.

  The store is a conformance prototype. The client and authorization engine it
  hosts are the production-quality Jank port."
  (:require [eacl.client.orchestration :as client]
            [eacl.datomic.memory.api :as api]
            [eacl.datomic.memory.db :as memory-db]
            [eacl.datomic.memory.order :as memory-order]
            #?(:jank [eacl.datomic.memory.relationships :as relationships])
            #?(:jank [eacl.datomic.memory.store :as store])))

(def connect api/connect)
(def db api/db)
(def basis-t api/basis-t)
(def transact! api/transact!)
(def as-of api/as-of)
(def causal-token api/causal-token)
(def select-snapshot api/select-snapshot)
(def seek-datoms api/seek-datoms)
(def rseek-datoms api/rseek-datoms)

#?(:jank
   (do
     ;; Pinned Jank cannot reliably unwind an exception across an indirect
     ;; function-table invocation. Every private operation therefore catches
     ;; inside its direct backend frame and returns one exact envelope.
     (defn- select-operation
       [connection descriptor controls]
       (try
         {:value (api/select-snapshot connection descriptor controls)
          :error nil}
         (catch cpp/jank.runtime.object_ref error
           {:value nil :error error})))

     (defn- read-operations-operation
       []
       (try
         {:value (memory-db/read-operation-table) :error nil}
         (catch cpp/jank.runtime.object_ref error
           {:value nil :error error})))

     (defn- source-scope-operation
       [connection]
       (try
         {:value (store/identities connection) :error nil}
         (catch cpp/jank.runtime.object_ref error
           {:value nil :error error})))

     (defn- read-schema-operation
       [database]
       (try
         {:value (api/read-schema database) :error nil}
         (catch cpp/jank.runtime.object_ref error
           {:value nil :error error})))

     (defn- write-schema-operation
       [connection source]
       (try
         {:value (api/write-schema! connection source) :error nil}
         (catch cpp/jank.runtime.object_ref error
           {:value nil :error error})))

     (defn- read-relationship-window-operation
       [database filters direction anchor requested candidate-limit contract]
       (try
         {:value
          (relationships/read-relationship-window
           database filters direction anchor requested candidate-limit contract)
          :error nil}
         (catch cpp/jank.runtime.object_ref error
           {:value nil :error error})))

     (defn- write-relationships-operation
       [connection updates]
       (try
         {:value (relationships/write-relationships! connection updates)
          :error nil}
         (catch cpp/jank.runtime.object_ref error
           {:value nil :error error})))

     (defn- delete-object-operation
       [connection object]
       (try
         {:value (relationships/delete-object! connection object)
          :error nil}
         (catch cpp/jank.runtime.object_ref error
           {:value nil :error error})))

   (def ^:private client-operations
     {:select-snapshot select-operation
      :read-operations read-operations-operation
      :source-scope source-scope-operation
      :read-schema read-schema-operation
      :write-schema write-schema-operation
      :read-relationship-window read-relationship-window-operation
      :write-relationships write-relationships-operation
      :delete-object delete-object-operation
      :ordering-abi memory-order/ordering-abi})))

(defn make-client
  ([connection]
   (make-client connection {}))
  ([connection options]
   #?(:jank
      (do
        (when-not (store/connection? connection)
          (throw
           (ex-info
            "make-client requires an EACL memory connection."
            {:type :eacl.store/invalid-connection
             :eacl/error :eacl.store/invalid-connection
             :reason :invalid-client-connection})))
        (client/make-client* connection client-operations options))
      :clj
      (throw (ex-info "Jank runtime required." {})))))

(def expire-cache! client/expire-cache!)
(def cache-stats client/cache-stats)
