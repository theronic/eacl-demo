(ns eacl-demo.datahike-dynamodb-reader-test
  (:require [clojure.test :refer [deftest is]]
            [eacl-demo.datahike-dynamodb.konserve :as dynamodb]
            [eacl-demo.datahike-dynamodb.read-only-writer :as read-only-writer]
            [eacl-demo.datahike-dynamodb.reader :as reader]))

(def config
  {:region "us-east-1"
   :table "eacl-demo-datahike-generation-test"
   :store-id (java.util.UUID/fromString
              "f139f638-ae20-4d3a-b8fc-b386f34c62ee")
   :store-cache-size 1000
   :search-cache-size 0
   :maximum-concurrency 2
   :security-key (apply str (repeat 32 "k"))
   :max-attempts 4
   :base-delay-ms 25
   :max-delay-ms 250
   :attempt-timeout-ms 3000
   :connect-timeout-ms 1000})

(deftest exact-existing-table-configuration-test
  (let [database (reader/database-config config)]
    (is (= dynamodb/backend (get-in database [:store :backend])))
    (is (true? (get-in database [:store :consistent-read?] true)))
    (is (= (:store-id config) (get-in database [:store :id])))
    (is (= read-only-writer/config (:writer database)))
    (is (false? (:keep-history? database)))
    (is (thrown? clojure.lang.ExceptionInfo
                 (reader/validate-config (assoc config :security-key "short"))))
    (is (thrown? clojure.lang.ExceptionInfo
                 (reader/validate-config (assoc config :access-key "forbidden"))))))

(deftest reader-captures-and-releases-one-request-snapshot-test
  (let [calls (atom [])
        releases (atom 0)
        opened
        (reader/open-reader!
         config
         {:connect (fn [database]
                     (swap! calls conj [:connect database])
                     :connection)
          :release-connection #(swap! calls conj [:release-connection %])
          :make-client (fn [connection options]
                         (swap! calls conj [:make-client connection options])
                         :client)
          :snapshot (fn [client]
                      (swap! calls conj [:snapshot client])
                      :snapshot)
          :basis (constantly {:revision 42 :exact-locator "locator"})
          :release-snapshot (fn [snapshot]
                              (is (= :snapshot snapshot))
                              (swap! releases inc))})
        captured ((:capture-snapshot opened))]
    (is (= :snapshot (:value captured)))
    (is (= "datahike:42:locator" (get-in captured [:basis :id])))
    (is (= [:connect :make-client :snapshot] (mapv first @calls)))
    (is (true? (get-in (second @calls) [2 :read-only?])))
    (is (= (:security-key config)
           (get-in (second @calls) [2 :security-key])))
    ((:release! captured))
    (is (= 1 @releases))))
