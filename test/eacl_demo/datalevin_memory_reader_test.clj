(ns eacl-demo.datalevin-memory-reader-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is testing use-fixtures]]
            [datalevin.core :as d]
            [eacl-demo.fixture :as fixture]
            [eacl-demo.datalevin-memory.operations :as operations]
            [eacl-demo.datalevin-memory.profile :as profile]
            [eacl-demo.datalevin-memory.reader :as reader]
            [eacl.core :as eacl])
  (:import [java.nio.file Files]
           [java.util UUID]))

(def security-key (apply str (repeat 32 "k")))

(def ^:private generated-fixture-records
  (delay (vec (mapcat :records (fixture/small-fixture-bundles)))))

(defn- read-generated-fixture-batches!
  [kind consume!]
  (let [records (filterv #(= (keyword kind) (:kind %))
                         @generated-fixture-records)]
    (doseq [batch (partition-all 5000 records)]
      (consume! batch))
    (count records)))

(use-fixtures
  :each
  (fn [run]
    (with-redefs-fn
      {#'eacl-demo.datalevin-memory.reader/read-fixture-batches!
       read-generated-fixture-batches!}
      run)))

(defn- delete-tree!
  [directory]
  (doseq [file (reverse (file-seq (.toFile directory)))]
    (io/delete-file file true)))

(defn- invoke
  [handlers snapshot basis input]
  ((get handlers "lookup-resources")
   {:snapshot snapshot
    :basis basis
    :input input
    :check-active! (fn [])}))

(deftest immutable-fixture-has-stable-source-identity-and-pages-test
  (let [directory (Files/createTempDirectory
                   "eacl-demo-datalevin-reader-"
                   (make-array java.nio.file.attribute.FileAttribute 0))
        opened (reader/open-reader! {:security-key security-key
                                     :database-directory directory})]
    (try
      (let [stored-source-id
            (:eacl.datalevin/source-id
             (d/entity (d/db (:connection opened))
                       [:eacl/id "datalevin-metadata"]))
            captured ((:capture-snapshot opened))
            snapshot (:value captured)
            basis (:basis captured)
            handlers (operations/create-handlers
                      {:descriptor {:identity {}}
                       :cursor-key security-key})
            query {:subjectType "user"
                   :subjectId "account-0-owner"
                   :resourceType "server"
                   :permission "view"
                   :pageSize 20
                   :cache true
                   :populateCache true
                   :consistency "minimize"}]
        (try
          (testing "the persisted and public source identity is manifest-derived"
            (is (= (UUID/fromString
                    "1f2c9a2b-40b8-3cb7-bdca-cc7342dac481")
                   reader/fixture-source-id))
            (is (= reader/fixture-source-id stored-source-id))
            (is (= (str reader/fixture-source-id)
                   (:source-id (eacl/basis snapshot)))))
          (testing "the reported revision and EACL cursor both continue page one"
            (is (= "datalevin:17" (:id basis)))
            (let [page-1 (invoke handlers snapshot basis query)
                  page-2 (invoke handlers snapshot basis
                                 (assoc query :cursor
                                        (get-in page-1
                                                [:pageInfo :endCursor])))]
              (is (= (mapv #(str "account-0-server-" %) (range 16))
                     (subvec (mapv :id (:items page-1)) 0 16)))
              (is (= ["account-1-server-4" "account-1-server-5"
                      "account-1-server-6" "account-1-server-7"]
                     (subvec (mapv :id (:items page-2)) 0 4)))))
          (finally
            ((:release! captured)))))
      (finally
        (reader/close-reader! opened)
        (delete-tree! directory)))))

(deftest embedded-fixture-reopens-without-reseeding-test
  (let [directory (Files/createTempDirectory
                   "eacl-demo-datalevin-reopen-"
                   (make-array java.nio.file.attribute.FileAttribute 0))]
    (try
      (let [first-reader (reader/open-reader! {:security-key security-key
                                               :database-directory directory})
            first-basis (try
                          (let [owned ((:capture-snapshot first-reader))]
                            (try (:basis owned)
                                 (finally ((:release! owned)))))
                          (finally (reader/close-reader! first-reader)))
            second-reader (reader/open-reader! {:security-key security-key
                                                :database-directory directory})]
        (try
          (let [owned ((:capture-snapshot second-reader))]
            (try
              (is (= (:id first-basis) (get-in owned [:basis :id])))
              (is (= profile/data-manifest-sha256
                     (:demo/data-manifest-sha256
                      (d/entity (d/db (:connection second-reader))
                                [:eacl/id "datalevin-metadata"]))))
              (finally ((:release! owned)))))
          (finally (reader/close-reader! second-reader))))
      (finally (delete-tree! directory)))))

(deftest eacl-cursor-errors-are-public-client-errors-test
  (let [guarded (#'operations/guarded
                 (fn [_]
                   (throw
                    (ex-info
                     "execution identity mismatch"
                     {:type :eacl.pagination/invalid-cursor
                      :reason :source-scope}))))]
    (is (= "cursor-invalid"
           (:code
            (ex-data
             (try
               (guarded {})
               (catch clojure.lang.ExceptionInfo error error))))))))
