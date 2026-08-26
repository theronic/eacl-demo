(ns eacl-demo.datomic-dynamodb-reader-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.datomic-dynamodb.reader :as reader])
  (:import [java.time Instant]))

(def config
  {:region "us-east-1"
   :table "eacl-demo-datomic-generation-test"
   :database "eacl-demo"
   :maximum-concurrency 2
   :security-key (apply str (repeat 32 "k"))})

(def fixture-schema-source (slurp "fixtures/schema.v1.zed"))

(deftest exact-read-only-connection-uri-test
  (is (= (str "datomic:ddb://us-east-1/eacl-demo-datomic-generation-test/"
              "eacl-demo?read-only=true")
         (reader/connection-uri config)))
  (doseq [forbidden [{:uri "datomic:mem://forbidden"}
                     {:aws-access-key-id "forbidden"}
                     {:endpoint "http://127.0.0.1:8000"}
                     {:query "read-only=false"}]]
    (is (thrown? clojure.lang.ExceptionInfo
                 (reader/validate-config (merge config forbidden)))))
  (is (thrown? clojure.lang.ExceptionInfo
               (reader/validate-config (assoc config :table "bad/table")))))

(deftest reader-retains-one-db-and-builds-direct-request-snapshots-test
  (let [calls (atom [])
        releases (atom [])
        fixed-db (Object.)
        captured-at (Instant/parse "2026-08-25T12:00:00Z")
        opened
        (reader/open-reader!
         config
         {:connect (fn [uri]
                     (swap! calls conj [:connect uri])
                     :read-only-connection)
          :current-db (fn [connection]
                        (swap! calls conj [:current-db connection])
                        fixed-db)
          :basis-t (fn [db]
                     (swap! calls conj [:basis-t db])
                     424242)
          :make-client (fn [connection options]
                         (swap! calls conj [:make-client connection options])
                         :read-only-client)
          :read-schema-source (fn [db]
                                (swap! calls conj [:read-schema-source db])
                                fixture-schema-source)
          :direct-snapshot (fn [client db]
                             (swap! calls conj [:direct-snapshot client db])
                             (Object.))
          :release-snapshot #(swap! releases conj [:snapshot %])
          :release-connection #(swap! releases conj [:connection %])
          :clock (constantly captured-at)})
        first-snapshot ((:capture-snapshot opened))
        second-snapshot ((:capture-snapshot opened))]
    (is (identical? fixed-db (:fixed-db opened)))
    (is (= 1 (count (filter #(= :current-db (first %)) @calls))))
    (is (= 2 (count (filter #(= :direct-snapshot (first %)) @calls))))
    (is (every? #(identical? fixed-db (nth % 2))
                (filter #(= :direct-snapshot (first %)) @calls)))
    (is (= (:basis first-snapshot) (:basis second-snapshot)))
    (is (= {:behavior "fixed-environment"
            :id "datomic:eacl-demo-datomic-generation-test:eacl-demo:424242"
            :capturedAt "2026-08-25T12:00:00Z"
            :fixedForEnvironment true}
           (:basis first-snapshot)))
    (let [[_ _ options] (first (filter #(= :make-client (first %)) @calls))]
      (is (true? (:read-only? options)))
      (is (= (:security-key config) (:security-key options))))
    ((:release! first-snapshot))
    ((:release! second-snapshot))
    (reader/close-reader! opened)
    (is (= 2 (count (filter #(= :snapshot (first %)) @releases))))
    (is (= [[:connection :read-only-connection]]
           (filterv #(= :connection (first %)) @releases)))))

(deftest failed-initialization-releases-connection-test
  (let [released (atom [])]
    (is (thrown-with-msg?
         clojure.lang.ExceptionInfo #"incompatible"
         (reader/open-reader!
          config
          {:connect (constantly :connection)
           :current-db (constantly :never)
           :basis-t (constantly 1)
           :make-client (fn [& _] (throw (ex-info "incompatible" {})))
           :read-schema-source (constantly fixture-schema-source)
           :direct-snapshot (fn [& _] :never)
           :release-snapshot (fn [_])
           :release-connection #(swap! released conj %)
           :clock #(Instant/now)})))
    (is (= [:connection] @released))))
