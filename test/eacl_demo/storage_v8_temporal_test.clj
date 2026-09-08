(ns eacl-demo.storage-v8-temporal-test
  (:require [clojure.test :refer [deftest is]]
            [datahike.api :as dh]
            [datomic.api :as dt]
            [eacl.core :as eacl]
            [eacl.datahike.core :as dh-eacl]
            [eacl.datomic.core :as dt-eacl]
            [eacl.datomic.schema :as dt-schema]
            [eacl-demo.datahike-s3.operations :as s3-ops]
            [eacl-demo.datahike-dynamodb.operations :as dh-ops]
            [eacl-demo.datomic-dynamodb.operations :as dt-ops]))

(def cursor-key (apply str (repeat 32 "k")))
(def query {:subjectType "user" :subjectId "user-1"
            :resourceType "account" :resourceId "account-0"
            :permission "admin" :pageSize 1 :consistency "minimize"})

(defn invoke [handlers operation snapshot input]
  (let [basis {:id "fixture-v8" :capturedAt "2026-09-08T00:00:00Z"}]
    ((get handlers operation)
     {:snapshot snapshot :basis basis
      :input (assoc input :eacl-demo/snapshot snapshot :eacl-demo/public-basis basis)
      :check-active! (fn []) :remaining-ms (constantly 30000)})))

(defn exercise! [conn make-client transact profiles mode]
  (let [query (assoc query :consistency mode)
        clock (atom 1000)
        client (make-client conn {:security-key cursor-key :source-lifecycle (random-uuid)
                                  :clock #(deref clock)})]
    (eacl/write-schema! client (slurp "fixtures/schema.v1.zed"))
    (transact conn (mapv (fn [attribute]
                           {:db/ident attribute :db/valueType :db.type/keyword
                            :db/cardinality :db.cardinality/one})
                         [:demo/type :eacl.demo/type]))
    (transact conn [{:db/ident :eacl.demo/roles :db/valueType :db.type/keyword
                     :db/cardinality :db.cardinality/many}])
    (transact conn [{:eacl/id "user-1" :demo/type :user :eacl.demo/type :user :eacl.demo/roles [:subject]}
                    {:eacl/id "account-0" :demo/type :account :eacl.demo/type :account :eacl.demo/roles [:resource]}
                    {:eacl/id "account-1" :demo/type :account :eacl.demo/type :account :eacl.demo/roles [:resource]}])
    (doseq [id ["account-0" "account-1"]]
      (eacl/create-relationship!
       client (assoc (eacl/->Relationship (eacl/spice-object :user "user-1") :owner
                                          (eacl/spice-object :account id))
                     :valid-until-ms 5000)))
    (let [snapshot (eacl/snapshot client)]
      (try
        (doseq [[profile create-handlers] profiles]
          (reset! clock 1000)
          (let [handlers (create-handlers {:descriptor {:identity {:profileId profile}}
                                           :cursor-key cursor-key :authorization-reader client})
                first-page (invoke handlers "lookup-resources" snapshot query)
                cursor (get-in first-page [:pageInfo :endCursor])]
            (is (true? (:allowed (invoke handlers "check-permission" snapshot query))))
            (is (string? cursor))
            (reset! clock 2000)
            (let [next-page (invoke handlers "lookup-resources" snapshot (assoc query :cursor cursor))]
              (is (= 2 (count (set (map :id (concat (:items first-page) (:items next-page))))))))
            (reset! clock 5000)
            ;; The retained inspection snapshot still has the old trusted time.
            (is (true? (eacl/can? snapshot (eacl/spice-object :user "user-1") :admin
                                  (eacl/spice-object :account "account-0"))))
            (is (false? (:allowed (invoke handlers "check-permission" snapshot query))))))
        (finally (eacl/release! snapshot))))))

(deftest datahike-http-authorization-uses-fresh-trusted-time
  (doseq [profile [["datahike-s3" s3-ops/create-handlers]
                   ["datahike-dynamodb" dh-ops/create-handlers]]]
    (let [conn (dh-eacl/create-conn [] {:store {:backend :memory :id (random-uuid)} :attribute-refs? true})
          config (:config (dh/db conn))]
      (try
        (exercise! conn dh-eacl/make-client dh/transact [profile] "minimize")
        (finally (dh/release conn) (dh/delete-database config))))))

(deftest datomic-http-authorization-uses-fresh-trusted-time
  (doseq [mode ["minimize" "historical-date"]]
    (let [uri (str "datomic:mem://demo-temporal-" (random-uuid))
          _ (dt/create-database uri)
          conn (dt/connect uri)]
      (try
        (dt-schema/install! conn)
        (exercise! conn dt-eacl/make-client #(deref (dt/transact %1 %2))
                   [["datomic-dynamodb" dt-ops/create-handlers]] mode)
        (finally (dt/release conn) (dt/delete-database uri))))))
