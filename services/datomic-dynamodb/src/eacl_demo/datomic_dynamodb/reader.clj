(ns eacl-demo.datomic-dynamodb.reader
  "Read-only Datomic/DynamoDB reader fixed to one initialization DB value."
  (:require [datomic.api :as d]
            [eacl.core :as eacl]
            [eacl.datomic.core :as datomic-eacl]
            [eacl.spicedb.consistency :as consistency])
  (:import [java.nio.charset StandardCharsets]
           [java.security MessageDigest]
           [java.time Instant]))

(def ^:private fixture-schema-sha256
  "7fa7ae57dec4e442c66815ea74a63b08f12a79d7e9a716ebc8f1d6b03ee2262c")

(declare sha256)

(def ^:private region-pattern
  #"[a-z]{2}(?:-[a-z0-9]+)+-[0-9]")

(def ^:private table-pattern
  #"eacl-demo-datomic-[a-z0-9-]{3,80}")

(def ^:private database-pattern
  #"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")

(defn validate-config
  [{:keys [region table database maximum-concurrency security-key] :as config}]
  (when-not (and (= #{:region :table :database :maximum-concurrency :security-key}
                     (set (keys config)))
                 (string? region) (re-matches region-pattern region)
                 (string? table) (re-matches table-pattern table)
                 (string? database) (re-matches database-pattern database)
                 (pos-int? maximum-concurrency)
                 (string? security-key)
                 (<= 32 (alength (.getBytes ^String security-key
                                            StandardCharsets/UTF_8))))
    (throw (ex-info "Invalid Datomic/DynamoDB reader configuration."
                    {:type :eacl-demo/invalid-config})))
  config)

(defn connection-uri
  "Builds the only serving URI form. Callers cannot supply query parameters,
  credentials, endpoints, protocols, or an already-assembled URI."
  [config]
  (let [{:keys [region table database]} (validate-config config)]
    (str "datomic:ddb://" region "/" table "/" database
         "?read-only=true")))

(defn public-basis
  [{:keys [table database]} revision captured-at]
  {:behavior "fixed-environment"
   :id (str "datomic:" table ":" database ":" revision)
   :capturedAt (str captured-at)
   :fixedForEnvironment true})

(defn open-reader!
  "Connects without a transactor, retains exactly one current DB value, and
  creates request-scoped EACL snapshots selected by its authenticated exact
  basis token."
  ([config]
   (open-reader!
    config
    {:connect d/connect
     :current-db d/db
     :basis-t d/basis-t
     :make-client datomic-eacl/make-client
     :select-current-snapshot eacl/snapshot
     :select-exact-snapshot
     (fn [client token]
       (eacl/snapshot client (consistency/at-exact-snapshot token)))
     :snapshot-db datomic-eacl/db
     :snapshot-token eacl/basis-token
     :release-snapshot eacl/release!
     :release-connection d/release
     :read-schema-source (fn [database]
                           (:eacl/schema-string
                            (d/entity database [:eacl/id "schema-string"])))
     :clock #(Instant/now)}))
  ([config {:keys [connect current-db basis-t make-client
                   select-current-snapshot select-exact-snapshot snapshot-db
                   snapshot-token release-snapshot release-connection
                   read-schema-source clock]}]
   (when-not (every? fn? [connect current-db basis-t make-client
                          select-current-snapshot select-exact-snapshot
                          snapshot-db snapshot-token release-snapshot
                          release-connection read-schema-source clock])
     (throw (ex-info "Invalid Datomic/DynamoDB reader operations."
                     {:type :eacl-demo/invalid-reader-operations})))
   (let [config (validate-config config)
         connection (connect (connection-uri config))]
     (try
       (let [fixed-db (current-db connection)
             fixed-revision (basis-t fixed-db)
             schema-source (read-schema-source fixed-db)
             _ (when-not (and (string? schema-source)
                              (= fixture-schema-sha256
                                 (sha256 schema-source)))
                 (throw (ex-info "Datomic fixture schema identity mismatch."
                                 {:type :eacl-demo/schema-identity-mismatch})))
             client
             (make-client
              connection
              {:source-lifecycle
               {:application :eacl-demo
                :profile :datomic-dynamodb
                :store-backend :dynamodb
                :table (:table config)
                :database (:database config)}
               :read-only? true
               :security-key (:security-key config)})
             initial-snapshot (select-current-snapshot client)
             fixed-token
             (try
               (let [selected-revision
                     (basis-t (snapshot-db initial-snapshot))]
                 (when-not (= fixed-revision selected-revision)
                   (throw
                    (ex-info
                     "Datomic reader advanced while fixing its serving basis."
                     {:type :eacl-demo/initialization-basis-drift
                      :expected fixed-revision
                      :actual selected-revision})))
                 (snapshot-token initial-snapshot))
               (finally
                 (release-snapshot initial-snapshot)))
             fixed-basis (public-basis config fixed-revision (clock))]
         {:config config
          :connection connection
          :client client
          :fixed-db fixed-db
          :basis fixed-basis
          :release-connection release-connection
          :capture-snapshot
          (fn []
            (let [snapshot (select-exact-snapshot client fixed-token)]
              {:value snapshot
               :basis fixed-basis
               :release! #(release-snapshot snapshot)}))})
       (catch Throwable error
         (release-connection connection)
         (throw error))))))

(defn close-reader!
  [{:keys [connection release-connection]}]
  (when connection
    ((or release-connection d/release) connection)))

(defn- sha256
  [value]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (apply str
           (map #(format "%02x" (bit-and 255 %))
                (.digest digest
                         (.getBytes ^String value StandardCharsets/UTF_8))))))
