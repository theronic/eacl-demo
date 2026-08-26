(ns eacl-demo.datomic-dynamodb-operations-test
  (:require [clojure.edn :as edn]
            [clojure.test :refer [deftest is]]
            [datomic.api :as d]
            [eacl.core :as eacl]
            [eacl.datomic.core :as datomic-eacl]
            [eacl.datomic.schema :as datomic-schema]
            [eacl-demo.datomic-dynamodb.operations :as operations]))

(def cursor-key (apply str (repeat 32 "k")))
(def public-basis
  {:behavior "fixed-environment"
   :id "datomic:test:test:42"
   :capturedAt "2026-08-25T12:00:00Z"
   :fixedForEnvironment true})
(def descriptor
  {:identity {:profileId "datomic-dynamodb"
              :demoSha (apply str (repeat 40 "a"))
              :eaclSha (apply str (repeat 40 "b"))
              :artifactSha256 (apply str (repeat 64 "c"))
              :deploymentId "test"
              :dataManifestSha256 (apply str (repeat 64 "d"))}})

(defn invoke
  [handlers operation snapshot input]
  ((get handlers operation)
   {:snapshot snapshot
    :basis public-basis
    :input input
    :check-active! (fn [])}))

(deftest fixed-snapshot-operations-are-bounded-normalized-and-cursor-authenticated-test
  (let [uri (str "datomic:mem://eacl-demo-operations-" (random-uuid))]
    (d/create-database uri)
    (let [connection (d/connect uri)]
      (try
        @(d/transact connection
                     (into datomic-schema/v7-schema
                           (edn/read-string
                            (slurp "infra/data/datomic-demo-metadata-schema.edn"))))
        (let [client (datomic-eacl/make-client connection
                                               {:security-key cursor-key})]
          (eacl/write-schema! client (slurp "fixtures/schema.v1.zed"))
          @(d/transact connection
                       [{:eacl/id "user-1" :eacl.demo/type :user
                         :eacl.demo/roles #{:subject}}
                        {:eacl/id "user-2" :eacl.demo/type :user
                         :eacl.demo/roles #{:subject}}
                        {:eacl/id "account-0" :eacl.demo/type :account
                         :eacl.demo/roles #{:subject :resource}}])
          (eacl/create-relationship!
           client (eacl/spice-object :user "user-1") :owner
           (eacl/spice-object :account "account-0"))
          (let [snapshot (datomic-eacl/snapshot client (d/db connection))
                handlers (operations/create-handlers
                          {:descriptor descriptor
                           :cursor-key cursor-key
                           :clock (constantly 1787660000000)})]
            (try
              (let [first-page (invoke handlers "list-subjects" snapshot
                                       {:type "user" :pageSize 1})
                    cursor (get-in first-page [:pageInfo :endCursor])
                    second-page (invoke handlers "list-subjects" snapshot
                                        {:type "user" :pageSize 1
                                         :cursor cursor})]
                (is (= ["user-1"] (mapv :id (:items first-page))))
                (is (true? (get-in first-page [:pageInfo :hasNextPage])))
                (is (= ["user-2"] (mapv :id (:items second-page))))
                (is (false? (get-in second-page [:pageInfo :hasNextPage])))
                (is (= "cursor-scope-mismatch"
                       (:code (ex-data
                               (try
                                 (invoke handlers "list-subjects" snapshot
                                         {:type "account" :pageSize 1
                                          :cursor cursor})
                                 (catch clojure.lang.ExceptionInfo error
                                   error))))))
                (let [last-index (dec (count cursor))
                      changed (str (subs cursor 0 last-index)
                                   (if (= "A" (subs cursor last-index)) "B" "A"))]
                  (is (= "cursor-invalid"
                         (:code (ex-data
                                 (try
                                   (invoke handlers "list-subjects" snapshot
                                           {:type "user" :pageSize 1
                                            :cursor changed})
                                   (catch clojure.lang.ExceptionInfo error
                                     error))))))))

              (is (= "account-0"
                     (get-in (invoke handlers "get-object" snapshot
                                     {:type "account" :id "account-0"})
                             [:object :id])))
              (is (= "user-1"
                     (get-in (invoke handlers "list-relationships" snapshot
                                     {:resourceType "account"
                                      :resourceId "account-0"
                                      :relation "owner"})
                             [:items 0 :subjectId])))
              (is (= "account-0"
                     (get-in (invoke handlers "reverse-relationships" snapshot
                                     {:subjectType "user"
                                      :subjectId "user-1"
                                      :relation "owner"})
                             [:items 0 :id])))
              (is (true? (:allowed
                          (invoke handlers "authorize" snapshot
                                  {:subjectType "user" :subjectId "user-1"
                                   :resourceType "account"
                                   :resourceId "account-0"
                                   :permission "admin"}))))
              (is (= "subject-not-found"
                     (:reasonCode
                      (invoke handlers "authorize" snapshot
                              {:subjectType "user" :subjectId "unknown"
                               :resourceType "account"
                               :resourceId "account-0"
                               :permission "admin"}))))
              (is (= 6 (count (:types (invoke handlers "get-schema" snapshot {})))))
              (is (= {:kind "subjects" :value 3 :exact true :ceiling 10}
                     (invoke handlers "count-objects" snapshot
                             {:kind "subjects" :ceiling 10})))
              (is (= {:kind "objects" :value 1 :exact false :ceiling 1}
                     (invoke handlers "count-objects" snapshot
                             {:kind "objects" :ceiling 1})))
              (finally
                (eacl/release! snapshot)))))
        (finally
          (d/release connection)
          (d/delete-database uri))))))
