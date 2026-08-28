(ns eacl-demo.datahike-dynamodb.reader
  "Existing-table-only Datahike/DynamoDB connection and immutable EACL snapshots."
  (:require [clojure.set :as set]
            [datahike.api :as d]
            [eacl.core :as eacl]
            [eacl.datahike.core :as datahike-eacl]
            [eacl-demo.datahike-dynamodb.boundary :as boundary]
            [eacl-demo.datahike-dynamodb.konserve :as dynamodb]
            [eacl-demo.datahike-dynamodb.read-only-writer :as read-only-writer])
  (:import [java.time Instant]
           [java.util UUID]))

(def required-config-keys
  #{:region :table :store-id :store-cache-size :search-cache-size
    :maximum-concurrency :security-key})

(def optional-config-keys
  #{:max-attempts :base-delay-ms :max-delay-ms :attempt-timeout-ms
    :connect-timeout-ms})

(defn validate-config
  [{:keys [region table store-id store-cache-size search-cache-size
           maximum-concurrency security-key]
    :as config}]
  (when-not (and (= required-config-keys
                    (set/intersection required-config-keys (set (keys config))))
                 (set/subset? (set (keys config))
                              (into required-config-keys optional-config-keys))
                 (string? region) (not-empty region)
                 (string? table) (not-empty table)
                 (instance? UUID store-id)
                 (pos-int? store-cache-size)
                 (nat-int? search-cache-size)
                 (pos-int? maximum-concurrency)
                 (string? security-key)
                 (<= 32 (count (.getBytes ^String security-key "UTF-8"))))
    (throw (ex-info "Invalid Datahike/DynamoDB reader configuration."
                    {:type :eacl-demo/invalid-config})))
  config)

(defn database-config
  [config]
  (let [{:keys [region table store-id store-cache-size search-cache-size]}
        (validate-config config)
        store-options (select-keys config optional-config-keys)]
    {:store (merge {:backend dynamodb/backend
                    :region region
                    :table table
                    :id store-id}
                   store-options)
     :writer read-only-writer/config
     :schema-flexibility :write
     :attribute-refs? true
     :keep-history? false
     :max-string-length 0
     :store-cache-size store-cache-size
     :search-cache-size search-cache-size
     :index-config {:diff-buf-size 256}
     :fuse-index-roots? true
     :commit-graph? false}))

(defn public-basis
  [basis]
  {:behavior "request-snapshot"
   :id (str "datahike:" (:revision basis) ":" (:exact-locator basis))
   :capturedAt (str (Instant/now))
   :fixedForEnvironment false})

(defn open-reader!
  ([config]
   (open-reader!
    config
    {:connect d/connect
     :release-connection d/release
     :make-client datahike-eacl/make-client
     :snapshot eacl/snapshot
     :basis eacl/basis
     :release-snapshot eacl/release!}))
  ([config {:keys [connect release-connection make-client snapshot basis
                   release-snapshot]}]
   (when-not (every? fn? [connect release-connection make-client snapshot
                          basis release-snapshot])
     (throw (ex-info "Invalid Datahike/DynamoDB reader operations."
                     {:type :eacl-demo/invalid-reader-operations})))
   (let [config (validate-config config)
         connection (connect (database-config config))]
     (try
       (let [client
             (make-client
              connection
              {:source-lifecycle
               {:application :eacl-demo
                :profile :datahike-dynamodb
                :store-backend :dynamodb
                :store-id (str (:store-id config))}
               ;; Do not construct EACL's writer role in the serving process.
               ;; The Datahike writer and Konserve protocol implementations
               ;; still fail closed because Datahike needs those protocols to
               ;; open an existing database, but no EACL mutation path is
               ;; initialized or retained by this client.
               :read-only? true
               :security-key (:security-key config)})
             create-snapshot
             (fn []
               (let [immutable-snapshot (snapshot client)]
                 (try
                   {:value immutable-snapshot
                    :basis (public-basis (basis immutable-snapshot))
                    :release! #(release-snapshot immutable-snapshot)}
                   (catch Throwable error
                     (release-snapshot immutable-snapshot)
                     (throw error)))))
             active (atom (create-snapshot))
             capture (fn []
                       (if-let [current @active]
                         (assoc current :release! (fn []))
                         (throw (ex-info "Datahike/DynamoDB reader is closed."
                                         {:type :eacl-demo/reader-closed}))))
             refresh (fn []
                       (let [next (create-snapshot)
                             [previous _] (reset-vals! active next)]
                         (when previous ((:release! previous)))
                         (capture)))
             release-active (fn []
                              (let [[previous _] (reset-vals! active nil)]
                                (when previous ((:release! previous)))))]
         {:config config
          :connection connection
          :client client
          :release-connection release-connection
          :capture-snapshot capture
          :refresh-snapshot! refresh
          :release-snapshot! release-active})
       (catch Throwable error
         (release-connection connection)
         (throw error))))))

(defn close-reader!
  [{:keys [connection release-connection release-snapshot!]}]
  (when release-snapshot! (release-snapshot!))
  (when connection ((or release-connection d/release) connection)))

(defn create-reader-boundary
  [reader descriptor handlers]
  (boundary/create-boundary
   {:descriptor descriptor
    :capture-snapshot (:capture-snapshot reader)
    :handlers handlers
    :maximum-concurrency (get-in reader [:config :maximum-concurrency])}))
