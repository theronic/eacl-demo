(ns eacl-demo.datahike-dynamodb.konserve
  "Read-only Konserve backing with a closed DynamoDB dependency surface."
  (:require [clojure.set :as set]
            [eacl-demo.datahike-dynamodb.adapter :as adapter]
            [eacl-demo.datahike-dynamodb.client :as read-only-client]
            [eacl-demo.datahike-dynamodb.context :as context]
            [eacl-demo.datahike-dynamodb.errors :as errors]
            [eacl-demo.datahike-dynamodb.retry :as retry]
            [konserve.impl.defaults :refer [connect-default-store
                                            normalize-store-config]]
            [konserve.impl.storage-layout
             :refer [PBackingBlob PBackingLock PBackingStore PMultiReadBackingStore
                     PReadMissSafe store-key-not-found-ex]]
            [konserve.store :as store]
            [konserve.utils :refer [*default-sync-translation* async+sync]]
            [superv.async :refer [go-try-]])
  (:import [java.io ByteArrayInputStream]
           [java.time Duration]
           [java.util Map]
           [software.amazon.awssdk.core SdkBytes]
           [software.amazon.awssdk.core.client.config ClientOverrideConfiguration]
           [software.amazon.awssdk.core.retry RetryPolicy]
           [software.amazon.awssdk.http.urlconnection UrlConnectionHttpClient]
           [software.amazon.awssdk.regions Region]
           [software.amazon.awssdk.services.dynamodb DynamoDbClient]
           [software.amazon.awssdk.services.dynamodb.model
            DescribeTableRequest DescribeTableResponse ResourceNotFoundException]))

(def backend :eacl-demo-dynamodb-read-only-store)

(def ^:private allowed-config-keys
  #{:backend :id :region :table :max-attempts :base-delay-ms :max-delay-ms
    :attempt-timeout-ms :connect-timeout-ms})

(def ^:private unfetched (Object.))

(defn validate-config
  [{:keys [backend id region table max-attempts base-delay-ms max-delay-ms
           attempt-timeout-ms connect-timeout-ms]
    :as config}]
  (when-not (and (= backend eacl-demo.datahike-dynamodb.konserve/backend)
                 (set/subset? (set (keys config)) allowed-config-keys)
                 (uuid? id)
                 (string? region) (not-empty region)
                 (string? table) (not-empty table)
                 (or (nil? max-attempts) (<= 1 max-attempts 8))
                 (or (nil? base-delay-ms) (<= 1 base-delay-ms 1000))
                 (or (nil? max-delay-ms) (<= 1 max-delay-ms 1000))
                 (or (nil? attempt-timeout-ms)
                     (<= 50 attempt-timeout-ms 5000))
                 (or (nil? connect-timeout-ms)
                     (<= 50 connect-timeout-ms 5000)))
    (throw (ex-info "Invalid read-only DynamoDB store configuration."
                    {:type :eacl-demo/invalid-dynamodb-store-config})))
  config)

(defn- retry-base
  [config]
  (select-keys config [:max-attempts :base-delay-ms :max-delay-ms
                       :attempt-timeout-ms]))

(defn- retry-options
  [backing]
  (merge (:retry-base backing) (context/current)))

(defn dynamodb-client
  [{:keys [region attempt-timeout-ms connect-timeout-ms] :as config}]
  (validate-config config)
  (let [attempt-timeout (Duration/ofMillis (long (or attempt-timeout-ms 3000)))
        connect-timeout (Duration/ofMillis (long (or connect-timeout-ms 1000)))
        override (-> (ClientOverrideConfiguration/builder)
                     (.retryPolicy (RetryPolicy/none))
                     (.apiCallTimeout attempt-timeout)
                     (.apiCallAttemptTimeout attempt-timeout)
                     .build)
        http (-> (UrlConnectionHttpClient/builder)
                 (.connectionTimeout connect-timeout)
                 (.socketTimeout attempt-timeout))]
    (read-only-client/read-only-client
     (-> (DynamoDbClient/builder)
         (.region (Region/of region))
         (.httpClientBuilder http)
         (.overrideConfiguration override)
         .build))))

(defn- denied!
  [operation]
  (throw (ex-info "The Datahike/DynamoDB serving store is read-only."
                  {:type :eacl-demo/read-only
                   :code "route-not-found"
                   :operation operation})))

(defn- item-bytes
  [item attribute]
  (some-> ^Map item (.get attribute) ^software.amazon.awssdk.services.dynamodb.model.AttributeValue
          .b ^SdkBytes .asByteArray))

(defrecord ReadOnlyLock []
  PBackingLock
  (-release [_ env]
    (if (:sync? env) nil (go-try- nil))))

(declare ->ReadOnlyBlob)

(defn- fetch!
  [blob]
  (let [state (:fetched blob)]
    (when (identical? unfetched @state)
      (reset! state
              (adapter/get-item! (:client (:backing blob))
                                 (:table (:backing blob))
                                 (:store-key blob)
                                 (retry-options (:backing blob)))))
    @state))

(defrecord ReadOnlyBlob [backing store-key fetched]
  PBackingBlob
  (-sync [_ env]
    (if (:sync? env) nil (go-try- nil)))
  (-close [_ env]
    (if (:sync? env) nil (go-try- nil)))
  (-get-lock [_ env]
    (if (:sync? env) (->ReadOnlyLock) (go-try- (->ReadOnlyLock))))
  (-read-header [this env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try-
                 (let [item (fetch! this)]
                   (when-not item (throw (store-key-not-found-ex store-key)))
                   (item-bytes item "Header")))))
  (-read-meta [this _meta-size env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (item-bytes (fetch! this) "Meta"))))
  (-read-value [this _meta-size env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (item-bytes (fetch! this) "Value"))))
  (-read-binary [this _meta-size locked-cb env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try-
                 (let [value (item-bytes (fetch! this) "Value")]
                   (locked-cb {:input-stream (ByteArrayInputStream. value)
                               :size (alength ^bytes value)})))))
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

(defrecord ReadOnlyStore [^DynamoDbClient client table retry-base]
  PBackingStore
  (-create-blob [this store-key env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (->ReadOnlyBlob this store-key (atom unfetched)))))
  (-delete-blob [_ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :delete-blob))))
  (-blob-exists? [this store-key env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (boolean (adapter/get-item! client table store-key
                                                      (retry-options this))))))
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
  ;; Konserve 0.9.391 checks -store-exists? before invoking this hook. Serving
  ;; must refuse a missing table instead of attempting to create one; the
  ;; public store/-create-store multimethod also remains unregistered.
  (-create-store [_ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try-
                 (throw (ex-info "The existing Datahike/DynamoDB table is missing."
                                 {:type :eacl-demo/missing-dynamodb-store
                                  :table table})))))
  (-delete-store [_ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :delete-store))))
  (-store-exists? [this env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try-
                 (try
                   (= "ACTIVE"
                      (some->
                       (retry/invoke!
                        :describe-table (retry-options this)
                        (fn [_]
                          (.describeTable
                           client
                           (-> (DescribeTableRequest/builder)
                               (.tableName table)
                               .build))))
                       ^DescribeTableResponse .table .tableStatusAsString))
                   (catch clojure.lang.ExceptionInfo error
                     (if (= :missing (:category (ex-data error)))
                       false
                       (throw error)))))))
  (-sync-store [_ env]
    (if (:sync? env) nil (go-try- nil)))
  (-keys [_ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :enumerate-store-keys))))
  (-handle-foreign-key [_ _ _ _ _ env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try- (denied! :migrate-foreign-key))))

  PMultiReadBackingStore
  (-multi-read-blobs [this store-keys env]
    (async+sync (:sync? env) *default-sync-translation*
                (go-try-
                 (into {}
                       (map (fn [[store-key item]]
                              [store-key
                               (->ReadOnlyBlob this store-key (atom item))]))
                       (adapter/batch-get-items!
                        client table store-keys (retry-options this)))))))

(extend-type ReadOnlyStore PReadMissSafe)

(defn connect-store
  ([config]
   (connect-store config (dynamodb-client config)))
  ([config client]
   (let [config (validate-config config)
         backing (->ReadOnlyStore client (:table config) (retry-base config))
         store-config
         (-> {:opts {:sync? true}
              :config {:sync-blob? true
                       :in-place? true
                       :no-backup? true
                       :lock-blob? true}
              :buffer-size (* 1024 1024)}
             normalize-store-config
             (update-in [:config :encoding]
                        #(merge {:serializer :FressianSerializer} %)))]
     (connect-default-store backing store-config))))

(defmethod store/-connect-store backend
  [config opts]
  (async+sync (:sync? opts) *default-sync-translation*
              (go-try- (connect-store config))))

(defmethod store/-store-exists? backend
  [config opts]
  (async+sync (:sync? opts) *default-sync-translation*
              (go-try-
               (let [client (dynamodb-client config)
                     backing (->ReadOnlyStore client (:table config)
                                              (retry-base config))]
                 (try
                   (konserve.impl.storage-layout/-store-exists? backing
                                                                {:sync? true})
                   (finally (.close client)))))))

(defmethod store/-release-store backend
  [_config connected opts]
  (async+sync (:sync? opts) *default-sync-translation*
              (go-try-
               (when-let [client (some-> connected :backing :client)]
                 (.close ^DynamoDbClient client)))))
