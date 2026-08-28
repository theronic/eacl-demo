(ns eacl-demo.datahike-dynamodb-operations-test
  (:require [clojure.edn :as edn]
            [clojure.test :refer [deftest is]]
            [datahike.api :as d]
            [eacl.core :as eacl]
            [eacl.datahike.core :as datahike-eacl]
            [eacl.spicedb.consistency :as consistency]
            [eacl-demo.datahike-dynamodb.operations :as operations]))

(def cursor-key (apply str (repeat 32 "k")))
(def public-basis
  {:behavior "request-snapshot"
   :id "datahike:test:test:42"
   :capturedAt "2026-08-26T00:00:00Z"
   :fixedForEnvironment false})
(def descriptor
  {:identity {:profileId "datahike-dynamodb"
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
    :input (assoc input
                  :eacl-demo/snapshot snapshot
                  :eacl-demo/public-basis public-basis)
    :check-active! (fn [])}))

(deftest minimize-latency-does-not-mint-a-basis-token-test
  (let [calls (atom 0)
        snapshot ::snapshot]
    (with-redefs [eacl/basis-token
                  (fn [actual]
                    (is (= snapshot actual))
                    (swap! calls inc)
                    "basis-token")]
      (is (= consistency/minimize-latency
             (#'operations/eacl-consistency
              {:eacl-demo/snapshot snapshot :consistency "minimize"})))
      (is (zero? @calls))
      (is (= (consistency/at-exact-snapshot "basis-token")
             (#'operations/eacl-consistency
              {:eacl-demo/snapshot snapshot :consistency "exact"})))
      (is (= 1 @calls)))))

(deftest same-basis-identity-satisfies-cross-environment-freshness-floor-test
  (let [input {:eacl-demo/snapshot ::snapshot
               :eacl-demo/public-basis public-basis
               :consistency "at-least"
               :atLeastAsFreshAs "2026-08-26T00:00:01Z"}]
    (with-redefs [eacl/basis-token (constantly "basis-token")]
      (is (= (consistency/at-least-as-fresh "basis-token")
             (#'operations/eacl-consistency
              (assoc input
                     :atLeastAsFreshBasisId (:id public-basis)
                     :atLeastAsFreshBasisCapturedAt
                     "2026-08-26T00:00:01Z"))))
      (is (= "freshness-unavailable"
             (:code
              (ex-data
               (try
                 (#'operations/eacl-consistency
                  (assoc input
                         :atLeastAsFreshBasisId (:id public-basis)
                         :atLeastAsFreshBasisCapturedAt
                         (:capturedAt public-basis)))
                 (catch clojure.lang.ExceptionInfo error error))))))
      (is (= "freshness-unavailable"
             (:code
              (ex-data
               (try
                 (#'operations/eacl-consistency
                  (assoc input :atLeastAsFreshBasisId "datahike:test:test:41"))
                 (catch clojure.lang.ExceptionInfo error error)))))))))

(deftest fixed-server-count-does-not-scan-the-database-test
  (let [handlers (operations/create-handlers
                  {:descriptor (assoc descriptor :dataset {:serverCount 998417})
                   :cursor-key cursor-key})]
    (is (= {:kind "objects" :value 10 :exact false :ceiling 10}
           (invoke handlers "count-objects" ::unusable-snapshot
                   {:kind "objects" :type "server" :ceiling 10})))
    (is (= {:kind "objects" :value 998417 :exact true :ceiling 1000000}
           (invoke handlers "count-objects" ::unusable-snapshot
                   {:kind "objects" :type "server" :ceiling 1000000})))))

(deftest bootstrap-explicitly-advances-the-retained-snapshot-test
  (let [later (assoc public-basis :id "datahike:test:test:43"
                     :capturedAt "2026-08-26T00:00:01Z")
        calls (atom 0)
        handlers (operations/create-handlers
                  {:descriptor descriptor
                   :cursor-key cursor-key
                   :refresh-snapshot! (fn []
                                        (swap! calls inc)
                                        {:value ::later :basis later})})]
    (is (= later (:basis (invoke handlers "bootstrap" ::old {}))))
    (is (= 1 @calls))))

(deftest immutable-datahike-operations-are-bounded-normalized-and-cursor-authenticated-test
  (let [database-id (random-uuid)
        connection
        (datahike-eacl/create-conn
         (edn/read-string
          (slurp "infra/data/datomic-demo-metadata-schema.edn"))
         {:store {:backend :memory :id database-id}
          :attribute-refs? true})
        database-config (:config (d/db connection))]
    (try
      (let [client (datahike-eacl/make-client connection
                                               {:security-key cursor-key})]
        (eacl/write-schema! client (slurp "fixtures/schema.v1.zed"))
        (d/transact connection
                    [{:eacl/id "user-1" :eacl.demo/type :user
                      :eacl.demo/roles #{:subject}}
                     {:eacl/id "user-2" :eacl.demo/type :user
                      :eacl.demo/roles #{:subject}}
                     {:eacl/id "account-0" :eacl.demo/type :account
                      :eacl.demo/roles #{:subject :resource}}])
        (eacl/create-relationship!
         client (eacl/spice-object :user "user-1") :owner
         (eacl/spice-object :account "account-0"))
        (let [snapshot (eacl/snapshot client)
              handlers (operations/create-handlers
                        {:descriptor descriptor
                         :cursor-key cursor-key
                         :clock (constantly 1787702400000)})]
          (try
            (let [later-basis (assoc public-basis :id "datahike:test:test:43")]
              (is (= later-basis
                     (:basis ((get handlers "bootstrap")
                              {:snapshot snapshot
                               :basis later-basis
                               :input {}
                               :check-active! (fn [])}))))
              (is (not= public-basis
                        (:basis ((get handlers "bootstrap")
                                 {:snapshot snapshot
                                  :basis later-basis
                                  :input {}
                                  :check-active! (fn [])})))))
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
              (is (nil? (get-in second-page [:pageInfo :endCursor])))
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
                                 (if (= "A" (subs cursor last-index))
                                   "B" "A"))]
                (is (= "cursor-invalid"
                       (:code (ex-data
                               (try
                                 (invoke handlers "list-subjects" snapshot
                                         {:type "user" :pageSize 1
                                          :cursor changed})
                                 (catch clojure.lang.ExceptionInfo error
                                   error))))))))

            (with-redefs [d/q (fn [& _]
                                (throw (ex-info "list-subjects scanned via Datalog"
                                                {})))]
              (let [first-page (invoke handlers "list-subjects" snapshot
                                       {:pageSize 2})
                    second-page (invoke handlers "list-subjects" snapshot
                                        {:pageSize 2
                                         :cursor (get-in first-page
                                                         [:pageInfo :endCursor])})]
                (is (= ["account-0" "user-1"]
                       (mapv :id (:items first-page))))
                (is (true? (get-in first-page [:pageInfo :hasNextPage])))
                (is (= ["user-2"] (mapv :id (:items second-page))))
                (is (false? (get-in second-page [:pageInfo :hasNextPage])))))

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
                        (invoke handlers "check-permission" snapshot
                                {:subjectType "user" :subjectId "user-1"
                                 :resourceType "account"
                                 :resourceId "account-0"
                                 :permission "admin"}))))
            (is (= {:allowed false}
                   (invoke handlers "check-permission" snapshot
                           {:subjectType "user" :subjectId "unknown"
                            :resourceType "account"
                            :resourceId "account-0"
                            :permission "admin"})))
            (is (= ["account-0"]
                   (mapv :id
                         (:items
                          (invoke handlers "lookup-resources" snapshot
                                  {:subjectType "user" :subjectId "user-1"
                                   :resourceType "account"
                                   :permission "admin" :pageSize 10})))))
            (doseq [consistency ["at-least" "exact"]]
              (is (= ["account-0"]
                     (mapv :id
                           (:items
                            (invoke handlers "lookup-resources" snapshot
                                    (cond-> {:subjectType "user"
                                             :subjectId "user-1"
                                             :resourceType "account"
                                             :permission "admin"
                                             :pageSize 10
                                             :consistency consistency}
                                      (= "at-least" consistency)
                                      (assoc :atLeastAsFreshAs
                                             "2026-08-25T23:59:59Z"))))))))
            (is (= "freshness-unavailable"
                   (:code
                    (ex-data
                     (try
                       (invoke handlers "lookup-resources" snapshot
                               {:subjectType "user" :subjectId "user-1"
                                :resourceType "account" :permission "admin"
                                :pageSize 10 :consistency "at-least"
                                :atLeastAsFreshAs "2026-08-26T00:00:01Z"})
                       (catch clojure.lang.ExceptionInfo error error))))))
            (is (= ["user-1"]
                   (mapv :id
                         (:items
                          (invoke handlers "lookup-subjects" snapshot
                                  {:resourceType "account"
                                   :resourceId "account-0"
                                   :subjectType "user"
                                   :permission "admin" :pageSize 10})))))
            (is (= {:kind "objects" :value 1 :exact true :ceiling 10}
                   (invoke handlers "count-resources" snapshot
                           {:subjectType "user" :subjectId "user-1"
                            :resourceType "account" :permission "admin"
                            :ceiling 10})))
            (is (= 6 (count (:types
                             (invoke handlers "get-schema" snapshot {})))))
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
        (d/delete-database database-config)))))
