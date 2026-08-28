(ns eacl-demo.datomic-dynamodb-reader-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl.causal-token :as causal-token]
            [eacl-demo.datomic-dynamodb.reader :as reader])
  (:import [java.time Instant]))

(def config
  {:region "us-east-1"
   :table "eacl-demo-datomic-generation-test"
   :database "eacl-demo"
   :maximum-concurrency 2
   :security-key (apply str (repeat 32 "k"))})

(def fixture-schema-source (slurp "fixtures/schema.v1.zed"))

(deftest historical-token-retains-scope-and-authenticates-the-resolved-revision-test
  (let [options (#'reader/token-format-options (:security-key config))
        scope {:backend :datomic
               :source-id {:database-id "fixture-db"}
               :source-lifecycle {:application :eacl-demo}
               :branch nil}
        fixed-token
        (causal-token/issue
         options
         (assoc scope :revision 424242 :exact-locator 424242))
        fixed-payload (#'reader/decode-token options fixed-token)
        historical-token (#'reader/issue-exact-token options fixed-payload 400)
        payload (causal-token/token-data options scope historical-token)]
    (is (= 400 (:revision payload)))
    (is (= 400 (:exact-locator payload)))
    (is (= scope (select-keys payload (keys scope))))))

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
          :resolve-as-of
          (fn [db instant]
            (swap! calls conj [:resolve-as-of db instant])
            {:revision 400
             :captured-at (Instant/parse "2026-08-24T09:30:00Z")})
          :decode-token
          (fn [reader-config token]
            (swap! calls conj [:decode-token reader-config token])
            :fixed-token-scope)
          :issue-exact-token
          (fn [reader-config token-scope revision]
            (swap! calls conj [:issue-exact-token reader-config token-scope
                               revision])
            (if (= 400 revision)
              "historical-authenticated-token"
              "fixed-authenticated-token"))
          :release-snapshot #(swap! releases conj [:snapshot %])
          :release-connection #(swap! releases conj [:connection %])
          :clock (constantly captured-at)})
        first-snapshot ((:capture-snapshot opened))
        second-snapshot ((:capture-snapshot opened))
        historical-snapshot
        ((:capture-snapshot opened)
         {:consistency "historical-date"
          :atExactSnapshotAt "2026-08-24T10:00:00Z"})]
    (is (identical? fixed-db (:fixed-db opened)))
    (is (= 1 (count (filter #(= :current-db (first %)) @calls))))
    (is (= [[:select-current-snapshot :read-only-client]]
           (filterv #(= :select-current-snapshot (first %)) @calls)))
    (is (= [[:snapshot-db :initial-snapshot]
            [:snapshot-token :initial-snapshot]]
           (filterv #(#{:snapshot-db :snapshot-token} (first %)) @calls)))
    (is (= 3 (count (filter #(= :select-exact-snapshot (first %)) @calls))))
    (is (= ["fixed-authenticated-token" "fixed-authenticated-token"
            "historical-authenticated-token"]
           (mapv #(nth % 2)
                 (filter #(= :select-exact-snapshot (first %)) @calls))))
    (is (= 1 (count (filter #(= :decode-token (first %)) @calls))))
    (is (= [424242 424242 400]
           (mapv last
                 (filter #(= :issue-exact-token (first %)) @calls))))
    (is (= (:basis first-snapshot) (:basis second-snapshot)))
    (is (= {:behavior "fixed-environment"
            :id "datomic:eacl-demo-datomic-generation-test:eacl-demo:424242"
            :capturedAt "2026-08-25T12:00:00Z"
            :fixedForEnvironment true}
           (:basis first-snapshot)))
    (is (= {:behavior "request-snapshot"
            :id "datomic:eacl-demo-datomic-generation-test:eacl-demo:400"
            :capturedAt "2026-08-24T09:30:00Z"
            :fixedForEnvironment false}
           (:basis historical-snapshot)))
    (is (= [[:resolve-as-of fixed-db
             (Instant/parse "2026-08-24T10:00:00Z")]]
           (filterv #(= :resolve-as-of (first %)) @calls)))
    (let [[_ _ options] (first (filter #(= :make-client (first %)) @calls))]
      (is (true? (:read-only? options)))
      (is (= (:security-key config) (:security-key options))))
    ((:release! first-snapshot))
    ((:release! second-snapshot))
    ((:release! historical-snapshot))
    (reader/close-reader! opened)
    (is (= 4 (count (filter #(= :snapshot (first %)) @releases))))
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
           :resolve-as-of (fn [& _] :never)
           :decode-token (fn [& _] :never)
           :issue-exact-token (fn [& _] :never)
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
           :resolve-as-of (fn [& _] :never)
           :decode-token (fn [& _] :never)
           :issue-exact-token (fn [& _] :never)
           :release-snapshot #(swap! released conj [:snapshot %])
           :release-connection #(swap! released conj [:connection %])
           :clock #(Instant/now)})))
    (is (= [[:snapshot :initial-snapshot]
            [:connection :connection]]
           @released))))
