(ns eacl-demo.storage-v8
  "Explicit maintenance of isolated copies; never opens a serving source writable."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [clojure.string :as str])
  (:import [java.lang.management ManagementFactory]
           [java.security MessageDigest]
           [java.util Date UUID]))

(defn emit! [value]
  (locking *out*
    (println (json/write-str value))
    (flush)))

(defn- runtime-statistics []
  (let [heap (.getHeapMemoryUsage (ManagementFactory/getMemoryMXBean))]
    {:kind "jvm-heartbeat" :heapUsedBytes (.getUsed heap) :heapMaxBytes (.getMax heap)
     :gcTimeMs (reduce + (map #(max 0 (.getCollectionTime %))
                              (ManagementFactory/getGarbageCollectorMXBeans)))}))

(defn- start-heartbeat! []
  (doto (Thread. (fn []
                   (loop []
                     (Thread/sleep 60000)
                     (emit! (runtime-statistics))
                     (recur)))
                 "storage-migration-heartbeat")
    (.setDaemon true)
    (.start)))

(defn application-signature
  "Digest application datoms independently of the relationship certificate."
  [rows ident]
  (let [digest (MessageDigest/getInstance "SHA-256")
        ident (memoize ident)
        total (reduce
               (fn [n {:keys [e a v]}]
                 (let [attribute (ident a)
                       space (namespace attribute)]
                   (when-not (keyword? attribute)
                     (throw (ex-info "Unresolved attribute" {:attribute a})))
                   (if (or (= space "db") (str/starts-with? (or space "") "db.")
                           (= space "eacl")
                           (and (str/starts-with? (or space "") "eacl.")
                                (not= space "eacl.demo")))
                     n
                     (do (.update digest (.getBytes (str (pr-str [e attribute v]) "\n") "UTF-8"))
                         (inc n)))))
               0 rows)]
    {:datoms total :sha256 (format "%064x" (java.math.BigInteger. 1 (.digest digest)))}))

(defn migrate-connection!
  "Runs the pinned native migrations and checks content before admitting v8."
  [conn {:keys [db rows ident permission-migrate relationship-migrate make-client]}]
  (let [before-db (db conn)
        before (application-signature (rows before-db) #(ident before-db %))
        _ (emit! {:kind "application-before" :signature before})
        permissions (permission-migrate conn)
        _ (emit! {:kind "permissions-complete" :report permissions})
        relationships (relationship-migrate
                       conn {:quiesced? true :batch-size 1000
                             :on-progress #(emit! {:kind "relationship-progress" :report %})})
        after-db (db conn)
        after (application-signature (rows after-db) #(ident after-db %))
        _ (emit! {:kind "application-after" :signature after})]
    (when-not (and (= :complete (:state relationships))
                   (= 8 (:storage-version relationships))
                   (= before after))
      (throw (ex-info "Migration did not preserve application data"
                      {:before before :after after :relationships relationships})))
    ;; Construction independently enforces both physical storage admission gates.
    (make-client conn {:source-lifecycle (UUID/randomUUID)
                       :read-only? true :security-key (str (UUID/randomUUID))})
    {:kind "migration-complete" :status "ready" :storageVersion 8
     :application after :relationships relationships}))

(defn datahike!
  [path store-id]
  (require 'datahike.api 'eacl.datahike.core
           'eacl.datahike.migrations.v7-to-v8
           'eacl.datahike.migrations.relationships-v7-to-v8)
  (let [resolve! requiring-resolve
        db (resolve! 'datahike.api/db)
        config {:store {:backend :file :path (.getCanonicalPath (io/file path))
                        :id (UUID/fromString store-id)}
                :writer {:backend :self :writer-ownership :exclusive}
                :schema-flexibility :write :attribute-refs? true :keep-history? false
                :max-string-length 0 :store-cache-size 1024 :search-cache-size 0
                :index-config {:diff-buf-size 256} :fuse-index-roots? true :commit-graph? false}
        conn ((resolve! 'datahike.api/connect) config)]
    (try
      (let [result (migrate-connection!
                    conn {:db db
                          :rows #((resolve! 'datahike.api/datoms) % {:index :eavt})
                          :ident (fn [database a]
                                   (:db/ident ((resolve! 'datahike.api/entity) database a)))
                          :permission-migrate (resolve! 'eacl.datahike.migrations.v7-to-v8/migrate!)
                          :relationship-migrate (resolve! 'eacl.datahike.migrations.relationships-v7-to-v8/migrate!)
                          :make-client (resolve! 'eacl.datahike.core/make-client)})
            ;; Only this disposable local copy is compacted. The retained source
            ;; is never touched, and no object-age deletion is used on S3.
            deleted ((resolve! 'datahike.api/gc-storage) conn
                                                         (Date. (inc (System/currentTimeMillis))) {:min-age-ms 0})
            deleted (if (instance? clojure.lang.IDeref deleted) @deleted deleted)]
        (when (instance? Throwable deleted) (throw deleted))
        (emit! (assoc result :compactedKeys (count deleted))))
      (finally ((resolve! 'datahike.api/release) conn)))))

(defn datomic!
  [table]
  (when-not (= table "eacl-demo-datomic-fixture-v8")
    (throw (ex-info "Refusing a non-target Datomic table" {:table table})))
  (require 'datomic.api 'eacl.datomic.core 'eacl.migrations.v7-to-v8
           'eacl.datomic.migrations.relationships-v7-to-v8)
  (let [r requiring-resolve
        conn ((r 'datomic.api/connect) (str "datomic:ddb://us-east-1/" table "/eacl-demo"))]
    (try
      (let [result (migrate-connection!
                    conn {:db (r 'datomic.api/db)
                          :rows #((r 'datomic.api/datoms) % :eavt)
                          :ident (r 'datomic.api/ident)
                          :permission-migrate (r 'eacl.migrations.v7-to-v8/migrate!)
                          :relationship-migrate (r 'eacl.datomic.migrations.relationships-v7-to-v8/migrate!)
                          :make-client (r 'eacl.datomic.core/make-client)})]
        ((r 'datomic.api/request-index) conn)
        (let [indexed ((r 'datomic.api/sync-index) conn ((r 'datomic.api/basis-t) ((r 'datomic.api/db) conn)))]
          (when (= ::timeout (deref indexed 600000 ::timeout))
            (throw (ex-info "Datomic indexing timed out" {}))))
        (emit! result))
      (finally ((r 'datomic.api/release) conn)))))

(defn -main [& [backend path store-id]]
  (start-heartbeat!)
  (try
    (case backend
      "datahike" (datahike! path store-id)
      "datomic" (datomic! path)
      (throw (ex-info "Unknown maintenance backend" {:backend backend})))
    (shutdown-agents)
    (System/exit 0)
    (catch Throwable error
      (.printStackTrace error)
      (shutdown-agents)
      (System/exit 1))))
