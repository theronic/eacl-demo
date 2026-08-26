(ns eacl-demo.datahike-s3.reader
  "Existing-store-only Datahike/S3 connection and immutable EACL snapshots."
  (:require [datahike.api :as d]
            [eacl.core :as eacl]
            [eacl.datahike.core :as datahike-eacl]
            [eacl-demo.datahike-s3.boundary :as boundary]
            [eacl-demo.datahike-s3.konserve :as read-only-store]
            [eacl-demo.datahike-s3.read-only-writer :as read-only-writer]
            [konserve-s3.core :as konserve-s3])
  (:import [java.time Instant]
           [java.util UUID]))

(defn validate-config
  [{:keys [bucket region store-id security-key] :as config}]
  (when-not (and (= (set (keys config))
                     #{:bucket :region :store-id :store-cache-size
                       :search-cache-size :maximum-concurrency :security-key})
                 (string? bucket) (not-empty bucket)
                 (string? region) (not-empty region)
                 (instance? UUID store-id)
                 (pos-int? (:store-cache-size config))
                 (nat-int? (:search-cache-size config))
                 (pos-int? (:maximum-concurrency config))
                 (string? security-key)
                 (<= 32 (count (.getBytes ^String security-key "UTF-8"))))
    (throw (ex-info "Invalid Datahike/S3 reader configuration."
                    {:type :eacl-demo/invalid-config})))
  config)

(defn database-config
  [config]
  (let [{:keys [bucket region store-id store-cache-size search-cache-size]}
        (validate-config config)]
    {:store {:backend read-only-store/backend
             :bucket bucket :region region :id store-id}
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
  "Connects to an existing store. There is deliberately no existence/create
  fallback: missing storage is a typed startup failure."
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
     (throw (ex-info "Invalid Datahike/S3 reader operations."
                     {:type :eacl-demo/invalid-reader-operations})))
   (let [config (validate-config config)
         conn (connect (database-config config))]
     (try
       (let [client
             (make-client
              conn
              {:source-lifecycle
               {:application :eacl-demo
                :profile :datahike-s3
                :store-backend read-only-store/backend
                :store-id (str (:store-id config))}
               :read-only? true
               :security-key (:security-key config)})]
         {:config config
          :connection conn
          :client client
          :release-connection release-connection
          :capture-snapshot
          (fn []
            (let [immutable-snapshot (snapshot client)]
              (try
                {:value immutable-snapshot
                 :basis (public-basis (basis immutable-snapshot))
                 :release! #(release-snapshot immutable-snapshot)}
                (catch Throwable error
                  (release-snapshot immutable-snapshot)
                  (throw error)))))})
       (catch Throwable error
         (release-connection conn)
         (throw error))))))

(defn create-reader-boundary
  [reader descriptor handlers]
  (boundary/create-boundary
   {:descriptor descriptor
    :capture-snapshot (:capture-snapshot reader)
    :handlers handlers
    :maximum-concurrency (get-in reader [:config :maximum-concurrency])}))

(defn close-reader!
  [{:keys [connection release-connection]}]
  (when connection ((or release-connection d/release) connection))
  (konserve-s3/shutdown-clients!))
