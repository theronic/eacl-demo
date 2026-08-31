(ns eacl-demo.datalevin-memory.lifecycle
  "Fail-closed control-plane lifecycle validation for the future Datalevin
  Lambda. This namespace deliberately has no Datalevin dependency: the native
  runtime remains blocked until the maintained fork and AL2023 arm64 closure
  are published and qualified."
  (:require [eacl-demo.contracts.build-identity :as build-identity])
  (:import (java.math BigInteger)
           (java.nio.charset StandardCharsets)
           (java.security MessageDigest)))

(def maximum-exact-integer 9007199254740991)
(def maximum-state-bytes 16384)

(def state-keys
  #{:schema :profileId :stateKind :demoSha :eaclSha :artifactSha256
    :deploymentId :runtime :architecture :storageMode :snapshotStrategy
    :maximumConcurrency :dataManifestSha256 :bootstrapPlanSha256
    :sourceLifecycle :nativeSourceId :revisionWatermark
    :logicalResourceCount :mutationPolicy})

(def expected-keys
  #{:schema :objectSha256 :demoSha :eaclSha :artifactSha256 :deploymentId
    :runtime :architecture :dataManifestSha256 :bootstrapPlanSha256
    :sourceLifecycle :nativeSourceId :revisionWatermark :storageMode
    :snapshotStrategy :maximumConcurrency :runtimeStateBucket
    :runtimeStateObjectKey :runtimeStateObjectVersion})

(def bootstrap-observation-keys
  #{:schema :demoSha :eaclSha :artifactSha256 :deploymentId :runtime :architecture
    :storageMode :snapshotStrategy :maximumConcurrency :dataManifestSha256
    :bootstrapPlanSha256 :sourceLifecycle :nativeSourceId :revisionWatermark
    :logicalResourceCount :schemaFrozen
    :relationsFrozen :publicWriter :activeReadSnapshots :nativeInMemory
    :localDatabaseCount :remoteServer :haMode :wal :efsMounted
    :durableServingPath})

(def immutable-binding-fields
  [:schema :demoSha :eaclSha :artifactSha256 :deploymentId :runtime
   :architecture :storageMode :snapshotStrategy :maximumConcurrency
   :dataManifestSha256 :bootstrapPlanSha256 :sourceLifecycle :nativeSourceId
   :revisionWatermark])

(def transition-keys
  #{:action :current :candidate :rollbackTarget})

(def transition-actions
  #{"concurrent-environment" "restore" "rebuild" "deployment"
    "lifecycle-rotation" "rollback"})

(def rotated-identity-fields
  #{:deploymentId :sourceLifecycle :nativeSourceId})

(def stable-source-fields
  (vec (sort (remove rotated-identity-fields state-keys))))

(def allowed-snapshot-strategies
  #{"after-restore-rebuild" "pre-checkpoint-quiesced"})

(def required-environment
  {:schema "EACL_DATALEVIN_RUNTIME_STATE_SCHEMA"
   :objectSha256 "EACL_DATALEVIN_RUNTIME_STATE_SHA256"
   :demoSha "EACL_DEMO_SHA"
   :artifactSha256 "EACL_ARTIFACT_SHA256"
   :deploymentId "EACL_DEPLOYMENT_ID"
   :runtime "EACL_RUNTIME"
   :architecture "EACL_ARCHITECTURE"
   :dataManifestSha256 "EACL_DATA_MANIFEST_SHA256"
   :bootstrapPlanSha256 "EACL_DATALEVIN_BOOTSTRAP_PLAN_SHA256"
   :sourceLifecycle "EACL_SOURCE_LIFECYCLE_ID"
   :nativeSourceId "EACL_DATALEVIN_NATIVE_SOURCE_ID"
   :revisionWatermark "EACL_DATALEVIN_REVISION_WATERMARK"
   :runtimeStateBucket "EACL_DATALEVIN_RUNTIME_STATE_BUCKET"
   :runtimeStateObjectKey "EACL_DATALEVIN_RUNTIME_STATE_KEY"
   :runtimeStateObjectVersion "EACL_DATALEVIN_RUNTIME_STATE_VERSION"
   :storageMode "EACL_DATALEVIN_STORAGE_MODE"
   :snapshotStrategy "EACL_SNAPSHOT_STRATEGY"
   :maximumConcurrency "EACL_MAXIMUM_CONCURRENCY"})

(def ^:private byte-array-class (Class/forName "[B"))
(def ^:private sha256-pattern #"[0-9a-f]{64}")
(def ^:private git-sha-pattern #"[0-9a-f]{40}")
(def ^:private deployment-id-pattern #"[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}")
(def ^:private uuid-pattern
  #"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")

(defn- fail!
  ([reason] (fail! reason nil))
  ([reason safe-data]
   (throw
    (ex-info
     "Datalevin runtime lifecycle validation failed."
     (merge {:type :eacl-demo.datalevin/invalid-lifecycle-state
             :eacl/error :eacl-demo.datalevin/invalid-lifecycle-state
             :reason reason}
            safe-data)))))

(defn- exact-keys!
  [value expected reason]
  (when-not (map? value)
    (fail! reason {:failure :not-a-map}))
  (let [actual (set (keys value))]
    (when-not (= expected actual)
      (fail! reason
             {:missing-keys (vec (sort (remove actual expected)))
              :unexpected-keys (vec (sort (remove expected actual)))})))
  value)

(defn- sha256?
  [value]
  (and (string? value) (boolean (re-matches sha256-pattern value))))

(defn- git-sha?
  [value]
  (and (string? value) (boolean (re-matches git-sha-pattern value))))

(defn- deployment-id?
  [value]
  (and (string? value)
       (boolean (re-matches deployment-id-pattern value))))

(defn- uuid-string?
  [value]
  (and (string? value) (boolean (re-matches uuid-pattern value))))

(defn- bounded-string?
  [minimum maximum value]
  (and (string? value)
       (<= minimum (count value) maximum)
       (not (re-find #"[\x00-\x1f\x7f]" value))))

(defn- exact-natural?
  [value]
  (and (integer? value)
       (not (neg? value))
       (<= value maximum-exact-integer)))

(defn- require-field!
  [predicate field value]
  (when-not (predicate value)
    (fail! :invalid-field {:field field}))
  value)

(defn- require-expected-field!
  [predicate field value]
  (when-not (predicate value)
    (fail! :invalid-expected-state {:field field}))
  value)

(defn- parse-natural!
  [field value]
  (when-not (and (string? value) (boolean (re-matches #"(?:0|[1-9][0-9]{0,15})" value)))
    (fail! :invalid-environment {:field field}))
  (let [parsed
        (try
          (Long/parseLong value)
          (catch NumberFormatException _
            (fail! :invalid-environment {:field field})))]
    (require-field! exact-natural? field parsed)))

(defn sha256-hex
  "Return the lowercase SHA-256 digest of a String or byte array."
  [value]
  (let [bytes
        (cond
          (string? value) (.getBytes ^String value StandardCharsets/UTF_8)
          (instance? byte-array-class value) value
          :else (fail! :invalid-state-bytes))
        digest (.digest (MessageDigest/getInstance "SHA-256") bytes)]
    (format "%064x" (BigInteger. 1 digest))))

(defn- validate-expected!
  [expected]
  (exact-keys! expected expected-keys :invalid-expected-state)
  (when-not (= "eacl-demo.datalevin-lifecycle-state.v1" (:schema expected))
    (fail! :invalid-expected-state {:field :schema}))
  (doseq [field [:objectSha256 :artifactSha256 :dataManifestSha256
                 :bootstrapPlanSha256]]
    (require-expected-field! sha256? field (get expected field)))
  (doseq [field [:demoSha :eaclSha]]
    (require-expected-field! git-sha? field (get expected field)))
  (require-expected-field! deployment-id? :deploymentId
                           (:deploymentId expected))
  (when-not (= "java25" (:runtime expected))
    (fail! :invalid-expected-state {:field :runtime}))
  (when-not (= "arm64" (:architecture expected))
    (fail! :invalid-expected-state {:field :architecture}))
  (doseq [field [:sourceLifecycle :nativeSourceId]]
    (require-expected-field! uuid-string? field (get expected field)))
  (when (= (:sourceLifecycle expected) (:nativeSourceId expected))
    (fail! :invalid-expected-state {:field :nativeSourceId
                                    :failure :identity-reuse}))
  (require-expected-field! exact-natural? :revisionWatermark
                           (:revisionWatermark expected))
  (when-not (= "embedded" (:storageMode expected))
    (fail! :invalid-expected-state {:field :storageMode}))
  (when-not (contains? allowed-snapshot-strategies
                       (:snapshotStrategy expected))
    (fail! :invalid-expected-state {:field :snapshotStrategy}))
  (when-not (= 1 (:maximumConcurrency expected))
    (fail! :invalid-expected-state {:field :maximumConcurrency}))
  (when-not (and (string? (:runtimeStateBucket expected))
                 (boolean
                  (re-matches
                   #"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]"
                   (:runtimeStateBucket expected))))
    (fail! :invalid-expected-state {:field :runtimeStateBucket}))
  (when-not (and (string? (:runtimeStateObjectKey expected))
                 (boolean
                  (re-matches
                   #"runtime-state/datalevin-memory/[0-9a-f]{64}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json"
                   (:runtimeStateObjectKey expected))))
    (fail! :invalid-expected-state {:field :runtimeStateObjectKey}))
  (when-not
   (= (str "runtime-state/datalevin-memory/"
           (:dataManifestSha256 expected) "/"
           (:sourceLifecycle expected) ".json")
      (:runtimeStateObjectKey expected))
    (fail! :invalid-expected-state {:field :runtimeStateObjectKey
                                    :failure :identity-mismatch}))
  (when-not (bounded-string? 1 1024 (:runtimeStateObjectVersion expected))
    (fail! :invalid-expected-state {:field :runtimeStateObjectVersion}))
  expected)

(defn expected-state-from-environment!
  "Read the exact lifecycle bindings from an injected environment map.
  Unrelated process variables are ignored, but every required binding is
  mandatory and strictly validated."
  [environment]
  (when-not (map? environment)
    (fail! :invalid-environment {:failure :not-a-map}))
  (let [baked-eacl-sha (build-identity/eacl-sha)
        values
        (assoc
         (into {}
               (map
                (fn [[field name]]
                  (let [value (get environment name)]
                    (when-not (string? value)
                      (fail! :missing-environment {:field field}))
                    [field value])))
               required-environment)
         :eaclSha baked-eacl-sha)
        expected
        (-> values
            (update :revisionWatermark
                    #(parse-natural! :revisionWatermark %))
            (update :maximumConcurrency
                    #(parse-natural! :maximumConcurrency %)))]
    (try
      (validate-expected! expected)
      (catch clojure.lang.ExceptionInfo error
        (fail! :invalid-environment
               (select-keys (ex-data error) [:field :failure]))))))

(defn validate-state!
  "Validate the decoded, keyword-keyed lifecycle JSON value. No unknown field
  is accepted, and validation errors retain only closed field identities."
  [state]
  (exact-keys! state state-keys :invalid-state-shape)
  (when-not (= "eacl-demo.datalevin-lifecycle-state.v1" (:schema state))
    (fail! :invalid-field {:field :schema}))
  (when-not (= "datalevin-memory" (:profileId state))
    (fail! :invalid-field {:field :profileId}))
  (when-not (= "external-control-plane-metadata" (:stateKind state))
    (fail! :invalid-field {:field :stateKind}))
  (doseq [field [:artifactSha256 :dataManifestSha256 :bootstrapPlanSha256]]
    (require-field! sha256? field (get state field)))
  (doseq [field [:demoSha :eaclSha]]
    (require-field! git-sha? field (get state field)))
  (require-field! deployment-id? :deploymentId (:deploymentId state))
  (when-not (= "java25" (:runtime state))
    (fail! :invalid-field {:field :runtime}))
  (when-not (= "arm64" (:architecture state))
    (fail! :invalid-field {:field :architecture}))
  (when-not (= "embedded" (:storageMode state))
    (fail! :invalid-field {:field :storageMode}))
  (when-not (contains? allowed-snapshot-strategies (:snapshotStrategy state))
    (fail! :invalid-field {:field :snapshotStrategy}))
  (when-not (= 1 (:maximumConcurrency state))
    (fail! :invalid-field {:field :maximumConcurrency}))
  (doseq [field [:sourceLifecycle :nativeSourceId]]
    (require-field! uuid-string? field (get state field)))
  (when (= (:sourceLifecycle state) (:nativeSourceId state))
    (fail! :invalid-field {:field :nativeSourceId
                           :failure :identity-reuse}))
  (require-field! exact-natural? :revisionWatermark
                  (:revisionWatermark state))
  (when-not (= 10000 (:logicalResourceCount state))
    (fail! :invalid-field {:field :logicalResourceCount}))
  (when-not (= "immutable-after-publication" (:mutationPolicy state))
    (fail! :invalid-field {:field :mutationPolicy}))
  state)

(defn- require-equal-fields!
  [left right fields reason]
  (doseq [field fields]
    (when-not (= (get left field) (get right field))
      (fail! reason {:field field}))))

(defn- require-rotated-identities!
  [candidate forbidden-states]
  (doseq [field rotated-identity-fields
          forbidden forbidden-states]
    (when (= (get candidate field) (get forbidden field))
      (fail! :lifecycle-identity-reuse {:field field}))))

(defn validate-transition!
  "Validate one closed lifecycle transition before a Lambda version is built
  or selected. Concurrent environments and restores must reuse one exact
  immutable state. Every new deployment/rebuild rotates all deployment-bound
  identities. Rollback must either select the exact prior state or create a
  fresh rotated identity over that exact prior source."
  [transition]
  (exact-keys! transition transition-keys :invalid-transition)
  (let [{:keys [action current candidate rollbackTarget]} transition]
    (when-not (contains? transition-actions action)
      (fail! :invalid-transition {:field :action}))
    (validate-state! current)
    (validate-state! candidate)
    (if (= "rollback" action)
      (do
        (when (nil? rollbackTarget)
          (fail! :invalid-transition {:field :rollbackTarget}))
        (validate-state! rollbackTarget))
      (when-not (nil? rollbackTarget)
        (fail! :invalid-transition {:field :rollbackTarget})))
    (when (and (= (:sourceLifecycle current) (:sourceLifecycle candidate))
               (< (:revisionWatermark candidate)
                  (:revisionWatermark current)))
      (fail! :revision-regression-under-unchanged-lifecycle
             {:field :revisionWatermark}))
    (case action
      ("concurrent-environment" "restore")
      (when-not (= current candidate)
        (fail! :immutable-environment-drift))

      ("rebuild" "lifecycle-rotation")
      (do
        (require-equal-fields! current candidate stable-source-fields
                               :source-identity-drift)
        (require-rotated-identities! candidate [current]))

      "deployment"
      (require-rotated-identities! candidate [current])

      "rollback"
      (do
        (when (= current rollbackTarget)
          (fail! :invalid-rollback-target))
        (require-rotated-identities! rollbackTarget [current])
        (when-not (= candidate rollbackTarget)
          (require-equal-fields! rollbackTarget candidate
                                 stable-source-fields
                                 :rollback-source-mismatch)
          (require-rotated-identities! candidate
                                       [current rollbackTarget]))))
    candidate))

(defn verify-runtime-state!
  "Bind one decoded state value to the exact versioned S3 object bytes and the
  function's immutable configuration. JSON decoding is intentionally supplied
  by the eventual Lambda boundary so this source-only gate has no unpublished
  runtime dependency."
  [expected raw-bytes decode-state]
  (validate-expected! expected)
  (when-not (fn? decode-state)
    (fail! :invalid-state-decoder))
  (let [bytes
        (cond
          (string? raw-bytes)
          (.getBytes ^String raw-bytes StandardCharsets/UTF_8)

          (instance? byte-array-class raw-bytes)
          raw-bytes

          :else
          (fail! :invalid-state-bytes))]
    (when-not (<= 1 (alength ^bytes bytes) maximum-state-bytes)
      (fail! :invalid-state-size))
    (when-not (= (:objectSha256 expected) (sha256-hex bytes))
      (fail! :state-digest-mismatch))
    (let [decoded-state
          (try
            (decode-state bytes)
            (catch Exception _
              (fail! :state-decode-failed)))
          state (validate-state! decoded-state)]
      (doseq [field immutable-binding-fields]
        (when-not (= (get expected field) (get state field))
          (fail! :state-binding-mismatch {:field field})))
      state)))

(defn- reread-state!
  [expected read-state-bytes! decode-state]
  (when-not (fn? read-state-bytes!)
    (fail! :invalid-state-reader))
  (let [raw-bytes
        (try
          (read-state-bytes!
           (select-keys expected
                        [:runtimeStateBucket :runtimeStateObjectKey
                         :runtimeStateObjectVersion]))
          (catch Exception _
            (fail! :state-read-failed)))]
    (verify-runtime-state! expected raw-bytes decode-state)))

(defn immutable-watermark-binding
  "Create the EACL Datalevin lifecycle options for a prebuilt immutable store.
  EACL may acknowledge the already-published final revision, but every callback
  rereads and verifies the exact immutable state-object version first. Any
  attempted advance, regression, or external identity drift fails closed."
  [expected state read-state-bytes! decode-state]
  (validate-expected! expected)
  (validate-state! state)
  (doseq [field immutable-binding-fields]
    (when-not (= (get expected field) (get state field))
      (fail! :state-binding-mismatch {:field field})))
  (let [final-revision (:revisionWatermark state)
        watermark
        (reify clojure.lang.IDeref
          (deref [_] final-revision))]
    {:native-source-id (:nativeSourceId state)
     :eacl-client-options
     {:source-lifecycle (:sourceLifecycle state)
      :revision-watermark watermark
      :advance-revision-watermark!
      (fn [revision]
        (require-field! exact-natural? :revisionWatermark revision)
        (when-not (= final-revision revision)
          (fail! :immutable-revision-change {:field :revisionWatermark}))
        (let [reread-state
              (reread-state! expected read-state-bytes! decode-state)]
          (when-not (= state reread-state)
            (fail! :immutable-state-changed))
          revision))}}))

(defn bootstrap-ready!
  "Prove the local embedded store reached the exact externally published
  identity and is quiescent/frozen before the EACL client can be exposed."
  [expected state observation read-state-bytes! decode-state]
  (validate-expected! expected)
  (validate-state! state)
  (exact-keys! observation bootstrap-observation-keys
               :invalid-bootstrap-observation)
  (doseq [field (conj immutable-binding-fields :logicalResourceCount)]
    (when-not (= (get state field) (get observation field))
      (fail! :bootstrap-binding-mismatch {:field field})))
  (when-not (= "embedded" (:storageMode observation))
    (fail! :invalid-bootstrap-topology {:field :storageMode}))
  (when-not (false? (:nativeInMemory observation))
    (fail! :invalid-bootstrap-topology {:field :nativeInMemory}))
  (when-not (= 1 (:localDatabaseCount observation))
    (fail! :invalid-bootstrap-topology {:field :localDatabaseCount}))
  (doseq [field [:remoteServer :haMode :wal :efsMounted]]
    (when-not (false? (get observation field))
      (fail! :invalid-bootstrap-topology {:field field})))
  (when-not (= "/tmp/eacl-demo-datalevin" (:durableServingPath observation))
    (fail! :invalid-bootstrap-topology {:field :durableServingPath}))
  (when-not (true? (:schemaFrozen observation))
    (fail! :bootstrap-not-frozen {:field :schemaFrozen}))
  (when-not (true? (:relationsFrozen observation))
    (fail! :bootstrap-not-frozen {:field :relationsFrozen}))
  (when-not (false? (:publicWriter observation))
    (fail! :public-writer-present {:field :publicWriter}))
  (when-not (= 0 (:activeReadSnapshots observation))
    (fail! :bootstrap-not-quiescent {:field :activeReadSnapshots}))
  (let [reread-state
        (reread-state! expected read-state-bytes! decode-state)]
    (when-not (= state reread-state)
      (fail! :immutable-state-changed))
    (immutable-watermark-binding
     expected state read-state-bytes! decode-state)))
