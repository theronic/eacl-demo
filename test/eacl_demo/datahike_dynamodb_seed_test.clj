(ns eacl-demo.datahike-dynamodb-seed-test
  (:require [clojure.data.json :as json]
            [clojure.edn :as edn]
            [clojure.test :refer [deftest is testing]]
            [datahike.api :as d]
            [eacl.datahike.schema :as eacl-schema]
            [eacl-demo.datahike-dynamodb.seed :as seed])
  (:import [java.nio.charset StandardCharsets]
           [java.security MessageDigest]
           [java.util UUID]))

(defn- canonical-value
  [value]
  (cond
    (map? value)
    (into (sorted-map)
          (map (fn [[key nested]] [(name key) (canonical-value nested)]))
          value)

    (vector? value) (mapv canonical-value value)
    (sequential? value) (mapv canonical-value value)
    :else value))

(defn- canonical-line
  [record]
  (str (json/write-str (canonical-value record) :escape-unicode false) "\n"))

(defn- sha256
  [value]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (str "sha256:"
         (apply str
                (map #(format "%02x" (bit-and 255 %))
                     (.digest digest
                              (.getBytes ^String value
                                         StandardCharsets/UTF_8)))))))

(defn- batch
  [first-ordinal records]
  (let [resource-count
        (count (filter #(and (= "object" (:kind %))
                             (= "resource" (:role %)))
                       records))
        last-ordinal (+ first-ordinal resource-count -1)
        lines (mapv canonical-line records)]
    {:firstResourceOrdinal first-ordinal
     :lastResourceOrdinal last-ordinal
     :resourceCount resource-count
     :records (vec records)
     :canonicalBytes
     (reduce + (map #(alength (.getBytes ^String % StandardCharsets/UTF_8))
                    lines))
     :digest (sha256 (apply str lines))
     :idempotencyKey
     (str "eacl-demo-fixture-v1:" first-ordinal "-" last-ordinal)}))

(defn- records
  [ordinal]
  (let [subject-id (str "user-" ordinal)
        resource-id (str "server-" ordinal)]
    [{:kind "object" :role "subject"
      :object {:type "user" :id subject-id}}
     {:kind "object" :role "resource"
      :object {:type "server" :id resource-id}}
     {:kind "relationship"
      :subject {:type "user" :id subject-id}
      :relation "shared_admin"
      :resource {:type "server" :id resource-id}}]))

(defn- with-seed
  [run!]
  (let [config {:store {:backend :memory :id (UUID/randomUUID)}
                :schema-flexibility :write
                :attribute-refs? true
                :keep-history? false
                :max-string-length 0
                :initial-tx
                (eacl-schema/merge-schema
                 (edn/read-string
                  (slurp "infra/data/datahike-demo-metadata-schema.edn")))}]
    (d/create-database config)
    (let [connection (d/connect config)]
      (try
        (run!
         (seed/initialize-seed!
          connection
          {:seed-id "eacl-demo-fixture-v1"
           :manifest-digest
           "sha256:718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0"
           :schema-source (slurp "fixtures/schema.v1.zed")}))
        (finally
          (d/release connection)
          (d/delete-database config))))))

(deftest seed-resume-retains-native-source-lifecycle
  (with-seed
    (fn [{:keys [connection seed-id manifest-digest source-lifecycle]}]
      (let [options {:seed-id seed-id :manifest-digest manifest-digest
                     :schema-source (slurp "fixtures/schema.v1.zed")}
            persisted (:eacl.demo/source-lifecycle
                       (d/entity (d/db connection) [:eacl.demo/seed-id seed-id]))
            resumed (seed/initialize-seed! connection options)]
        (is (uuid? source-lifecycle))
        (is (= source-lifecycle persisted (:source-lifecycle resumed)))
        (d/transact connection
                    [[:db/retract [:eacl.demo/seed-id seed-id]
                      :eacl.demo/source-lifecycle persisted]])
        (is (thrown-with-msg?
             clojure.lang.ExceptionInfo #"seed validation failed"
             (seed/initialize-seed! connection options)))
        (d/transact connection
                    [[:db/add [:eacl.demo/seed-id seed-id]
                      :eacl.demo/source-lifecycle persisted]])
        (is (thrown-with-msg?
             clojure.lang.ExceptionInfo #"seed validation failed"
             (seed/initialize-seed!
              connection (assoc options :manifest-digest
                                (str "sha256:" (apply str (repeat 64 "0")))))))))))

(deftest file-store-reopen-preserves-lifecycle-and-resume
  (let [store-id (UUID/randomUUID)
        config {:store {:backend :file :id store-id
                        :path (str (System/getProperty "java.io.tmpdir") "/eacl-seed-" store-id)}
                :schema-flexibility :write :attribute-refs? true :keep-history? false
                :max-string-length 0
                :initial-tx (eacl-schema/merge-schema
                             (edn/read-string
                              (slurp "infra/data/datahike-demo-metadata-schema.edn")))}
        options {:seed-id "reopen-fixture"
                 :manifest-digest (str "sha256:" (apply str (repeat 64 "1")))
                 :schema-source (slurp "fixtures/schema.v1.zed")}
        input (batch 0 (records 0))]
    (d/create-database config)
    (try
      (let [connection (d/connect config)
            lifecycle (try
                        (let [state (seed/initialize-seed! connection options)]
                          (seed/apply-batch! state input)
                          (:source-lifecycle state))
                        (finally (d/release connection)))
            reopened (d/connect config)]
        (try
          (let [state (seed/initialize-seed! reopened options)]
            (is (= lifecycle (:source-lifecycle state)))
            (is (true? (get-in (d/db reopened) [:config :attribute-refs?])))
            (is (every? #(integer? (:a %)) (:eavt (d/db reopened))))
            (is (= :already-committed (:status (seed/apply-batch! state input)))))
          (finally (d/release reopened))))
      (finally (d/delete-database config)))))

(deftest batch-replay-and-finalization-are-idempotent
  (with-seed
    (fn [state]
      (let [input (batch 0 (records 0))
            first-result (seed/apply-batch! state input)
            replay-result (seed/apply-batch! state input)
            expected {:objects 2 :subjects 1 :resources 1
                      :relationships 1 :records 3}
            final-result
            (seed/finalize-seed!
             state {:cutPointResources 1 :counts expected})
            final-replay
            (seed/finalize-seed!
             state {:cutPointResources 1 :counts expected})
            first-compaction (with-redefs [d/gc-storage (fn [& _] #{})]
                               (seed/compact-store! state))
            replayed-compaction (seed/compact-store! state)]
        (is (= :committed (:status first-result)))
        (is (= 1 (:next-resource-ordinal first-result)))
        (is (= :already-committed (:status replay-result)))
        (is (= expected (:counts final-result)))
        (is (= [false true]
               [(:replayed final-result) (:replayed final-replay)]))
        (is (= :compacted (:status first-compaction)))
        (is (= :already-compacted (:status replayed-compaction)))))))

(deftest contiguous-batch-groups-commit-one-checkpoint
  (with-seed
    (fn [state]
      (let [inputs [(batch 0 (records 0))
                    (batch 1 (records 1))]
            result (seed/apply-batch-group! state inputs)]
        (is (= {:status :committed :next-resource-ordinal 2}
               (select-keys result [:status :next-resource-ordinal])))
        (is (= {:objects 4 :subjects 2 :resources 2
                :relationships 2 :records 6}
               (:counts
                (seed/finalize-seed!
                 state
                 {:cutPointResources 2
                  :counts {:objects 4 :subjects 2 :resources 2
                           :relationships 2 :records 6}}))))))))

(deftest invalid-or-noncontiguous-input-fails-before-writing
  (with-seed
    (fn [state]
      (testing "a digest mismatch is rejected"
        (is (thrown-with-msg?
             clojure.lang.ExceptionInfo
             #"seed validation failed"
             (seed/apply-batch!
              state (assoc (batch 0 (records 0)) :digest "sha256:bad")))))
      (testing "a group gap is rejected"
        (is (thrown-with-msg?
             clojure.lang.ExceptionInfo
             #"seed validation failed"
             (seed/apply-batch-group!
              state [(batch 0 (records 0)) (batch 2 (records 2))])))))))
