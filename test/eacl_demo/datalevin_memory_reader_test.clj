(ns eacl-demo.datalevin-memory-reader-test
  (:require [clojure.test :refer [deftest is testing]]
            [datalevin.core :as d]
            [eacl-demo.datalevin-memory.operations :as operations]
            [eacl-demo.datalevin-memory.reader :as reader]
            [eacl.core :as eacl])
  (:import [java.util UUID]))

(def security-key (apply str (repeat 32 "k")))

(defn- invoke
  [handlers snapshot basis input]
  ((get handlers "lookup-resources")
   {:snapshot snapshot
    :basis basis
    :input input
    :check-active! (fn [])}))

(deftest immutable-fixture-has-stable-source-identity-and-pages-test
  (let [opened (reader/open-reader! {:security-key security-key})]
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
            (is (= "datalevin:16" (:id basis)))
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
        (reader/close-reader! opened)))))

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
