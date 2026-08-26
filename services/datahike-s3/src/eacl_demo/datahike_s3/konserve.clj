(ns eacl-demo.datahike-s3.konserve
  "Existing-store-only, read-only Konserve facade for the adopted S3 bytes."
  (:require [clojure.set :as set]
            [eacl-demo.datahike-s3.client :as read-only-client]
            [konserve-s3.core :as s3]
            [konserve-s3.storage :as s3-storage]
            [konserve.impl.defaults :refer [connect-default-store
                                            normalize-store-config]]
            [konserve.impl.storage-layout
             :refer [PBackingBlob PBackingStore PReadMissSafe]]
            [konserve.store :as store]
            [konserve.utils :refer [*default-sync-translation* async+sync]]
            [superv.async :refer [go-try-]]))

(def backend :eacl-demo-s3-read-only-store)

(def ^:private allowed-config-keys
  #{:backend :bucket :region :id})

(defn validate-config
  [{:keys [backend bucket region id] :as config}]
  (when-not (and (= backend eacl-demo.datahike-s3.konserve/backend)
                 (set/subset? (set (keys config)) allowed-config-keys)
                 (string? bucket) (not-empty bucket)
                 (string? region) (not-empty region)
                 (uuid? id))
    (throw (ex-info "Invalid read-only S3 store configuration."
                    {:type :eacl-demo/invalid-s3-store-config})))
  config)

(defn- denied!
  [operation]
  (throw (ex-info "The Datahike/S3 serving store is read-only."
                  {:type :eacl-demo/read-only
                   :code "route-not-found"
                   :operation operation})))

(defrecord ReadOnlyBlob [delegate]
  PBackingBlob
  (-sync [_ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :sync-blob))))
  (-close [_ env]
    (konserve.impl.storage-layout/-close delegate env))
  (-get-lock [_ env]
    (konserve.impl.storage-layout/-get-lock delegate env))
  (-read-header [_ env]
    (konserve.impl.storage-layout/-read-header delegate env))
  (-read-meta [_ meta-size env]
    (konserve.impl.storage-layout/-read-meta delegate meta-size env))
  (-read-value [_ meta-size env]
    (konserve.impl.storage-layout/-read-value delegate meta-size env))
  (-read-binary [_ meta-size locked-cb env]
    (konserve.impl.storage-layout/-read-binary delegate meta-size locked-cb env))
  (-write-header [_ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :write-header))))
  (-write-meta [_ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :write-meta))))
  (-write-value [_ _ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :write-value))))
  (-write-binary [_ _ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :write-binary)))))

(defrecord ReadOnlyStore [client bucket store-id delegate]
  PBackingStore
  (-create-blob [_ store-key env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try-
                 (->ReadOnlyBlob
                  (s3/->S3Blob delegate
                               (s3-storage/->key store-id store-key)
                               (atom {}) (atom nil) (atom nil))))))
  (-delete-blob [_ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :delete-blob))))
  (-blob-exists? [_ store-key env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (s3/exists? client bucket
                                      (s3-storage/->key store-id store-key)))))
  (-migratable [_ _ _ env]
    (if (:sync? env) nil (go-try- nil)))
  (-migrate [_ _ _ _ _ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :migrate))))
  (-copy [_ _ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :copy))))
  (-atomic-move [_ _ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :atomic-move))))
  ;; connect-default-store invokes this hook while opening a store. The
  ;; upstream S3 implementation creates a bucket and writes its marker here;
  ;; this facade preflights the existing marker and deliberately does nothing.
  (-create-store [_ env]
    (if (:sync? env) nil (go-try- nil)))
  (-delete-store [_ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :delete-store))))
  (-store-exists? [_ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (s3/exists? client bucket
                                      (s3-storage/marker-key store-id)))))
  (-sync-store [_ env]
    (if (:sync? env) nil (go-try- nil)))
  (-keys [_ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :enumerate-store-keys))))
  (-handle-foreign-key [_ _ _ _ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :migrate-foreign-key)))))

(extend-type ReadOnlyStore PReadMissSafe)

(defn- backing-store
  [config client]
  (let [store-id (str (:id config))
        bucket (:bucket config)
        delegate (s3/->S3Bucket client bucket store-id (atom {}))]
    (->ReadOnlyStore client bucket store-id delegate)))

(defn connect-store
  ([config]
   (let [config (validate-config config)
         client (read-only-client/read-only-client (s3/s3-client config))]
     (connect-store config client)))
  ([config client]
   (let [config (validate-config config)
         backing (backing-store config client)]
     (when-not (konserve.impl.storage-layout/-store-exists?
                backing {:sync? true})
       (throw (ex-info "The existing Datahike/S3 store marker is missing."
                       {:type :eacl-demo/missing-s3-store
                        :bucket (:bucket config)
                        :store-id (str (:id config))})))
     (connect-default-store
      backing
      (-> {:opts {:sync? true}
           :config {:sync-blob? true
                    :in-place? true
                    :no-backup? true
                    :lock-blob? true}
           :buffer-size (* 1024 1024)}
          normalize-store-config
          (update-in [:config :encoding]
                     #(merge {:serializer :FressianSerializer} %)))))))

(defmethod store/-connect-store backend
  [config opts]
  (async+sync (:sync? opts) *default-sync-translation*
              (go-try- (connect-store config))))

(defmethod store/-store-exists? backend
  [config opts]
  (async+sync (:sync? opts) *default-sync-translation*
              (go-try-
               (let [config (validate-config config)
                     client (read-only-client/read-only-client
                             (s3/s3-client config))]
                 (konserve.impl.storage-layout/-store-exists?
                  (backing-store config client) {:sync? true})))))

(defmethod store/-release-store backend
  [_config _connected opts]
  ;; The upstream dependency caches one SDK client per endpoint. Per-store
  ;; release must not close that shared client; close-reader! shuts the cache
  ;; down once when the Lambda environment is retired.
  (if (:sync? opts) nil (go-try- nil)))
