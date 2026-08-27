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

(deftest reader-retains-one-db-and-builds-exact-request-snapshots-test
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
          :select-current-snapshot
          (fn [client]
            (swap! calls conj [:select-current-snapshot client])
            :initial-snapshot)
          :select-exact-snapshot
          (fn [client token]
            (swap! calls conj [:select-exact-snapshot client token])
            (Object.))
          :snapshot-db
          (fn [snapshot]
            (swap! calls conj [:snapshot-db snapshot])
            fixed-db)
          :snapshot-token
          (fn [snapshot]
            (swap! calls conj [:snapshot-token snapshot])
            "fixed-authenticated-token")
          :release-snapshot #(swap! releases conj [:snapshot %])
          :release-connection #(swap! releases conj [:connection %])
          :clock (constantly captured-at)})
        first-snapshot ((:capture-snapshot opened))
        second-snapshot ((:capture-snapshot opened))]
    (is (identical? fixed-db (:fixed-db opened)))
    (is (= 1 (count (filter #(= :current-db (first %)) @calls))))
    (is (= [[:select-current-snapshot :read-only-client]]
           (filterv #(= :select-current-snapshot (first %)) @calls)))
    (is (= [[:snapshot-db :initial-snapshot]
            [:snapshot-token :initial-snapshot]]
           (filterv #(#{:snapshot-db :snapshot-token} (first %)) @calls)))
    (is (= 2 (count (filter #(= :select-exact-snapshot (first %)) @calls))))
    (is (every? #(= "fixed-authenticated-token" (nth % 2))
                (filter #(= :select-exact-snapshot (first %)) @calls)))
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
    (is (= 3 (count (filter #(= :snapshot (first %)) @releases))))
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
           :select-current-snapshot (fn [& _] :never)
           :select-exact-snapshot (fn [& _] :never)
           :snapshot-db (fn [& _] :never)
           :snapshot-token (fn [& _] :never)
           :release-snapshot (fn [_])
           :release-connection #(swap! released conj %)
           :clock #(Instant/now)})))
    (is (= [:connection] @released))))

(deftest initialization-basis-drift-fails-closed-and-releases-resources-test
  (let [released (atom [])]
    (is (thrown-with-msg?
         clojure.lang.ExceptionInfo #"advanced while fixing"
         (reader/open-reader!
          config
          {:connect (constantly :connection)
           :current-db (constantly :fixed-db)
           :basis-t (fn [db] (if (= :fixed-db db) 41 42))
           :make-client (constantly :client)
           :read-schema-source (constantly fixture-schema-source)
           :select-current-snapshot (constantly :initial-snapshot)
           :select-exact-snapshot (fn [& _] :never)
           :snapshot-db (constantly :advanced-db)
           :snapshot-token (fn [& _] :never)
           :release-snapshot #(swap! released conj [:snapshot %])
           :release-connection #(swap! released conj [:connection %])
           :clock #(Instant/now)})))
    (is (= [[:snapshot :initial-snapshot]
            [:connection :connection]]
           @released))))
