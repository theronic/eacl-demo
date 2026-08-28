(ns eacl-demo.datahike-s3-reader-test
  (:require [clojure.test :refer [deftest is testing]]
            [datahike.api :as d]
            [eacl.core :as eacl]
            [eacl.datahike.core :as datahike-eacl]
            [eacl-demo.datahike-s3.konserve :as read-only-store]
            [eacl-demo.datahike-s3.profile :as profile]
            [eacl-demo.datahike-s3.read-only-writer :as read-only-writer]
            [eacl-demo.datahike-s3.reader :as reader]))

(def config
  {:bucket "adopted-bucket"
   :region "us-east-1"
   :store-id (java.util.UUID/fromString
              "4e67bb31-557d-4f49-8b4c-699d39577310")
   :store-cache-size 1000
   :search-cache-size 0
   :maximum-concurrency 1
   :security-key (apply str (repeat 32 "k"))})

(deftest exact-existing-store-configuration-test
  (let [database (reader/database-config config)]
    (is (= read-only-store/backend (get-in database [:store :backend])))
    (is (= (:store-id config) (get-in database [:store :id])))
    (is (= read-only-writer/config (:writer database)))
    (is (false? (:keep-history? database)))
    (is (true? (:attribute-refs? database)))
    (is (thrown? clojure.lang.ExceptionInfo
                 (reader/validate-config (assoc config :access-key "forbidden"))))))

(deftest descriptor-claims-qualified-published-version-snapstart-test
  (let [descriptor
        (profile/descriptor
         {:identity {:profileId "datahike-s3"
                     :demoSha (apply str (repeat 40 "a"))
                     :eaclSha (apply str (repeat 40 "b"))
                     :artifactSha256 (apply str (repeat 64 "c"))
                     :deploymentId "candidate-1"
                     :dataManifestSha256 profile/data-manifest-sha256}
          :basis {:behavior "request-snapshot"
                  :id "datahike:536872941:6a7df54b"
                  :capturedAt "2026-08-26T00:00:00Z"
                  :fixedForEnvironment false}
          :operations #{"health" "bootstrap"}
          :memory-mib 1024})]
    (is (= "enabled" (get-in descriptor [:runtime :snapStart])))
    (is (not-any? #{"no-snapstart"}
                  (get-in descriptor [:capabilities :limitations])))))

(deftest open-reader-retains-one-snapshot-until-explicit-refresh-test
  (let [calls (atom [])
        releases (atom 0)
        fake-connection {:connection :existing}
        fake-client {:client :read-only}
        snapshots (atom 0)
        opened
        (reader/open-reader!
         config
         {:connect (fn [database]
                     (swap! calls conj [:connect database])
                     fake-connection)
          :release-connection
          (fn [connection]
            (swap! calls conj [:release-connection connection]))
          :make-client
          (fn [connection options]
            (swap! calls conj [:make-client connection options])
            fake-client)
          :snapshot (fn [client]
                      (swap! calls conj [:snapshot client])
                      {:snapshot (swap! snapshots inc)})
          :basis (fn [snapshot]
                   {:backend :datahike
                    :revision (+ 536872940 (:snapshot snapshot))
                    :exact-locator
                    (str "locator-" (:snapshot snapshot))})
          :release-snapshot (fn [snapshot]
                              (is (map? snapshot))
                              (swap! releases inc))})
        captured ((:capture-snapshot opened))]
    (is (= {:snapshot 1} (:value captured)))
    (is (= "datahike:536872941:locator-1"
           (get-in captured [:basis :id])))
    (is (= [:connect :make-client :snapshot] (mapv first @calls)))
    (is (true? (get-in (second @calls) [2 :read-only?])))
    ((:release! captured))
    (is (zero? @releases))
    (let [refreshed ((:refresh-snapshot! opened))]
      (is (= {:snapshot 2} (:value refreshed)))
      (is (= "datahike:536872942:locator-2" (get-in refreshed [:basis :id])))
      (is (= 1 @releases)))
    (reader/close-reader! opened)
    (is (= 2 @releases))
    (is (= :release-connection (first (last @calls))))))

(deftest read-only-writer-denies-dispatch-create-and-delete-test
  (let [writer (read-only-writer/->ReadOnlyWriter)]
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"cannot mutate"
                          (datahike.writer/-dispatch! writer {:op :transact})))
    (is (thrown? clojure.lang.ExceptionInfo
                 (datahike.writer/create-database
                  {:writer read-only-writer/config} {})))
    (is (thrown? clojure.lang.ExceptionInfo
                 (datahike.writer/delete-database
                  {:writer read-only-writer/config} {})))))
