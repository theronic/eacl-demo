(ns eacl-demo.storage-v8-test
  (:require [clojure.test :refer [deftest is testing]]
            [datahike.api :as dh]
            [datomic.api :as dt]
            [eacl.core :as eacl]
            [eacl.datahike.core :as dh-eacl]
            [eacl.datahike.schema :as dh-schema]
            [eacl.datahike.migrations.v7-to-v8 :as dh-permissions]
            [eacl.datahike.migrations.relationships-v7-to-v8 :as dh-relationships]
            [eacl.datomic.core :as dt-eacl]
            [eacl.datomic.schema :as dt-schema]
            [eacl.datomic.storage :as dt-storage]
            [eacl.migrations.v7-to-v8 :as dt-permissions]
            [eacl.datomic.migrations.relationships-v7-to-v8 :as dt-relationships]
            [eacl.relationships.legacy-v7 :as legacy]
            [eacl-demo.storage-v8 :as migration]
            [eacl-demo.datomic-dynamodb.reader :as reader]))

(def schema "definition user {}\ndefinition document {\n relation viewer: user\n permission view = viewer\n}\n")

(defn seed! [conn {:keys [db transact entid write-schema]}]
  (write-schema conn schema)
  (transact conn [{:db/ident :demo/title :db/valueType :db.type/string :db/cardinality :db.cardinality/one}])
  (transact conn [{:eacl/id "schema-string" :eacl/storage-version 7}
                  {:eacl/id "document" :demo/title "Retain this title"}
                  {:eacl/id "alice"} {:eacl/id "bob"}])
  (let [database (db conn)
        relation (entid database [:eacl.relation/resource-type+relation-name+subject-type [:document :viewer :user]])
        doc (entid database [:eacl/id "document"])
        alice (entid database [:eacl/id "alice"])]
    (transact conn [[:db/add alice legacy/forward-attribute [:user relation :document doc]]
                    [:db/add doc legacy/reverse-attribute [:document relation :user alice]]])))

(defn exercise! [conn adapter]
  (seed! conn adapter)
  (let [report (binding [*out* (java.io.StringWriter.)]
                 (migration/migrate-connection! conn adapter))
        client ((:make-client adapter) conn {:source-lifecycle (random-uuid)
                                             :read-only? true :security-key (str (random-uuid))})]
    (is (= "ready" (:status report)))
    (is (= 1 (get-in report [:relationships :source-count])))
    (is (pos? (get-in report [:application :datoms])))
    (is (true? (eacl/can? client (eacl/spice-object :user "alice") :view (eacl/spice-object :document "document"))))
    (is (false? (eacl/can? client (eacl/spice-object :user "bob") :view (eacl/spice-object :document "document"))))
    (is (= "ready" (:status (binding [*out* (java.io.StringWriter.)]
                              (migration/migrate-connection! conn adapter)))))))

(deftest native-datahike-migration-runner
  (let [config (assoc dh-schema/default-config :store {:backend :memory :id (random-uuid)} :attribute-refs? true)
        _ (dh/create-database config)
        conn (dh/connect config)]
    (try
      (dh/transact conn (legacy/source-schema dh-schema/datahike-schema))
      (exercise! conn {:db dh/db :rows #(dh/datoms % {:index :eavt})
                       :ident #(-> (dh/entity %1 %2) :db/ident)
                       :transact dh/transact :entid #(-> (dh/entity %1 %2) :db/id)
                       :write-schema dh-schema/write-schema!
                       :permission-migrate dh-permissions/migrate!
                       :relationship-migrate dh-relationships/migrate!
                       :make-client dh-eacl/make-client})
      (finally (dh/release conn) (dh/delete-database config)))))

(deftest native-datomic-migration-runner
  (let [uri (str "datomic:mem://demo-migration-" (random-uuid))
        _ (dt/create-database uri)
        conn (dt/connect uri)]
    (try
      @(dt/transact conn dt-schema/v7-schema)
      (exercise! conn {:db dt/db :rows #(dt/datoms % :eavt) :ident dt/ident
                       :transact #(deref (dt/transact %1 %2)) :entid dt/entid
                       :write-schema dt-schema/write-schema!
                       :permission-migrate dt-permissions/migrate!
                       :relationship-migrate dt-relationships/migrate!
                       :make-client dt-eacl/make-client})
      (finally (dt/release conn) (dt/delete-database uri)))))

(deftest independent-application-digest
  (let [ident {1 :demo/name 2 :eacl/id 3 :db/txInstant}
        rows [{:e 1 :a 1 :v "before"} {:e 1 :a 2 :v "identity"}]]
    (is (not= (migration/application-signature rows ident)
              (migration/application-signature (assoc-in rows [0 :v] "after") ident)))
    (is (= (migration/application-signature rows ident)
           (migration/application-signature (conj rows {:e 2 :a 3 :v (java.util.Date.)}) ident)))))

(deftest local-file-copy-migration-and-compaction
  (let [directory (java.nio.file.Files/createTempDirectory "demo-storage-v8-" (make-array java.nio.file.attribute.FileAttribute 0))
        store-id (random-uuid)
        config (assoc dh-schema/default-config :store {:backend :file :path (str directory "/db") :id store-id}
                      :attribute-refs? true :keep-history? false
                      :fuse-index-roots? true :commit-graph? false
                      :index-config {:diff-buf-size 256})
        _ (dh/create-database config)
        conn (dh/connect config)]
    (try
      (dh/transact conn (legacy/source-schema dh-schema/datahike-schema))
      (seed! conn {:db dh/db :transact dh/transact :entid #(-> (dh/entity %1 %2) :db/id)
                   :write-schema dh-schema/write-schema!})
      (dh/release conn)
      (let [output (with-out-str (migration/datahike! (str directory "/db") (str store-id)))
            reopened (dh/connect config)]
        (try
          (is (re-find #"migration-complete" output))
          (is (= "Retain this title" (:demo/title (dh/entity (dh/db reopened) [:eacl/id "document"]))))
          (is (some? (dh-eacl/make-client reopened {:source-lifecycle (random-uuid) :read-only? true})))
          (finally (dh/release reopened))))
      (finally (dh/release conn) (dh/delete-database config)))))


(deftest historical-reader-rejects-pre-migration-database
  (let [uri (str "datomic:mem://demo-migration-history-" (random-uuid))
        _ (dt/create-database uri)
        conn (dt/connect uri)
        key (str (random-uuid))
        adapter {:db dt/db :transact #(deref (dt/transact %1 %2))
                 :entid dt/entid :write-schema dt-schema/write-schema!}]
    (try
      @(dt/transact conn dt-schema/v7-schema)
      (seed! conn adapter)
      (let [old-revision (dt/basis-t (dt/db conn))]
        (dt-permissions/migrate! conn)
        (dt-relationships/migrate! conn {:quiesced? true})
        (let [client (dt-eacl/make-client conn {:source-lifecycle (random-uuid) :security-key key})
              snapshot (eacl/snapshot client)
              options (#'reader/token-format-options key)
              scope (#'reader/decode-token options (eacl/basis-token snapshot))
              old-token (#'reader/issue-exact-token options scope old-revision)
              full-admissions (atom 0)
              assert-compatible! dt-storage/assert-compatible!]
          (try
            (with-redefs [dt-storage/assert-compatible!
                          (fn [database]
                            (swap! full-admissions inc)
                            (assert-compatible! database))]
              (is (= "unsupported-consistency"
                     (try (#'reader/select-supported-historical-snapshot client old-token)
                          :unexpected-success
                          (catch clojure.lang.ExceptionInfo error (:code (ex-data error))))))
              (is (zero? @full-admissions)))
            (let [historical (#'reader/select-supported-historical-snapshot client (eacl/basis-token snapshot))]
              (try
                (is (true? (eacl/can? historical (eacl/spice-object :user "alice") :view
                                      (eacl/spice-object :document "document"))))
                (finally (eacl/release! historical))))
            (finally (eacl/release! snapshot)))))
      (finally (dt/release conn) (dt/delete-database uri)))))

(deftest historical-dates-resolve-real-transactions-without-changing-the-native-view
  (let [uri (str "datomic:mem://demo-history-gaps-" (random-uuid))
        _ (dt/create-database uri)
        conn (dt/connect uri)
        instant #(java.time.Instant/parse %)
        date #(java.util.Date/from (instant %))
        transact-at (fn [at operations]
                      (:db-after @(dt/transact conn
                                               (into [{:db/id "datomic.tx" :db/txInstant (date at)}]
                                                     operations))))
        facts (fn [database]
                (mapv (fn [datom] [(:e datom) (:a datom) (:v datom) (:tx datom)])
                      (dt/datoms database :eavt)))]
    (try
      (let [first-db (transact-at "2026-09-01T00:00:00Z"
                                  [{:db/ident :history-test/name :db/valueType :db.type/string
                                    :db/cardinality :db.cardinality/one}])
            second-db (transact-at "2026-09-03T00:00:00Z"
                                   (for [i (range 50)]
                                     {:db/id (dt/tempid :db.part/user) :history-test/name (str i)}))
            _ (transact-at "2026-09-05T00:00:00Z" [])
            fixed-db (transact-at "2026-09-05T00:00:00Z" [])
            gap-db (dt/as-of fixed-db (date "2026-09-04T00:00:00Z"))]
        ;; Allocated entity IDs leave a logical cutoff that is not a transaction.
        (is (nil? (:db/txInstant (dt/entity fixed-db (dt/t->tx (.asOfT ^datomic.Database gap-db))))))
        (doseq [[at expected] [["2026-09-01T00:00:00Z" (dt/basis-t first-db)]
                              ["2026-09-02T00:00:00Z" (dt/basis-t first-db)]
                              ["2026-09-03T00:00:00Z" (dt/basis-t second-db)]
                              ["2026-09-04T00:00:00Z" (dt/basis-t second-db)]
                              ["2026-09-05T00:00:00Z" nil]
                              ["2026-09-06T00:00:00Z" (dt/basis-t fixed-db)]]]
          (let [{:keys [revision captured-at]} (#'reader/resolve-as-of fixed-db (instant at))]
            (when expected (is (= expected revision) at))
            (is (<= revision (dt/basis-t fixed-db)) at)
            (is (= captured-at (.toInstant ^java.util.Date
                                          (:db/txInstant (dt/entity fixed-db (dt/t->tx revision))))))
            (is (= (facts (dt/as-of fixed-db (date at)))
                   (facts (dt/as-of fixed-db revision))) at))))
      (finally (dt/release conn) (dt/delete-database uri)))))
