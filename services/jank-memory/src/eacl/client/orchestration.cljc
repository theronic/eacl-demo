(ns eacl.client.orchestration
  "Single-backend public orchestration over tagged maps and ordinary functions."
  (:require [eacl.cache.local :as local-cache]
            [eacl.authorization.batch :as batch]
            [eacl.authorization.filters :as authorization-filters]
            [eacl.cursor :as cursor]
            [eacl.domain :as domain]
            [eacl.engine.denotation :as denotation]
            [eacl.engine.discovery :as discovery]
            [eacl.engine.portable-indexed :as indexed]
            [eacl.engine.sealed-plan :as sealed-plan]
            [eacl.engine.permission-tree :as permission-tree]
            [eacl.engine.v8 :as engine]
            [eacl.execution :as execution]
            [eacl.request.context :as context]
            [eacl.relationships.filters :as relationship-filters]
            [eacl.secure-keyring :as secure-keyring]
            #?(:jank [eacl.runtime.native.crypto :as crypto])))

;; This is intentionally not an SPI. The one bundled backend constructs this
;; closed table internally; callers cannot provide or replace it.
(def ^:private operation-keys
  #{:select-snapshot :read-operations :source-scope
    :read-schema :write-schema :read-relationship-window :write-relationships
    :delete-object :ordering-abi})
(def ^:private function-operation-keys
  (disj operation-keys :ordering-abi))

(def ^:private client-kind ::client)
(def ^:private client-version 1)
(def ^:private client-fields
  #{::kind ::version ::connection ::operations ::source-scope
    ::options ::caches})

(def ^:private view-kind ::snapshot-view)
(def ^:private view-version 1)
(def ^:private view-fields #{::kind ::version ::client ::context})

(def ^:private cache-names
  [:schema :answer :continuation :page-navigation :cursor-codec])
(def ^:private client-option-keys
  #{:cache :execution-timeout-ms :scalar-limits :aggregate-limits
    :permission-tree-limits :security-key :security-keyring :security-kid
    :cursor-ttl-seconds})
(def ^:private cache-option-keys #{:max-entries})
(def ^:private point-request-keys
  #{:subject :permission :resource :consistency :timeout-ms
    :cancellation-token :cache? :populate-cache? :evaluation})
(def ^:private snapshot-request-option-keys
  #{:timeout-ms :cancellation-token})
(def ^:private expansion-request-keys
  #{:resource :permission :consistency :timeout-ms :cancellation-token
    :cache? :populate-cache?})

(defn- fail!
  [type reason data]
  (throw
   (ex-info
    "EACL client operation failed."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn- closed-map!
  [value known-keys type reason]
  (when-not (map? value)
    (fail! type reason {:value value}))
  (let [unknown (vec (remove known-keys (keys value)))]
    (when (seq unknown)
      (fail! type :unknown-request-key
             {:unknown-keys unknown :known-keys known-keys})))
  value)

(defn- normalize-cache-option
  [value]
  (cond
    (or (nil? value) (true? value))
    {:enabled? true :maximum-entries 2048}

    (false? value)
    {:enabled? false :maximum-entries 2048}

    (map? value)
    (do
      (closed-map! value cache-option-keys :eacl/invalid-config
                   :invalid-cache-options)
      (let [maximum (or (:max-entries value) 2048)]
        (when-not (and (integer? maximum) (<= 1 maximum 65536))
          (fail! :eacl/invalid-config :invalid-cache-capacity
                 {:value maximum :minimum 1 :maximum 65536}))
        {:enabled? true :maximum-entries maximum}))

    :else
    (fail! :eacl/invalid-config :invalid-cache-option {:value value})))

(defn- normalize-options
  [options]
  (closed-map! (or options {}) client-option-keys
               :eacl/invalid-config :invalid-client-options)
  (when (and (:security-key options) (:security-keyring options))
    (fail! :eacl/invalid-config :conflicting-security-key-options
           {:conflicting-keys [:security-key :security-keyring]}))
  (let [cache (normalize-cache-option (:cache options))
        timeout (or (:execution-timeout-ms options)
                    execution/default-execution-timeout-ms)
        limits (execution/normalize-scalar-limits (:scalar-limits options))
        kid (or (:security-kid options) "default")
        cursor-keyring
        (cond
          (:security-keyring options)
          (let [candidate (:security-keyring options)
                normalized
                (if (secure-keyring/keyring? candidate)
                  candidate
                  (secure-keyring/keyring candidate))]
            (when (and (:security-kid options)
                       (not= kid (:active-kid normalized)))
              (fail! :eacl/invalid-config :security-kid-not-active
                     {:security-kid kid}))
            normalized)

          (:security-key options)
          (secure-keyring/keyring
           {:active-kid kid :keys {kid (:security-key options)}})

          :else
          #?(:jank
             (secure-keyring/keyring
              {:active-kid kid
               :keys {kid (crypto/secure-random-hex 32)}})
             :clj nil))
        cursor-ttl (or (:cursor-ttl-seconds options) 3600)]
    (execution/normalize-timeout-ms timeout)
    (when-not (and (integer? cursor-ttl) (<= 1 cursor-ttl 604800))
      (fail! :eacl/invalid-config :invalid-cursor-ttl
             {:value cursor-ttl}))
    {:cache cache
     :execution-timeout-ms timeout
     :scalar-limits limits
     :aggregate-limits
     (batch/normalize-client-limits (:aggregate-limits options))
     :permission-tree-limits
     (permission-tree/normalize-limits (:permission-tree-limits options))
     :cursor-keyring cursor-keyring
     :cursor-ttl-seconds cursor-ttl}))

(defn- operations?
  [operations]
  (and (map? operations)
       (= operation-keys (set (keys operations)))
       (every? fn? (map operations function-operation-keys))
       (integer? (:ordering-abi operations))
       (pos? (:ordering-abi operations))))

(defn- operation-value!
  [result operation]
  (when-not (and (map? result)
                 (= #{:value :error} (set (keys result)))
                 (or (nil? (:error result))
                     (nil? (:value result))))
    (fail! :eacl.store/invalid-response
           :invalid-operation-envelope {:operation operation}))
  (if-let [error (:error result)]
    (throw error)
    (:value result)))

(defn make-client*
  "Internal constructor called only by the bundled memory module."
  [connection operations options]
  (when-not (operations? operations)
    (fail! :eacl.store/invalid-operations :invalid-client-operation-table {}))
  (let [options (normalize-options options)
        source-scope
        (operation-value! ((:source-scope operations) connection)
                          :source-scope)
        maximum (get-in options [:cache :maximum-entries])]
    (when-not (and (map? source-scope)
                   (= #{:store-id :lifecycle-id} (set (keys source-scope)))
                   (every? #(and (string? %) (not (empty? %)))
                           (vals source-scope)))
      (fail! :eacl.store/invalid-connection :invalid-source-scope {}))
    {::kind client-kind
     ::version client-version
     ::connection connection
     ::operations operations
     ::source-scope source-scope
     ::options options
     ::caches
     {:plan (sealed-plan/plan-cache maximum)
      :schema (local-cache/cache :schema maximum)
      :answer (local-cache/cache :answer maximum)
      :continuation (local-cache/cache :continuation maximum)
      :page-navigation (local-cache/cache :page-navigation maximum)
      :cursor-codec (local-cache/cache :cursor-codec maximum)}}))

(defn client?
  [value]
  (and (map? value)
       (= client-fields (set (keys value)))
       (= client-kind (::kind value))
       (= client-version (::version value))
       (operations? (::operations value))
       (map? (::options value))
       (map? (::caches value))))

(defn snapshot-view?
  [value]
  (and (map? value)
       (= view-fields (set (keys value)))
       (= view-kind (::kind value))
       (= view-version (::version value))
       (client? (::client value))
       (context/context? (::context value))))

(defn authorization-target?
  [value]
  (or (client? value) (snapshot-view? value)))

(defn- require-client!
  [value]
  (when-not (client? value)
    (fail! :eacl/invalid-authorization-target
           :invalid-client {:target :non-eacl}))
  value)

(defn- require-target!
  [value]
  (when-not (authorization-target? value)
    (fail! :eacl/invalid-authorization-target
           :invalid-client-or-snapshot-view {:target :non-eacl}))
  value)

(defn- target-client
  [target]
  (if (snapshot-view? target) (::client target) target))

(defn- require-view!
  [view]
  (when-not (snapshot-view? view)
    (fail! :eacl/invalid-authorization-target
           :invalid-snapshot-view {}))
  ;; Context validation enforces open state and mandatory execution ownership.
  (context/assert-open! (::context view))
  view)

(defn- consistency-descriptor
  [value]
  (cond
    (nil? value) :minimize-latency
    (contains? #{:minimize-latency :fully-consistent} value) value
    (map? value)
    (do
      (when-not (= #{:consistency/mode :zed/token} (set (keys value)))
        (fail! :eacl/unsupported-consistency :invalid-consistency-descriptor
               {:value value}))
      (when-not (and
                 (contains? #{:at-least-as-fresh :at-exact-snapshot}
                            (:consistency/mode value))
                 (string? (:zed/token value)))
        (fail! :eacl/unsupported-consistency :invalid-consistency-descriptor
               {:value value}))
      {:mode (:consistency/mode value) :token (:zed/token value)})
    :else
    (fail! :eacl/unsupported-consistency :invalid-consistency-descriptor
           {:value value})))

(defn- normalize-point-request
  [request]
  (closed-map! request point-request-keys
               :eacl/invalid-request :invalid-point-request)
  (doseq [required [:subject :permission :resource]]
    (when-not (contains? request required)
      (fail! :eacl/invalid-request :missing-point-field
             {:key required})))
  (when (and (contains? request :cache?)
             (not (boolean? (:cache? request))))
    (fail! :eacl/invalid-request :invalid-cache-control
           {:key :cache? :value (:cache? request)}))
  (when (and (contains? request :populate-cache?)
             (not (boolean? (:populate-cache? request))))
    (fail! :eacl/invalid-request :invalid-cache-control
           {:key :populate-cache? :value (:populate-cache? request)}))
  (when-not (contains? #{nil :demand} (:evaluation request))
    (fail! :eacl/unsupported-feature :unsupported-evaluation-mode
           {:evaluation (:evaluation request)
            :supported #{:demand}}))
  request)

(defn- public-contract
  [client operation request]
  (assoc
   (execution/normalize (::options client) operation request)
   :evaluation :demand))

(defn- make-request-context
  [client descriptor contract]
  (let [operations (::operations client)
        selection
        (operation-value!
         ((:select-snapshot operations)
          (::connection client) descriptor
          {:deadline-nanos (:deadline-nanos contract)
           :cancellation-token (:cancellation-token contract)})
         :select-snapshot)
        read-operations
        (operation-value! ((:read-operations operations))
                          :read-operations)]
    (context/make-context
     {:selection selection
      :operations read-operations
      :source-scope (::source-scope client)
      :contract contract
      :plan-cache (get-in client [::caches :plan])})))

(defn- close-after-error!
  [request-context error]
  (try
    (context/close! request-context)
    (throw error)
    (catch #?(:jank cpp/jank.runtime.object_ref
              :clj Throwable) close-error
      (if (= close-error error)
        (throw error)
        (throw
         (ex-info
          "EACL request failed and its snapshot release also failed."
          {:type :eacl/snapshot-release-failed
           :eacl/error :eacl/snapshot-release-failed
           :request-error (ex-data error)
           :release-error (ex-data close-error)}))))))

(defn- fixed-request!
  [view request]
  (require-view! view)
  (when (some? (:consistency request))
    (fail! :eacl/snapshot-view-consistency-fixed
           :consistency-already-selected
           {:requested (:consistency request)}))
  (let [contract (context/contract (::context view))]
    (when (and (contains? request :timeout-ms)
               (not= (:timeout-ms request)
                     (:configured-timeout-ms contract)))
      (fail! :eacl/invalid-snapshot-request-options
             :nested-timeout-cannot-replace-shared-deadline {}))
    (when (and (contains? request :cancellation-token)
               (not= (:cancellation-token request)
                     (:cancellation-token contract)))
      (fail! :eacl/invalid-snapshot-request-options
             :nested-cancellation-scope-cannot-change {})))
  (dissoc request :consistency :timeout-ms :cancellation-token))

(defn- cache-enabled?
  [client request]
  (and (get-in client [::options :cache :enabled?])
       (not= false (:cache? request))))

(defn- cache-population-enabled?
  [client request]
  ;; Locked EACL Core treats :cache? as the dominant execution control:
  ;; bypassing reads also bypasses publication even when :populate-cache? is
  ;; true. With reads enabled, :populate-cache? false creates a read-only
  ;; cache request that may hit but never installs a result artifact.
  (and (cache-enabled? client request)
       (not= false (:populate-cache? request))))

(defn- proof-key
  [client prepared]
  (let [base (:base prepared)]
    {:kind :point-answer-v1
     :store-scope (::source-scope client)
     :schema-generation (:schema-generation base)
     :dependency-proof (:dependency-proof base)
     :plan-fingerprint (:plan-fingerprint base)
     :subject-eid (:subject-eid prepared)
     :resource-eid (:resource-eid prepared)
     :demand (:demand prepared)
     :engine-version engine/engine-version
     :ordering-abi (get-in client [::operations :ordering-abi])
     :evaluation :demand
     :scalar-limits (get-in client [::options :scalar-limits])}))

(defn- provenance
  [request-context prepared]
  (let [selection (context/selection request-context)]
    {:basis-t (:basis selection)
     :store-id (:store-id (context/source-scope request-context))
     :lifecycle-id (:lifecycle-id (context/source-scope request-context))
     :schema-generation (context/schema-generation request-context)
     :relation-stamps
     (get-in prepared [:base :dependency-proof :relation-stamps])}))

(defn- render-point
  [request-context prepared client request]
  (context/cut-point! request-context :before-completed-answer-cache)
  (let [cache (get-in client [::caches :answer])
        enabled? (cache-enabled? client request)
        populate? (cache-population-enabled? client request)
        ;; Missing-object denial depends on absence, for which this port has no
        ;; durable object-generation proof. Such decisions are never shared.
        cacheable? (and enabled?
                        (:subject-eid prepared)
                        (:resource-eid prepared))]
    (if cacheable?
      (let [key (proof-key client prepared)
            selected-basis
            (get-in (context/selection request-context) [:basis])
            _ (context/record! request-context :cache-key-builds)
            hit
            (local-cache/lookup-if!
             cache key
             (fn [artifact]
               (let [artifact-basis
                     (get-in artifact [:provenance :basis-t])]
                 ;; Frozen PR #145 managed reuse is forward-only. An answer
                 ;; computed at a newer basis cannot be lifted into an older
                 ;; retained snapshot even when its scalar stamps are equal.
                 (and (integer? artifact-basis)
                      (<= artifact-basis selected-basis)))))]
        (if (:found? hit)
          (do
            (context/record! request-context :completed-answer-hits)
            (context/cut-point! request-context
                                :after-completed-answer-cache-hit)
            {:allowed? (get-in hit [:value :allowed?])
             :cached? true
             :cache-basis (get-in hit [:value :provenance])
             :evaluation :demand})
          (let [allowed? (engine/evaluate-prepared-allowed!
                          request-context prepared)
                artifact {:allowed? allowed?
                          :provenance (provenance request-context prepared)}]
            (context/cut-point! request-context
                                :before-completed-answer-publication)
            (when populate?
              (local-cache/install! cache key artifact)
              (context/record! request-context
                               :completed-answer-publications))
            {:allowed? allowed?
             :cached? false
             :cache-basis (:provenance artifact)
             :evaluation :demand})))
      (do
        (local-cache/bypass! cache)
        (context/record! request-context :cache-bypasses)
        (let [allowed? (engine/evaluate-prepared-allowed!
                        request-context prepared)]
          {:allowed? allowed?
           :cached? false
           :cache-basis nil
           :evaluation :demand})))))

(defn- check-in-context
  [client request-context request]
  (context/cut-point! request-context :public-point-validation)
  (let [prepared
        (engine/prepare-point!
         request-context
         (select-keys request [:subject :permission :resource]))
        result (render-point request-context prepared client request)]
    (context/cut-point! request-context :public-point-rendered)
    result))

(defn check-permission
  [target raw-request]
  (let [target (require-target! target)
        request (normalize-point-request raw-request)
        client (target-client target)]
    (if (snapshot-view? target)
      (do
        (context/record! (::context target) :public-entries)
        (check-in-context client (::context target)
                          (fixed-request! target request)))
      (let [contract (public-contract client :check-permission request)
            descriptor (consistency-descriptor (:consistency request))
            _ (execution/check! contract :before-public-snapshot-selection)
            request-context (make-request-context client descriptor contract)]
        (try
          (context/record! request-context :public-entries)
          (let [result (check-in-context client request-context request)]
            (context/close! request-context)
            result)
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            (close-after-error! request-context error)))))))

(defn can?
  [target request]
  (:allowed? (check-permission target request)))

(defn- evaluate-batch-in-context
  [client request-context request]
  (let [checks (:checks request)
        limits (:aggregate-limits request)
        aggregate-before (context/aggregate-counters request-context)]
    (loop [index 0
           output []]
      (if (= index (count checks))
        (do
          (context/cut-point! request-context :batch-complete)
          output)
        (let [demand (nth checks index)
              _ (context/cut-point! request-context :batch-demand-schedule)
              _ (context/begin-demand! request-context)
              attempt
              (try
                {:value
                 (check-in-context
                  client request-context
                  (cond-> demand
                    (contains? request :cache?)
                    (assoc :cache? (:cache? request))
                    (contains? request :populate-cache?)
                    (assoc :populate-cache? (:populate-cache? request))))
                 :error nil}
                (catch #?(:jank cpp/jank.runtime.object_ref
                          :clj Throwable) error
                  {:value nil :error error}))
              _ (context/end-demand! request-context)
              aggregate
              (batch/aggregate-counters
               aggregate-before
               (context/aggregate-counters request-context)
               (if (:error attempt) index (inc index)))]
          (when-let [error (:error attempt)]
            (throw (batch/demand-error error index aggregate)))
          (batch/check-aggregate-limits! limits aggregate index)
          (recur (inc index) (conj output (:value attempt))))))))

(defn check-permissions
  [target raw-request]
  (let [target (require-target! target)
        client (target-client target)
        request
        (batch/validate-request!
         raw-request (get-in client [::options :aggregate-limits]))
        checks (:checks request)]
    (if (empty? checks)
      (do
        ;; Normalize all request-wide controls, but acquire no snapshot.
        (public-contract client :check-permissions request)
        [])
      (if (snapshot-view? target)
        (evaluate-batch-in-context
         client (::context target) (fixed-request! target request))
        (let [contract (public-contract client :check-permissions request)
              descriptor (consistency-descriptor (:consistency request))
              _ (execution/check! contract :before-public-snapshot-selection)
              request-context
              (make-request-context client descriptor contract)]
          (try
            (let [result
                  (evaluate-batch-in-context client request-context request)]
              (context/close! request-context)
              result)
            (catch #?(:jank cpp/jank.runtime.object_ref
                      :clj Throwable) error
              (close-after-error! request-context error))))))))

(defn- schema-in-context
  [client request-context]
  (context/cut-point! request-context :before-schema-read)
  (let [key [::source-schema (::source-scope client)
             (context/schema-generation request-context)]
        cache (get-in client [::caches :schema])
        hit (local-cache/lookup! cache key)
        schema
        (if (:found? hit)
          (:value hit)
          (let [built
                (operation-value!
                 ((get-in client [::operations :read-schema])
                  (context/database request-context))
                 :read-schema)]
            (local-cache/install! cache key built)))]
    (context/cut-point! request-context :after-schema-read)
    schema))

(defn read-schema
  [target]
  (let [target (require-target! target)
        client (target-client target)]
    (if (snapshot-view? target)
      (do (require-view! target)
          (schema-in-context client (::context target)))
      (let [contract (public-contract client :read-schema {})
            _ (execution/check! contract :before-public-snapshot-selection)
            request-context
            (make-request-context client :minimize-latency contract)]
        (try
          (let [result (schema-in-context client request-context)]
            (context/close! request-context)
            result)
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            (close-after-error! request-context error)))))))

(defn- normalize-expansion-request
  [request]
  (closed-map! request expansion-request-keys
               :eacl.permission-tree/invalid-request
               :invalid-permission-tree-request)
  (doseq [required [:resource :permission]]
    (when-not (contains? request required)
      (fail! :eacl.permission-tree/invalid-request
             :missing-permission-tree-field
             {:key required})))
  (let [resource (:resource request)
        permission (:permission request)]
    (when-not (and (map? resource)
                   (every? domain/object-fields (keys resource))
                   (keyword? (:type resource))
                   (nil? (namespace (:type resource)))
                   (string? (:id resource))
                   (not (empty? (:id resource))))
      (fail! :eacl.permission-tree/invalid-request
             :invalid-resource
             {:key :resource}))
    (when (:relation resource)
      (fail! :eacl.permission-tree/invalid-request
             :resource-relation-unsupported
             {:key :resource/relation}))
    (when-not (and (keyword? permission)
                   (nil? (namespace permission)))
      (fail! :eacl.permission-tree/invalid-request :invalid-permission
             {:key :permission
              :permission permission})))
  (when (and (contains? request :cache?)
             (not (boolean? (:cache? request))))
    (fail! :eacl/invalid-request :invalid-cache-control
           {:key :cache? :value (:cache? request)}))
  (when (and (contains? request :populate-cache?)
             (not (boolean? (:populate-cache? request))))
    (fail! :eacl/invalid-request :invalid-cache-control
           {:key :populate-cache? :value (:populate-cache? request)}))
  request)

(defn- expansion-in-context
  [client request-context request]
  (let [tree
        (permission-tree/expand!
         request-context (:resource request) (:permission request)
         (get-in client [::options :permission-tree-limits]))]
    (context/cut-point! request-context :permission-tree-rendered)
    {:expanded-at (get-in (context/selection request-context)
                          [:causal-token])
     :tree-root tree}))

(defn expand-permission-tree
  [target raw-request]
  (let [target (require-target! target)
        request (normalize-expansion-request raw-request)
        client (target-client target)]
    (if (snapshot-view? target)
      (expansion-in-context
       client (::context target) (fixed-request! target request))
      (let [contract (public-contract client :expand-permission-tree request)
            descriptor (consistency-descriptor (:consistency request))
            _ (execution/check! contract :before-public-snapshot-selection)
            request-context (make-request-context client descriptor contract)]
        (try
          (let [result
                (expansion-in-context client request-context request)]
            (context/close! request-context)
            result)
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            (close-after-error! request-context error)))))))

(defn- reject-view-write!
  [target]
  (when (snapshot-view? target)
    (require-view! target)
    (fail! :eacl/read-only-snapshot-view :read-only-snapshot-view {})))

(defn require-writable!
  "Public validation seam used by convenience functions before normalization."
  [target]
  (require-target! target)
  (reject-view-write! target)
  target)

(defn snapshot-view-write-error-data
  "Return the exact write rejection for a snapshot view, or nil for a client."
  [target]
  (when (snapshot-view? target)
    (or (context/access-error-data (::context target))
        {:type :eacl/read-only-snapshot-view
         :eacl/error :eacl/read-only-snapshot-view
         :reason :read-only-snapshot-view})))

(defn write-schema!
  [target source]
  (require-target! target)
  (reject-view-write! target)
  (let [client (require-client! target)
        result
        (operation-value!
         ((get-in client [::operations :write-schema])
          (::connection client) source)
         :write-schema)]
    {:eacl.schema/no-op? (:no-op? result)
     :relations (:relations result)
     :permissions (:permissions result)
     :zed/token (:causal-token result)}))

(defn write-relationships!
  [target updates]
  (require-target! target)
  (reject-view-write! target)
  (let [client (require-client! target)
        result
        (operation-value!
         ((get-in client [::operations :write-relationships])
          (::connection client) updates)
         :write-relationships)]
    {:zed/token (:causal-token result)}))

(defn delete-object!
  [target object]
  (require-target! target)
  (reject-view-write! target)
  (let [client (require-client! target)
        result
        (operation-value!
         ((get-in client [::operations :delete-object])
          (::connection client) object)
         :delete-object)]
    {:zed/token (:causal-token result)
     :retracted-datoms (:retracted-endpoint-datoms result)}))

(def ^:private relationship-page-keys
  #{:subject/type :subject/id :resource/type :resource/id
    :resource/relation :first :last :after :before :consistency
    :timeout-ms :cancellation-token :cache? :populate-cache? :evaluation
    :aggregate-limits :authorization})

(def ^:private scan-authorization-keys #{:subject :permission :on})

(defn- normalize-scan-authorization
  [filters value]
  (when-not (map? value)
    (fail! :eacl.filters/invalid-authorization-clause
           :authorization-must-be-map {:position :authorization}))
  (let [unknown (vec (remove scan-authorization-keys (keys value)))
        missing (vec (remove #(contains? value %) scan-authorization-keys))]
    (when (seq unknown)
      (fail! :eacl.filters/invalid-authorization-clause
             :unknown-authorization-key
             {:position :authorization :unknown-keys unknown
              :known-keys scan-authorization-keys}))
    (when (seq missing)
      (fail! :eacl.filters/invalid-authorization-clause
             :missing-authorization-key
             {:position :authorization :missing-keys missing})))
  (let [subject (domain/normalize-object (:subject value))
        permission (:permission value)
        on (:on value)
        required-type (case on
                        :subject :subject/type
                        :resource :resource/type
                        nil)]
    (when (:relation subject)
      (fail! :eacl.pagination/unsupported-filter
             :subject-relation-unsupported
             {:filter :authorization/subject-relation}))
    (when-not (keyword? permission)
      (fail! :eacl.filters/invalid-authorization-clause
             :invalid-permission {:position :authorization}))
    (when-not required-type
      (fail! :eacl.filters/invalid-authorization-clause
             :invalid-authorization-endpoint {:on on}))
    (when-not (keyword? (get filters required-type))
      (fail! :eacl.filters/invalid-authorization-clause
             :missing-authorization-endpoint-type
             {:on on :required-filter required-type}))
    {:subject subject :permission permission :on on}))

(defn- normalize-relationship-page
  [client query]
  (closed-map! query relationship-page-keys
               :eacl/invalid-request :invalid-relationship-read)
  (when (and (contains? query :cache?)
             (not (boolean? (:cache? query))))
    (fail! :eacl/invalid-request :invalid-cache-control
           {:key :cache? :value (:cache? query)}))
  (when (and (contains? query :populate-cache?)
             (not (boolean? (:populate-cache? query))))
    (fail! :eacl/invalid-request :invalid-cache-control
           {:key :populate-cache? :value (:populate-cache? query)}))
  (when-not (contains? #{nil :demand} (:evaluation query))
    (fail! :eacl/unsupported-feature :unsupported-evaluation-mode
           {:evaluation (:evaluation query)}))
  (when (and (:first query) (:last query))
    (fail! :eacl.pagination/invalid-page-request
           :both-page-directions
           {:first (:first query) :last (:last query)}))
  (let [direction (if (:last query) :backward :forward)
        size (or (:first query) (:last query) 100)
        anchor-string (if (= :forward direction)
                        (:after query) (:before query))]
    (when-not (and (integer? size) (<= 1 size 1000))
      (fail! :eacl.pagination/invalid-page-request
             :invalid-page-size {:value size :maximum 1000}))
    (when (and (:after query) (not= :forward direction))
      (fail! :eacl.pagination/invalid-page-request
             :after-requires-first {}))
    (when (and (:before query) (not= :backward direction))
      (fail! :eacl.pagination/invalid-page-request
             :before-requires-last {}))
    (when (and anchor-string (not (string? anchor-string)))
      (fail! :eacl.pagination/invalid-cursor :malformed-cursor {}))
    (let [filters (select-keys query relationship-filters/anchor-keys)
          limits
          (batch/normalize-request-limits
           (get-in client [::options :aggregate-limits])
           (:aggregate-limits query))]
      ;; Complete filter validation occurs before cursor decoding or selection.
      (relationship-filters/validate! filters)
      (let [authorization
            (when (contains? query :authorization)
              (normalize-scan-authorization filters (:authorization query)))
            route (if authorization
                    :authorized-relationship-scan
                    :raw-relationship-scan)]
        {:request query :filters filters :authorization authorization
         :aggregate-limits limits :direction direction
         :page-size size :cursor anchor-string
         :cursor-scope
         {:route route
          :filters filters
          :authorization authorization
          :direction direction
          :page-size size
          :aggregate-limits limits
          :scalar-limits (get-in client [::options :scalar-limits])
          :evaluation :demand}}))))

(defn- decode-cursor!
  [client encoded]
  (let [cache (get-in client [::caches :cursor-codec])
        key [:decode encoded]
        hit (local-cache/lookup! cache key)
        payload
        (if (:found? hit)
          (:value hit)
          (let [decoded
                (cursor/decode
                 (get-in client [::options :cursor-keyring]) encoded)]
            (local-cache/install! cache key decoded)))]
    ;; Expiry is checked on every use, including codec-cache hits.
    (cursor/validate-current! payload)))

(defn- bound-cursor-payload!
  [client page]
  (when-let [encoded (:cursor page)]
    (let [payload (decode-cursor! client encoded)
          expected-scope (::source-scope client)
          expected-order (get-in client [::operations :ordering-abi])]
      (when-not (and (= :read-relationships (:operation payload))
                     (= (:cursor-scope-fingerprint page)
                        (:query-fingerprint payload))
                     (= expected-scope (:source-scope payload))
                     (= expected-order (:ordering-abi payload)))
        (fail! :eacl.pagination/invalid-cursor
               :cursor-query-mismatch {}))
      payload)))

(defn- page-provenance
  [request-context]
  {:basis-t (get-in (context/selection request-context) [:basis])
   :store-id (:store-id (context/source-scope request-context))
   :lifecycle-id (:lifecycle-id (context/source-scope request-context))
   :schema-generation (context/schema-generation request-context)})

(defn- issue-cursor-cached
  "Issue one authenticated cursor, reusing the exact ciphertext only for an
  identical payload inside a conservative fraction of its TTL. This cache is
  a codec optimization, not authorization-answer reuse: keys include the full
  snapshot, proof, scope, and anchor payload, and expiry still bounds reuse."
  [client payload]
  (let [ttl (get-in client [::options :cursor-ttl-seconds])
        bucket-width (max 1 (min 60 (quot ttl 4)))
        bucket (quot (cursor/now-seconds) bucket-width)
        cache (get-in client [::caches :cursor-codec])
        key [:encode bucket payload]
        hit (local-cache/lookup! cache key)]
    (if (:found? hit)
      (:value hit)
      (local-cache/install!
       cache key
       (cursor/issue
        (get-in client [::options :cursor-keyring]) ttl payload)))))

(defn- issue-page-cursor
  [client request-context page anchor]
  (issue-cursor-cached
   client
   {:operation :read-relationships
    :query-fingerprint (:cursor-scope-fingerprint page)
    :anchor anchor
    :snapshot-token
    (get-in (context/selection request-context) [:causal-token])
    :source-scope (context/source-scope request-context)
    :native-revision (get-in (context/selection request-context) [:basis])
    :schema-generation (context/schema-generation request-context)
    :ordering-abi (get-in client [::operations :ordering-abi])
    :dependency-proof-fingerprint
    (:dependency-proof-fingerprint page)}))

(defn- relationship-page-in-context
  [client request-context page cursor-payload]
  (context/assert-open! request-context)
  (when cursor-payload
    (when-not (and (= (:native-revision cursor-payload)
                      (get-in (context/selection request-context) [:basis]))
                   (= (:schema-generation cursor-payload)
                      (context/schema-generation request-context)))
      (fail! :eacl.pagination/invalid-cursor
             :cursor-snapshot-mismatch {})))
  (discovery/validate-relationship-filters!
   request-context (:filters page))
  (let [proof {:schema-generation (context/schema-generation request-context)
               :relation-stamps []}
        page (assoc page :dependency-proof-fingerprint
                    (cursor/fingerprint proof))
        direction (:direction page)
        page-size (:page-size page)
        anchor (:anchor cursor-payload)
        navigation-cache (get-in client [::caches :page-navigation])
        enabled? (cache-enabled? client (:request page))
        populate? (cache-population-enabled? client (:request page))
        cache-key
        [:raw-relationship-page
         (context/source-scope request-context)
         (get-in (context/selection request-context) [:basis])
         (context/schema-generation request-context)
         (:filters page) direction anchor page-size
         (get-in client [::operations :ordering-abi])]
        cached (when enabled?
                 (local-cache/lookup! navigation-cache cache-key))
        artifact
        (if (and cached (:found? cached))
          (:value cached)
          (do
            (when-not enabled? (local-cache/bypass! navigation-cache))
            (context/consume! request-context :commands)
            (let [window
                  (operation-value!
                   ((get-in client [::operations :read-relationship-window])
                    (context/database request-context) (:filters page)
                    direction anchor (inc page-size)
                    (get-in page
                            [:aggregate-limits :max-candidates-examined])
                    (context/contract request-context))
                   :read-relationship-window)
                  examined (:examined window)
                  _ (context/record! request-context
                                     :candidates-examined examined)
                  _ (context/consume! request-context
                                      :fetched-values examined)
                  built {:entries (:entries window)}]
              (if populate?
                (local-cache/install! navigation-cache cache-key built)
                built))))
        traversal-entries (:entries artifact)
        sentinel? (> (count traversal-entries) page-size)
        selected (vec (take page-size traversal-entries))
        display (if (= :backward direction)
                  (vec (reverse selected)) selected)
        start-anchor (:anchor (first display))
        end-anchor (:anchor (last display))
        prior-cursor? (boolean cursor-payload)
        has-previous?
        (if (= :forward direction) prior-cursor? sentinel?)
        has-next?
        (if (= :forward direction) sentinel? prior-cursor?)
        cache-hit? (boolean (and cached (:found? cached)))]
    (context/cut-point! request-context :raw-relationship-page-render)
    {:data (mapv :relationship display)
     :page-info
     {:start-cursor
      (when start-anchor
        (issue-page-cursor client request-context page start-anchor))
      :end-cursor
      (when end-anchor
        (issue-page-cursor client request-context page end-anchor))
      :has-next-page? has-next?
      :has-previous-page? has-previous?}
     :cached? cache-hit?
     :cache-basis (when enabled? (page-provenance request-context))}))

(declare authorization-relationship-page-in-context
         discovery-error aggregate-values check-aggregate-state!)

(defn- dispatch-relationship-page-in-context
  [client request-context page cursor-payload]
  (if (:authorization page)
    (authorization-relationship-page-in-context
     client request-context page cursor-payload)
    (relationship-page-in-context
     client request-context page cursor-payload)))

(defn read-relationships
  [target query]
  (let [target (require-target! target)
        client (target-client target)
        page (normalize-relationship-page client query)
        page (assoc page :cursor-scope-fingerprint
                    (cursor/fingerprint (:cursor-scope page)))
        contract
        (if (snapshot-view? target)
          (context/contract (::context target))
          (public-contract client :read-relationships (:request page)))
        _ (execution/check! contract :before-cursor-decode)
        cursor-payload (bound-cursor-payload! client page)
        _ (execution/check! contract :after-cursor-decode)]
    (when (and cursor-payload
               (some? (get-in page [:request :consistency])))
      (fail! :eacl.pagination/invalid-cursor
             :cursor-consistency-conflict {}))
    (if (snapshot-view? target)
      (let [fixed (fixed-request! target (:request page))
            page (assoc page :request fixed)]
        (try
          (dispatch-relationship-page-in-context
           client (::context target) page cursor-payload)
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            (throw
             (if (:authorization page)
               (discovery-error error)
               error)))))
      (let [request (:request page)
            _ (execution/check! contract :before-cursor-selection)
            descriptor
            (if cursor-payload
              {:mode :at-exact-snapshot
               :token (:snapshot-token cursor-payload)}
              (consistency-descriptor (:consistency request)))
            request-context (make-request-context client descriptor contract)]
        (try
          (let [result
                (dispatch-relationship-page-in-context
                 client request-context page cursor-payload)]
            (context/close! request-context)
            result)
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            (close-after-error!
             request-context
             (if (:authorization page)
               (discovery-error error)
               error))))))))

(defn- prepare-authorization-scan!
  [request-context page]
  (discovery/validate-relationship-filters!
   request-context (:filters page))
  (let [{:keys [subject permission on]} (:authorization page)
        endpoint-type
        (get-in page [:filters (if (= :subject on)
                                 :subject/type :resource/type)])
        root
        (discovery/validate-root!
         request-context (:type subject) endpoint-type permission
         :read-relationships)
        fixed-eid (indexed/object-eid! request-context (:id subject))]
    {:root root :fixed-object subject :fixed-eid fixed-eid
     :endpoint on :empty? (nil? fixed-eid)}))

(defn- authorization-relationship-step!
  [client request-context page prepared bound authorize?]
  (context/begin-demand! request-context)
  (let [attempt
        (try
          (do
            (context/consume! request-context :commands)
            (let [window
                  (operation-value!
                   ((get-in client [::operations :read-relationship-window])
                    (context/database request-context) (:filters page)
                    (:direction page) bound 1
                    (get-in page
                            [:aggregate-limits :max-candidates-examined])
                    (context/contract request-context))
                   :read-relationship-window)
                  _ (context/consume! request-context
                                      :fetched-values (:examined window))
                  entry (first (:entries window))]
              (if-not entry
                {:value {:entry nil} :error nil}
                (if-not authorize?
                  {:value {:entry entry} :error nil}
                  (do
                    (context/record! request-context :candidates-examined)
                    (let [relationship (:relationship entry)
                          endpoint (get relationship (:endpoint prepared))
                          endpoint-eid
                          (indexed/object-eid! request-context (:id endpoint))
                          decision
                          (render-point
                           request-context
                           (discovery/prepared-candidate
                            request-context (:root prepared)
                            :read-relationships
                            (:fixed-object prepared) endpoint
                            (:fixed-eid prepared) endpoint-eid)
                           client (:request page))]
                      {:value {:entry entry
                               :accepted? (:allowed? decision)}
                       :error nil}))))))
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            {:value nil :error error}))
        _ (context/end-demand! request-context)]
    (if-let [error (:error attempt)]
      (throw (discovery-error error))
      (:value attempt))))

(defn- execute-authorization-relationship-page!
  [client request-context page prepared initial-bound aggregate-before]
  (if (:empty? prepared)
    {:entries [] :progress-anchor initial-bound
     :more? false :bounded? false}
    (loop [bound initial-bound
           examined 0
           accepted []]
      (context/cut-point! request-context
                          :authorization-relationship-candidate-schedule)
      (if (= examined (get-in page [:aggregate-limits :candidate-window]))
        (let [more?
              (boolean
               (:entry
                (authorization-relationship-step!
                 client request-context page prepared bound false)))]
          (check-aggregate-state!
           (:aggregate-limits page) aggregate-before request-context
           (count accepted) nil)
          {:entries accepted :progress-anchor bound
           :more? more? :bounded? more?})
        (let [step
              (authorization-relationship-step!
               client request-context page prepared bound true)
              entry (:entry step)]
          (if-not entry
            {:entries accepted :progress-anchor bound
             :more? false :bounded? false}
            (let [next-examined (inc examined)
                  next-accepted
                  (if (:accepted? step) (conj accepted entry) accepted)]
              (check-aggregate-state!
               (:aggregate-limits page) aggregate-before request-context
               (min (count next-accepted) (:page-size page)) nil)
              (if (> (count next-accepted) (:page-size page))
                {:entries (vec (take (:page-size page) next-accepted))
                 :progress-anchor bound :more? true :bounded? false}
                (recur (:anchor entry) next-examined next-accepted)))))))))

(defn- render-authorization-relationship-page
  [client request-context page cursor-payload artifact cache-hit? enabled?]
  (let [direction (:direction page)
        selected-direction (:entries artifact)
        display
        (if (= :backward direction)
          (vec (reverse selected-direction)) selected-direction)
        progress (:progress-anchor artifact)
        first-anchor (:anchor (first display))
        last-anchor (:anchor (last display))
        start-anchor
        (if (= :forward direction) (or first-anchor progress) progress)
        end-anchor
        (if (= :forward direction) progress (or last-anchor progress))
        prior? (boolean cursor-payload)]
    (context/cut-point! request-context
                        :authorization-relationship-page-render)
    {:data (mapv :relationship display)
     :page-info
     {:start-cursor
      (when start-anchor
        (issue-page-cursor client request-context page start-anchor))
      :end-cursor
      (when end-anchor
        (issue-page-cursor client request-context page end-anchor))
      :has-next-page?
      (if (= :forward direction) (:more? artifact) prior?)
      :has-previous-page?
      (if (= :forward direction) prior? (:more? artifact))
      :bounded? (boolean (:bounded? artifact))}
     :cached? (boolean cache-hit?)
     :cache-basis (when enabled? (page-provenance request-context))}))

(defn authorization-relationship-page-in-context
  [client request-context page cursor-payload]
  (let [aggregate-before (context/aggregate-counters request-context)
        prepared (prepare-authorization-scan! request-context page)
        proof (get-in prepared [:root :proof])
        proof-fingerprint (cursor/fingerprint proof)
        page (assoc page :dependency-proof proof
                    :dependency-proof-fingerprint proof-fingerprint)]
    (when cursor-payload
      (when-not (and (= (:native-revision cursor-payload)
                        (get-in (context/selection request-context) [:basis]))
                     (= (:schema-generation cursor-payload)
                        (context/schema-generation request-context))
                     (= (:dependency-proof-fingerprint cursor-payload)
                        proof-fingerprint))
        (fail! :eacl.pagination/invalid-cursor
               :cursor-snapshot-mismatch {})))
    (check-aggregate-state!
     (:aggregate-limits page) aggregate-before request-context 0 nil)
    (let [enabled? (cache-enabled? client (:request page))
          populate? (cache-population-enabled? client (:request page))
          cache (get-in client [::caches :continuation])
          key
          [:authorized-relationship-page
           (context/source-scope request-context)
           (get-in (context/selection request-context) [:basis])
           (context/schema-generation request-context)
           proof (:cursor-scope page) (:anchor cursor-payload)
           (get-in client [::operations :ordering-abi])]
          cached (when enabled? (local-cache/lookup! cache key))
          artifact
          (if (and cached (:found? cached))
            (:value cached)
            (do
              (when-not enabled? (local-cache/bypass! cache))
              (let [built
                    (execute-authorization-relationship-page!
                     client request-context page prepared
                     (:anchor cursor-payload) aggregate-before)]
                (if populate?
                  (local-cache/install! cache key built)
                  built))))]
      (render-authorization-relationship-page
       client request-context page cursor-payload artifact
       (and cached (:found? cached)) enabled?))))

(defn- discovery-types
  [page]
  (if (= :lookup-resources (:operation page))
    {:subject-type (get-in page [:subject :type])
     :resource-type (:result-type page)}
    {:subject-type (:result-type page)
     :resource-type (get-in page [:resource :type])}))

(defn- discovery-cursor-scope
  [client page]
  {:route :authorized-enumeration
   :operation (:operation page)
   :subject (:subject page)
   :resource (:resource page)
   :permission (:permission page)
   :result-type (:result-type page)
   :relationship-clause (:relationship-clause page)
   :direction (:direction page)
   :page-size (:page-size page)
   :aggregate-limits (:aggregate-limits page)
   :scalar-limits (get-in client [::options :scalar-limits])
   :evaluation :demand})

(defn- discovery-count-scope
  [client page]
  {:route :authorized-enumeration
   :operation (:operation page)
   :subject (:subject page)
   :resource (:resource page)
   :permission (:permission page)
   :result-type (:result-type page)
   :relationship-clause (:relationship-clause page)
   :count-limit (:count-limit page)
   :count-limit-supplied? (:count-limit-supplied? page)
   :aggregate-limits (:aggregate-limits page)
   :scalar-limits (get-in client [::options :scalar-limits])
   :evaluation :demand})

(defn- bound-discovery-cursor!
  [client page]
  (when-let [encoded (:cursor page)]
    (let [payload (decode-cursor! client encoded)
          expected-scope (::source-scope client)
          expected-order (get-in client [::operations :ordering-abi])]
      (when-not (and (= (:operation page) (:operation payload))
                     (= (:cursor-scope-fingerprint page)
                        (:query-fingerprint payload))
                     (= expected-scope (:source-scope payload))
                     (= expected-order (:ordering-abi payload)))
        (fail! :eacl.pagination/invalid-cursor
               :cursor-query-mismatch {}))
      payload)))

(defn- discovery-error
  "Remove candidate-sensitive data while preserving the typed failure."
  [error]
  (let [data (or (ex-data error) {})
        safe
        (apply dissoc data
               [:subject :resource :candidate :object :id :entity :entity-id
                :endpoint-eid :subject-eid :resource-eid :datom :prefix
                :counters :aggregate-counters :count :rejected-count])
        safe
        (if (= :candidates-examined (:limit-kind safe))
          (dissoc safe :actual)
          safe)]
    (ex-info (or (ex-message error) "EACL authorized discovery failed.")
             safe error)))

(defn- fixed-subject-denotation!
  [request-context plan subject-type subject-eid]
  (context/begin-demand! request-context)
  (let [attempt
        (try
          {:value
           (denotation/authorized-resource-eids!
            request-context plan subject-type subject-eid)
           :error nil}
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            {:value nil :error error}))
        error (:error attempt)]
    (if error
      (if (= :eacl.execution/resource-limit-exceeded
             (:type (ex-data error)))
        (do
          ;; Vectorized work is speculative. If its combined work crosses a
          ;; scalar limit, discard it and preserve the exact per-candidate V8
          ;; behavior rather than exposing a false aggregate failure.
          (context/abort-demand! request-context)
          nil)
        (do
          (context/end-demand! request-context)
          (throw error)))
      (do
        (context/end-demand! request-context)
        (:value attempt)))))

(defn- prepare-discovery!
  [request-context page]
  (let [{:keys [subject-type resource-type]} (discovery-types page)
        root
        (discovery/validate-root!
         request-context subject-type resource-type (:permission page)
         (:operation page))
        fixed-object
        (if (= :lookup-resources (:operation page))
          (:subject page) (:resource page))
        fixed-eid
        (indexed/object-eid! request-context (:id fixed-object))
        direct
        (discovery/prepare-direct-clause!
         request-context (:operation page) (:result-type page)
         (:relationship-clause page))
        denotation-mode
        (when (and (= :lookup-resources (:operation page)) fixed-eid)
          (cond
            (denotation/eligible? request-context (:plan root)) :complete
            (denotation/empty-proof-eligible?
             request-context (:plan root)) :empty-only
            :else nil))]
    {:root root :fixed-object fixed-object :fixed-eid fixed-eid
     :direct direct :authorized-eids nil :denotation? false
     :denotation-mode denotation-mode
     :empty? (or (nil? fixed-eid)
                 (and direct (nil? (:anchor-eid direct))))}))

(defn- prepare-denotation!
  [request-context prepared]
  (if-not (:denotation-mode prepared)
    prepared
    (let [fixed-object (:fixed-object prepared)
          authorized-eids
          (fixed-subject-denotation!
           request-context (get-in prepared [:root :plan])
           (:type fixed-object) (:fixed-eid prepared))]
      (if (or (nil? authorized-eids)
              (and (= :empty-only (:denotation-mode prepared))
                   (seq authorized-eids)))
        prepared
        (assoc prepared :authorized-eids authorized-eids
               :denotation? true)))))

(defn- prepare-discovery-proof!
  "Attach the relation-stamp proof only when a scalar fallback, external
  cursor, or non-exact reuse key actually needs it. Exact-basis continuation
  and count keys already select one immutable database value."
  [request-context prepared]
  (if (get-in prepared [:root :proof])
    prepared
    (assoc-in
     prepared [:root :proof]
     (sealed-plan/dependency-proof!
      request-context (get-in prepared [:root :plan])))))

(defn- discovery-step!
  [client request-context page prepared bound authorize?]
  (context/begin-demand! request-context)
  (let [attempt
        (try
          (let [candidate
                (discovery/next-object!
                 request-context (:result-type page) (:direction page) bound)]
            (if-not candidate
              {:value {:candidate nil} :error nil}
              (do
                (context/record! request-context :candidates-examined)
                (let [direct?
                      (discovery/direct-clause-match!
                       request-context (:direct prepared) (:eid candidate))
                      object (:object candidate)
                      subject
                      (if (= :lookup-resources (:operation page))
                        (:fixed-object prepared) object)
                      resource
                      (if (= :lookup-resources (:operation page))
                        object (:fixed-object prepared))
                      subject-eid
                      (if (= :lookup-resources (:operation page))
                        (:fixed-eid prepared) (:eid candidate))
                      resource-eid
                      (if (= :lookup-resources (:operation page))
                        (:eid candidate) (:fixed-eid prepared))
                      allowed?
                      (and direct?
                           (or (not authorize?)
                               (if (:denotation? prepared)
                                 (contains? (:authorized-eids prepared)
                                            resource-eid)
                                 (:allowed?
                                  (render-point
                                   request-context
                                   (discovery/prepared-candidate
                                    request-context (:root prepared)
                                    (:operation page) subject resource
                                    subject-eid resource-eid)
                                   client (:request page))))))]
                  {:value
                   {:candidate candidate
                    :accepted? (boolean allowed?)}
                   :error nil}))))
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            {:value nil :error error}))
        _ (context/end-demand! request-context)]
    (if-let [error (:error attempt)]
      (throw (discovery-error error))
      (:value attempt))))

(defn- discovery-more?!
  [request-context page bound]
  (context/begin-demand! request-context)
  (let [attempt
        (try
          {:value
           (boolean
            (discovery/next-object!
             request-context (:result-type page) (:direction page) bound))
           :error nil}
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            {:value nil :error error}))
        _ (context/end-demand! request-context)]
    (if-let [error (:error attempt)]
      (throw (discovery-error error))
      (:value attempt))))

(defn- discovery-candidate-window!
  [request-context page bound limit]
  (context/begin-demand! request-context)
  (let [attempt
        (try
          {:value
           (discovery/candidate-window!
            request-context (:result-type page) (:direction page) bound limit)
           :error nil}
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            {:value nil :error error}))
        _ (context/end-demand! request-context)]
    (if-let [error (:error attempt)]
      (throw (discovery-error error))
      (:value attempt))))

(defn- aggregate-values
  [aggregate-before request-context output-units]
  (batch/aggregate-counters
   aggregate-before (context/aggregate-counters request-context)
   output-units))

(def ^:private aggregate-limit-pairs
  [[:max-commands :commands]
   [:max-transitions :transitions]
   [:max-fetched-values :fetched-values]
   [:max-candidates-examined :candidates-examined]
   [:max-probes :probes]
   [:max-output-units :output-units]
   [:max-allocation-proxy :allocation-proxy]
   [:max-publication-attempts :publication-attempts]])

(defn- aggregate-counter-actual
  [aggregate-before request-context counter output-units]
  (case counter
    :output-units output-units
    :publication-attempts
    (- (context/aggregate-counter-value
        request-context :completed-answer-publications)
       (:completed-answer-publications aggregate-before))
    :allocation-proxy
    (+ output-units
       (- (context/aggregate-counter-value request-context :allocation-proxy)
          (:allocation-proxy aggregate-before)))
    (- (context/aggregate-counter-value request-context counter)
       (get aggregate-before counter))))

(defn- check-aggregate-state!
  "Check the successful hot path without allocating complete counter maps."
  [limits aggregate-before request-context output-units demand-index]
  (loop [position 0]
    (when (< position (count aggregate-limit-pairs))
      (let [[limit-key counter] (nth aggregate-limit-pairs position)
            actual
            (aggregate-counter-actual
             aggregate-before request-context counter output-units)]
        (if (> actual (get limits limit-key))
          ;; Preserve the public failure's complete aggregate counter payload.
          (batch/check-aggregate-limits!
           limits
           (aggregate-values aggregate-before request-context output-units)
           demand-index)
          (recur (inc position))))))
  nil)

(defn- process-denotation-candidate-batch!
  [request-context page prepared aggregate-before initial candidates]
  (loop [remaining (seq candidates)
         progress (:progress initial)
         examined (:examined initial)
         accepted (:accepted initial)]
    (if-not remaining
      {:progress progress :examined examined :accepted accepted}
      (let [candidate (first remaining)
            _ (context/record! request-context :candidates-examined)
            next-examined (inc examined)
            accepted?
            (contains? (:authorized-eids prepared) (:eid candidate))
            next-accepted
            (if accepted?
              (conj accepted
                    {:object (:object candidate) :anchor (:anchor candidate)})
              accepted)
            output-units
            (min (count next-accepted) (:page-size page))]
        (check-aggregate-state!
         (:aggregate-limits page) aggregate-before request-context
         output-units nil)
        (if (> (count next-accepted) (:page-size page))
          {:result
           {:entries (vec (take (:page-size page) next-accepted))
            ;; Reconsider the accepted sentinel on the next page.
            :progress-anchor progress
            :more? true :bounded? false}}
          (recur (next remaining) (:anchor candidate)
                 next-examined next-accepted))))))

(defn- execute-denotation-catalog-page!
  [request-context page prepared initial-bound aggregate-before window]
  (loop [state {:progress initial-bound :examined 0 :accepted []}]
    (context/cut-point! request-context :discovery-candidate-schedule)
    (if (= (:examined state) window)
      (let [more? (discovery-more?!
                   request-context page (:progress state))]
        (check-aggregate-state!
         (:aggregate-limits page) aggregate-before request-context
         (count (:accepted state)) nil)
        {:entries (:accepted state) :progress-anchor (:progress state)
         :more? more? :bounded? more?})
      (let [batch
            (discovery-candidate-window!
             request-context page (:progress state)
             (min (- window (:examined state)) (inc (:page-size page))))
            processed
            (process-denotation-candidate-batch!
             request-context page prepared aggregate-before state
             (:candidates batch))]
        (if-let [result (:result processed)]
          result
          (if (:exhausted? batch)
            {:entries (:accepted processed)
             :progress-anchor (:progress processed)
             :more? false :bounded? false}
            (recur processed)))))))

(defn- execute-discovery-page!
  [client request-context page prepared initial-bound]
  (let [window (get-in page [:aggregate-limits :candidate-window])
        aggregate-before (:aggregate-before page)]
    (if (or (:empty? prepared)
            (and (:denotation? prepared)
                 (empty? (:authorized-eids prepared))))
      {:entries [] :progress-anchor initial-bound
       :more? false :bounded? false}
      (if (and (:denotation? prepared)
               (nil? (:direct prepared))
               (discovery/typed-candidate-catalog? request-context))
        ;; Complete denotation membership is scalar and order-independent, so
        ;; read the already-certified typed AVET order in bounded windows. The
        ;; logical loop below retains the exact candidate counter, accepted
        ;; sentinel, progress anchor, and aggregate-limit cut points.
        (execute-denotation-catalog-page!
         request-context page prepared initial-bound aggregate-before window)
        (loop [bound initial-bound
               examined 0
               accepted []]
          (context/cut-point! request-context :discovery-candidate-schedule)
          (cond
            (= examined window)
            (let [more? (discovery-more?! request-context page bound)]
              (check-aggregate-state!
               (:aggregate-limits page) aggregate-before request-context
               (count accepted) nil)
              {:entries accepted :progress-anchor bound
               :more? more? :bounded? more?})

            :else
            (let [step
                  (discovery-step!
                   client request-context page prepared bound true)
                  candidate (:candidate step)]
              (if-not candidate
                {:entries accepted :progress-anchor bound
                 :more? false :bounded? false}
                (let [next-examined (inc examined)
                      accepted? (:accepted? step)
                      next-accepted
                      (if accepted?
                        (conj accepted
                              {:object (:object candidate)
                               :anchor (:anchor candidate)})
                        accepted)
                      output-units
                      (min (count next-accepted) (:page-size page))]
                  (check-aggregate-state!
                   (:aggregate-limits page) aggregate-before request-context
                   output-units nil)
                  (if (> (count next-accepted) (:page-size page))
                    ;; The accepted sentinel must be reconsidered on the next
                    ;; page, so resume after the candidate preceding it.
                    {:entries (vec (take (:page-size page) next-accepted))
                     :progress-anchor bound
                     :more? true :bounded? false}
                    (recur (:anchor candidate) next-examined
                           next-accepted)))))))))))

(defn- issue-discovery-cursor
  [client request-context page proof-fingerprint anchor]
  (issue-cursor-cached
   client
   {:operation (:operation page)
    :query-fingerprint (:cursor-scope-fingerprint page)
    :anchor anchor
    :snapshot-token
    (get-in (context/selection request-context) [:causal-token])
    :source-scope (context/source-scope request-context)
    :native-revision (get-in (context/selection request-context) [:basis])
    :schema-generation (context/schema-generation request-context)
    :ordering-abi (get-in client [::operations :ordering-abi])
    :dependency-proof-fingerprint proof-fingerprint}))

(defn- render-discovery-page
  [client request-context page cursor-payload artifact cache-hit? enabled?]
  (let [direction (:direction page)
        selected-direction (:entries artifact)
        display
        (if (= :backward direction)
          (vec (reverse selected-direction)) selected-direction)
        progress (:progress-anchor artifact)
        first-anchor (:anchor (first display))
        last-anchor (:anchor (last display))
        start-anchor
        (if (= :forward direction)
          (or first-anchor progress) progress)
        end-anchor
        (if (= :forward direction)
          progress (or last-anchor progress))
        prior? (boolean cursor-payload)]
    (context/cut-point! request-context :discovery-page-render)
    {:data (mapv :object display)
     :page-info
     {:start-cursor
      (when start-anchor
        (issue-discovery-cursor
         client request-context page (:proof-fingerprint artifact)
         start-anchor))
      :end-cursor
      (when end-anchor
        (issue-discovery-cursor
         client request-context page (:proof-fingerprint artifact)
         end-anchor))
      :has-next-page?
      (if (= :forward direction) (:more? artifact) prior?)
      :has-previous-page?
      (if (= :forward direction) prior? (:more? artifact))
      :bounded? (boolean (:bounded? artifact))}
     :cached? (boolean cache-hit?)
     :cache-basis (when enabled? (page-provenance request-context))}))

(defn- lookup-in-context
  [client request-context page cursor-payload]
  (let [aggregate-before (context/aggregate-counters request-context)
        prepared (prepare-discovery! request-context page)
        plan-fingerprint (get-in prepared [:root :plan :fingerprint])]
    (when (and cursor-payload
               (not (and (= (:native-revision cursor-payload)
                            (get-in (context/selection request-context)
                                    [:basis]))
                         (= (:schema-generation cursor-payload)
                            (context/schema-generation request-context)))))
      (fail! :eacl.pagination/invalid-cursor
             :cursor-snapshot-mismatch {}))
    (check-aggregate-state!
     (:aggregate-limits page) aggregate-before request-context 0 nil)
    (let [enabled? (cache-enabled? client (:request page))
          populate? (cache-population-enabled? client (:request page))
          cache (get-in client [::caches :continuation])
          key
          [:authorized-discovery-page
           (context/source-scope request-context)
           (get-in (context/selection request-context) [:basis])
           (context/schema-generation request-context)
           plan-fingerprint (:cursor-scope page) (:anchor cursor-payload)
           (get-in client [::operations :ordering-abi])]
          cached (when enabled? (local-cache/lookup! cache key))
          artifact
          (if (and cached (:found? cached))
            (:value cached)
            (do
              (when-not enabled? (local-cache/bypass! cache))
              (let [prepared
                    (if cursor-payload
                      (prepare-discovery-proof! request-context prepared)
                      prepared)
                    proof-fingerprint
                    (when cursor-payload
                      (cursor/fingerprint (get-in prepared [:root :proof])))
                    _
                    (when (and cursor-payload
                               (not= (:dependency-proof-fingerprint
                                      cursor-payload)
                                     proof-fingerprint))
                      (fail! :eacl.pagination/invalid-cursor
                             :cursor-snapshot-mismatch {}))
                    prepared (prepare-denotation! request-context prepared)
                    prepared
                    (if (:denotation? prepared)
                      prepared
                      (prepare-discovery-proof! request-context prepared))
                    built
                    (execute-discovery-page!
                     client request-context
                     (assoc page :aggregate-before aggregate-before) prepared
                     (:anchor cursor-payload))
                    cursor-producing?
                    (or (:progress-anchor built) (seq (:entries built)))
                    proof-fingerprint
                    (if (and cursor-producing? (nil? proof-fingerprint))
                      (cursor/fingerprint
                       (get-in (prepare-discovery-proof!
                                request-context prepared)
                               [:root :proof]))
                      proof-fingerprint)
                    built (assoc built :proof-fingerprint proof-fingerprint)]
                (if populate?
                  (local-cache/install! cache key built)
                  built))))]
      (when (and cursor-payload
                 (not= (:dependency-proof-fingerprint cursor-payload)
                       (:proof-fingerprint artifact)))
        (fail! :eacl.pagination/invalid-cursor
               :cursor-snapshot-mismatch {}))
      (render-discovery-page
       client request-context page cursor-payload artifact
       (and cached (:found? cached)) enabled?))))

(defn lookup
  [target operation raw-query]
  (let [target (require-target! target)
        client (target-client target)
        page
        (authorization-filters/normalize!
         operation raw-query (get-in client [::options :aggregate-limits])
         false)
        page (assoc page :cursor-scope (discovery-cursor-scope client page))
        page (assoc page :cursor-scope-fingerprint
                    (cursor/fingerprint (:cursor-scope page)))
        contract
        (if (snapshot-view? target)
          (context/contract (::context target))
          (public-contract client operation (:request page)))
        _ (execution/check! contract :before-cursor-decode)
        cursor-payload (bound-discovery-cursor! client page)
        _ (execution/check! contract :after-cursor-decode)]
    (when (and cursor-payload
               (some? (get-in page [:request :consistency])))
      (fail! :eacl.pagination/invalid-cursor
             :cursor-consistency-conflict {}))
    (if (snapshot-view? target)
      (let [fixed (fixed-request! target (:request page))]
        (try
          (lookup-in-context client (::context target)
                             (assoc page :request fixed) cursor-payload)
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            (throw (discovery-error error)))))
      (let [descriptor
            (if cursor-payload
              {:mode :at-exact-snapshot
               :token (:snapshot-token cursor-payload)}
              (consistency-descriptor
               (get-in page [:request :consistency])))
            request-context (make-request-context client descriptor contract)]
        (try
          (let [result
                (lookup-in-context client request-context page cursor-payload)]
            (context/close! request-context)
            result)
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            (close-after-error!
             request-context (discovery-error error))))))))

(defn lookup-resources
  [target query]
  (lookup target :lookup-resources query))

(defn lookup-subjects
  [target query]
  (lookup target :lookup-subjects query))

(defn- execute-discovery-count!
  [client request-context page prepared]
  (let [aggregate-before (:aggregate-before page)
        supplied? (:count-limit-supplied? page)
        limit (:count-limit page)
        target (when supplied? (inc limit))]
    (cond
      (or (:empty? prepared)
          (and (:denotation? prepared)
               (empty? (:authorized-eids prepared))))
      (cond-> {:count 0 :limit limit}
        supplied? (assoc :truncated? false))

      ;; A complete fixed-subject denotation is already the exact resource
      ;; answer. With no direct relationship filter, counting that set avoids
      ;; a second traversal over the candidate catalog and cannot change
      ;; ordering, because count has no ordering surface.
      (and (= :lookup-resources (:operation page))
           (:denotation? prepared)
           (nil? (:direct prepared)))
      (let [exact
            (discovery/count-authorized-candidate-eids!
             request-context (:result-type page)
             (:authorized-eids prepared) target
             (fn [matched]
               (context/record! request-context :candidates-examined)
               (check-aggregate-state!
                (:aggregate-limits page) aggregate-before request-context
                (if supplied? (min matched limit) matched) nil)))
            output-units (if supplied? (min exact limit) exact)]
        (if (and supplied? (> exact limit))
          {:count limit :limit limit :truncated? true}
          (cond-> {:count exact :limit limit}
            supplied? (assoc :truncated? false))))

      :else
      (loop [bound nil
             discovered 0]
        (context/cut-point! request-context :discovery-count-schedule)
        (let [step
              (discovery-step!
               client request-context page prepared bound true)
              candidate (:candidate step)]
          (if-not candidate
            (cond-> {:count discovered :limit limit}
              supplied? (assoc :truncated? false))
            (let [next-count (if (:accepted? step)
                               (inc discovered) discovered)
                  output-units
                  (if supplied? (min next-count limit) next-count)]
              (check-aggregate-state!
               (:aggregate-limits page) aggregate-before request-context
               output-units nil)
              (if (and target (>= next-count target))
                {:count limit :limit limit :truncated? true}
                (recur (:anchor candidate) next-count)))))))))

(defn- count-in-context
  [client request-context page]
  (let [aggregate-before (context/aggregate-counters request-context)
        prepared (prepare-discovery! request-context page)
        plan-fingerprint (get-in prepared [:root :plan :fingerprint])
        enabled? (cache-enabled? client (:request page))
        populate? (cache-population-enabled? client (:request page))
        cache (get-in client [::caches :answer])
        scope (discovery-count-scope client page)
        key
        [:authorized-discovery-count
         (context/source-scope request-context)
         (get-in (context/selection request-context) [:basis])
         (context/schema-generation request-context)
         plan-fingerprint scope (get-in client [::operations :ordering-abi])]
        cached (when enabled? (local-cache/lookup! cache key))
        value
        (if (and cached (:found? cached))
          (:value cached)
          (do
            (when-not enabled? (local-cache/bypass! cache))
            (let [prepared (prepare-denotation! request-context prepared)
                  prepared
                  (if (:denotation? prepared)
                    prepared
                    (prepare-discovery-proof! request-context prepared))
                  built
                  (execute-discovery-count!
                   client request-context
                   (assoc page :aggregate-before aggregate-before) prepared)]
              (if populate?
                (local-cache/install! cache key built)
                built))))]
    (assoc value
           :cached? (boolean (and cached (:found? cached)))
           :cache-basis (when enabled? (page-provenance request-context)))))

(defn count-discovery
  [target operation raw-query]
  (let [target (require-target! target)
        client (target-client target)
        public-operation
        (if (= :lookup-resources operation)
          :count-resources
          :count-subjects)
        page
        (authorization-filters/normalize!
         operation raw-query (get-in client [::options :aggregate-limits])
         true)]
    (if (snapshot-view? target)
      (try
        (count-in-context
         client (::context target)
         (assoc page :request (fixed-request! target (:request page))))
        (catch #?(:jank cpp/jank.runtime.object_ref
                  :clj Throwable) error
          (throw (discovery-error error))))
      (let [contract (public-contract client public-operation (:request page))
            descriptor
            (consistency-descriptor (get-in page [:request :consistency]))
            _ (execution/check! contract :before-public-snapshot-selection)
            request-context (make-request-context client descriptor contract)]
        (try
          (let [result (count-in-context client request-context page)]
            (context/close! request-context)
            result)
          (catch #?(:jank cpp/jank.runtime.object_ref
                    :clj Throwable) error
            (close-after-error!
             request-context (discovery-error error))))))))

(defn count-resources
  [target query]
  (count-discovery target :lookup-resources query))

(defn count-subjects
  [target query]
  (count-discovery target :lookup-subjects query))

(defn with-snapshot
  [target consistency request-options callback]
  (let [client (require-client! target)]
    (closed-map! request-options snapshot-request-option-keys
                 :eacl/invalid-snapshot-request-options
                 :invalid-snapshot-request-options)
    (when-not (fn? callback)
      (fail! :eacl/invalid-snapshot-callback
             :snapshot-callback-not-function {}))
    (let [contract (public-contract client :with-snapshot request-options)
          descriptor (consistency-descriptor consistency)
          _ (execution/check! contract :before-public-snapshot-selection)
          request-context (make-request-context client descriptor contract)
          view {::kind view-kind
                ::version view-version
                ::client client
                ::context request-context}]
      (try
        (context/cut-point! request-context :before-snapshot-callback)
        (let [result (callback view)]
          (context/cut-point! request-context :after-snapshot-callback)
          (context/close! request-context)
          result)
        (catch #?(:jank cpp/jank.runtime.object_ref
                  :clj Throwable) error
          (close-after-error! request-context error))))))

(defn expire-cache!
  ([client]
   (expire-cache! client nil))
  ([client lifecycle]
   (let [client (require-client! client)
         current (::source-scope client)]
     (when (and lifecycle
                (not (or (= lifecycle (:lifecycle-id current))
                         (= lifecycle current))))
       (fail! :eacl/invalid-request :foreign-cache-lifecycle
              {:source-lifecycle lifecycle}))
     (let [plan-cleared
           (sealed-plan/clear-plan-cache! (get-in client [::caches :plan]))
           cleared
           (reduce
            (fn [result name]
              (assoc result name
                     (local-cache/clear! (get-in client [::caches name]))))
            {:plan plan-cleared} cache-names)]
       {:source-scope current :cleared cleared}))))

(defn cache-stats
  [client]
  (let [client (require-client! client)]
    {:source-scope (::source-scope client)
     :enabled? (get-in client [::options :cache :enabled?])
     :plan (sealed-plan/plan-cache-stats
            (get-in client [::caches :plan]))
     :schema (local-cache/stats (get-in client [::caches :schema]))
     :answer (local-cache/stats (get-in client [::caches :answer]))
     :continuation
     (local-cache/stats (get-in client [::caches :continuation]))
     :page-navigation
     (local-cache/stats (get-in client [::caches :page-navigation]))
     :cursor-codec
     (local-cache/stats (get-in client [::caches :cursor-codec]))}))
