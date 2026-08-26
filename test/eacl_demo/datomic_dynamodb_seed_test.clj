(ns eacl-demo.datomic-dynamodb-seed-test
  (:require [clojure.edn :as edn]
            [clojure.test :refer [deftest is]]
            [datomic.api :as d]
            [eacl-demo.datomic-dynamodb.seed :as seed]
            [eacl-demo.datomic-dynamodb.seed-main :as seed-main])
  (:import [java.time Instant]
           [java.util.concurrent CompletableFuture]))

(def manifest-digest
  "sha256:718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0")

(def first-batch
  {:firstResourceOrdinal 0
   :lastResourceOrdinal 0
   :resourceCount 1
   :records
   [{:kind "object" :object {:type "platform" :id "platform"}
     :role "resource"}
    {:kind "object" :object {:type "user" :id "super-user"}
     :role "subject"}
    {:kind "object" :object {:type "user" :id "user-1"}
     :role "subject"}
    {:kind "object" :object {:type "user" :id "user-2"}
     :role "subject"}
    {:kind "relationship" :relation "super_admin"
     :resource {:type "platform" :id "platform"}
     :subject {:type "user" :id "super-user"}}]
   :canonicalBytes 447
   :digest "sha256:8b48efce8e0ecf0bd7a2454226228869c63ce66e62bf314becc24135f7dd1eff"
   :idempotencyKey "eacl-demo-fixture-v1:0-0"})

(def second-batch
  {:firstResourceOrdinal 1
   :lastResourceOrdinal 1
   :resourceCount 1
   :records
   [{:kind "object" :object {:type "document" :id "resource-2"}
     :role "resource"}]
   :canonicalBytes 83
   :digest "sha256:1fb786596aa2b63fab893a19753600aeca794b6a54f89b0bf3caf49e8b987ce0"
   :idempotencyKey "eacl-demo-fixture-v1:1-1"})

(defn seed-options
  []
  {:seed-id "eacl-demo-fixture-v1"
   :manifest-digest manifest-digest
   :schema-source (slurp "fixtures/schema.v1.zed")
   :metadata-schema
   (edn/read-string (slurp "infra/data/datomic-demo-metadata-schema.edn"))})

(deftest seed-command-environment-is-closed-test
  (let [environment
        {"AWS_REGION" "us-east-1"
         "EACL_DATOMIC_TABLE" "eacl-demo-datomic-fixture-v1-green"
         "EACL_DATOMIC_DATABASE" "eacl-demo"
         "EACL_FIXTURE_MANIFEST_DIGEST" manifest-digest
         "EACL_FIXTURE_CUT_POINT" "1000000"}]
    (is (= {:region "us-east-1"
            :table "eacl-demo-datomic-fixture-v1-green"
            :database "eacl-demo"
            :manifest-digest manifest-digest
            :cut-point 1000000}
           (seed-main/parse-environment environment)))
    (doseq [invalid [(assoc environment "EACL_DATOMIC_TABLE" "other")
                     (assoc environment "EACL_FIXTURE_CUT_POINT" "999999")
                     (assoc environment "EACL_FIXTURE_MANIFEST_DIGEST" "bad")]]
      (is (thrown? clojure.lang.ExceptionInfo
                   (seed-main/parse-environment invalid))))))

(deftest seed-resources-load-through-classpath-test
  (is (re-find #"sha256:[0-9a-f]{64}"
               (seed-main/resource-text
                (seed-main/manifest-resource-path 1000000))))
  (is (pos? (count (seed-main/resource-text
                    "schema.v1.zed"))))
  (is (re-find #":eacl.demo/seed-id"
               (seed-main/resource-text
                "datomic-demo-metadata-schema.edn")))
  (is (thrown-with-msg?
       clojure.lang.ExceptionInfo
       #"Required seed resource is absent"
       (seed-main/resource-text "absent"))))

(deftest resumable-seed-records-bases-verifies-counts-and-preserves-history-test
  (let [uri (str "datomic:mem://eacl-demo-seed-" (random-uuid))]
    (d/create-database uri)
    (let [connection (d/connect uri)]
      (try
        (let [state (seed/initialize-seed! connection (seed-options))
              committed (seed/apply-batch! state first-batch)
              replayed (seed/apply-batch! state first-batch)
              second-committed (seed/apply-batch! state second-batch)]
          (is (= :committed (:status committed)))
          (is (= 1 (:next-resource-ordinal committed)))
          (is (< (:content-basis-t committed)
                 (:checkpoint-basis-t committed)))
          (is (= :already-committed (:status replayed)))
          (is (= (:content-basis-t committed)
                 (:content-basis-t replayed)))
          (is (= :committed (:status second-committed)))
          (is (= 2 (:next-resource-ordinal second-committed)))

          (let [ready
                (seed/finalize-seed!
                 state
                 {:cutPointResources 2
                  :counts {:objects 5 :subjects 3 :resources 2
                           :relationships 1 :records 6}
                  :indexTimeoutSeconds 1}
                 {:request-index (constantly true)
                  :sync-index (fn [_ _]
                                (CompletableFuture/completedFuture :indexed))
                  :clock (constantly (Instant/parse "2026-08-25T12:00:00Z"))})
                database (d/db connection)
                history (d/history database)
                status-values
                (set (d/q '[:find [?status ...]
                            :where
                            [?seed :eacl.demo/seed-id "eacl-demo-fixture-v1"]
                            [?seed :eacl.demo/seed-status ?status]]
                          history))]
            (is (= :ready (:status ready)))
            (is (false? (:replayed ready)))
            (is (= manifest-digest (:manifest-digest ready)))
            (is (< (:content-basis-t ready)
                   (:publication-basis-t ready)))
            (is (= #{:seeding :ready} status-values))
            (let [evidence
                  (seed/history-evidence
                   state {:cutPointResources 2} ready)]
              (is (true? (:historyVerified evidence)))
              (is (true? (:normalPeer evidence)))
              (is (= 1 (:priorResourceCount evidence)))
              (is (= 2 (:finalResourceCount evidence)))
              (is (< (:priorBasisT evidence)
                     (:contentBasisT evidence)
                     (:publicationBasisT evidence))))
            (let [ready-replay
                  (seed/finalize-seed!
                   state
                   {:cutPointResources 2
                    :counts {:objects 5 :subjects 3 :resources 2
                             :relationships 1 :records 6}
                    :indexTimeoutSeconds 1}
                   {:request-index #(throw (AssertionError. "replay re-indexed"))
                    :sync-index #(throw (AssertionError. "replay synchronized"))
                    :clock #(throw (AssertionError. "replay rewrote time"))})]
              (is (true? (:replayed ready-replay)))
              (is (= (:content-basis-t ready)
                     (:content-basis-t ready-replay)))
              (is (= (:publication-basis-t ready)
                     (:publication-basis-t ready-replay)))
              (is (true? (:historyVerified
                          (seed/history-evidence
                           state {:cutPointResources 2} ready-replay)))))
            (is (= "platform"
                   (:eacl/id
                    (d/entity (d/as-of database (:content-basis-t committed))
                              [:eacl/id "platform"]))))
            (doseq [attribute [:eacl.demo/type :eacl.demo/roles
                               :eacl.demo/seed-status
                               :eacl.demo/next-resource-ordinal]]
              (is (false? (:db/noHistory (d/entity database attribute))))))

          (is (= :seed-not-writable
                 (:type
                  (ex-data
                   (try
                     (seed/apply-batch!
                      state (assoc first-batch
                                   :firstResourceOrdinal 2
                                   :lastResourceOrdinal 2
                                   :idempotencyKey "eacl-demo-fixture-v1:2-2"))
                     (catch clojure.lang.ExceptionInfo error error)))))))
        (finally
          (d/release connection)
          (d/delete-database uri))))))

(deftest malformed-and-cross-manifest-batches-fail-closed-test
  (let [uri (str "datomic:mem://eacl-demo-seed-invalid-" (random-uuid))]
    (d/create-database uri)
    (let [connection (d/connect uri)]
      (try
        (let [state (seed/initialize-seed! connection (seed-options))]
          (is (= :invalid-batch
                 (:type
                  (ex-data
                   (try
                     (seed/apply-batch!
                      state (assoc first-batch :digest
                                   (str "sha256:" (apply str (repeat 64 "0")))))
                     (catch clojure.lang.ExceptionInfo error error))))))
          (is (= :seed-identity-mismatch
                 (:type
                  (ex-data
                   (try
                     (seed/initialize-seed!
                      connection
                      (assoc (seed-options) :manifest-digest
                             (str "sha256:" (apply str (repeat 64 "f")))))
                     (catch clojure.lang.ExceptionInfo error error)))))))
        (finally
          (d/release connection)
          (d/delete-database uri))))))
