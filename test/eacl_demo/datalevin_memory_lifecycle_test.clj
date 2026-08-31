(ns eacl-demo.datalevin-memory-lifecycle-test
  (:require [clojure.test :refer [deftest is testing use-fixtures]]
            [eacl-demo.contracts.build-identity :as build-identity]
            [eacl-demo.datalevin-memory.lifecycle :as lifecycle]))

(def valid-state
  {:schema "eacl-demo.datalevin-lifecycle-state.v1"
   :profileId "datalevin-memory"
   :stateKind "external-control-plane-metadata"
   :demoSha (apply str (repeat 40 "d"))
   :eaclSha (apply str (repeat 40 "e"))
   :artifactSha256 (apply str (repeat 64 "f"))
   :deploymentId "datalevin-candidate-42"
   :runtime "java25"
   :architecture "arm64"
   :storageMode "embedded"
   :snapshotStrategy "after-restore-rebuild"
   :maximumConcurrency 1
   :dataManifestSha256 (apply str (repeat 64 "a"))
   :bootstrapPlanSha256 (apply str (repeat 64 "b"))
   :sourceLifecycle "123e4567-e89b-42d3-a456-426614174000"
   :nativeSourceId "223e4567-e89b-42d3-a456-426614174000"
   :revisionWatermark 42
   :logicalResourceCount 10000
   :mutationPolicy "immutable-after-publication"})

(use-fixtures :each
  (fn [run]
    (with-redefs [build-identity/eacl-sha (constantly (:eaclSha valid-state))]
      (run))))

(def raw-state
  "{\"schema\":\"eacl-demo.datalevin-lifecycle-state.v1\"}")

(def valid-environment
  {"EACL_DATALEVIN_RUNTIME_STATE_SCHEMA"
   "eacl-demo.datalevin-lifecycle-state.v1"
   "EACL_DATALEVIN_RUNTIME_STATE_SHA256" (lifecycle/sha256-hex raw-state)
   "EACL_DEMO_SHA" (:demoSha valid-state)
   "EACL_CORE_SHA" (:eaclSha valid-state)
   "EACL_ARTIFACT_SHA256" (:artifactSha256 valid-state)
   "EACL_DEPLOYMENT_ID" (:deploymentId valid-state)
   "EACL_RUNTIME" (:runtime valid-state)
   "EACL_ARCHITECTURE" (:architecture valid-state)
   "EACL_DATA_MANIFEST_SHA256" (:dataManifestSha256 valid-state)
   "EACL_DATALEVIN_BOOTSTRAP_PLAN_SHA256" (:bootstrapPlanSha256 valid-state)
   "EACL_SOURCE_LIFECYCLE_ID" (:sourceLifecycle valid-state)
   "EACL_DATALEVIN_NATIVE_SOURCE_ID" (:nativeSourceId valid-state)
   "EACL_DATALEVIN_REVISION_WATERMARK" "42"
   "EACL_DATALEVIN_RUNTIME_STATE_BUCKET" "eacl-demo-runtime-state"
   "EACL_DATALEVIN_RUNTIME_STATE_KEY"
   (str "runtime-state/datalevin-memory/"
        (:dataManifestSha256 valid-state) "/"
        (:sourceLifecycle valid-state) ".json")
   "EACL_DATALEVIN_RUNTIME_STATE_VERSION" "exact-version-id"
   "EACL_DATALEVIN_STORAGE_MODE" "embedded"
   "EACL_SNAPSHOT_STRATEGY" "after-restore-rebuild"
   "EACL_MAXIMUM_CONCURRENCY" "1"})

(def valid-observation
  {:schema (:schema valid-state)
   :demoSha (:demoSha valid-state)
   :eaclSha (:eaclSha valid-state)
   :artifactSha256 (:artifactSha256 valid-state)
   :deploymentId (:deploymentId valid-state)
   :runtime "java25"
   :architecture "arm64"
   :storageMode "embedded"
   :snapshotStrategy "after-restore-rebuild"
   :maximumConcurrency 1
   :dataManifestSha256 (:dataManifestSha256 valid-state)
   :bootstrapPlanSha256 (:bootstrapPlanSha256 valid-state)
   :sourceLifecycle (:sourceLifecycle valid-state)
   :nativeSourceId (:nativeSourceId valid-state)
   :revisionWatermark 42
   :logicalResourceCount 10000
   :schemaFrozen true
   :relationsFrozen true
   :publicWriter false
   :activeReadSnapshots 0
   :nativeInMemory false
   :localDatabaseCount 1
   :remoteServer false
   :haMode false
   :wal false
   :efsMounted false
   :durableServingPath "/tmp/eacl-demo-datalevin"})

(def rebuilt-state
  (assoc valid-state
         :deploymentId "datalevin-rebuild-43"
         :sourceLifecycle "323e4567-e89b-42d3-a456-426614174000"
         :nativeSourceId "423e4567-e89b-42d3-a456-426614174000"))

(def deployed-state
  (assoc rebuilt-state
         :demoSha (apply str (repeat 40 "1"))
         :artifactSha256 (apply str (repeat 64 "2"))
         :deploymentId "datalevin-deployment-44"
         :sourceLifecycle "523e4567-e89b-42d3-a456-426614174000"
         :nativeSourceId "623e4567-e89b-42d3-a456-426614174000"
         :revisionWatermark 7))

(defn error-data
  [thunk]
  (try
    (thunk)
    nil
    (catch clojure.lang.ExceptionInfo error
      (ex-data error))))

(defn decode-valid-state
  [_]
  valid-state)

(deftest versioned-runtime-state-is-exactly-bound-test
  (let [expected (lifecycle/expected-state-from-environment!
                  (assoc valid-environment "UNRELATED_PROCESS_VALUE" "ignored"))]
    (is (= valid-state
           (lifecycle/verify-runtime-state!
            expected raw-state decode-valid-state)))
    (is (= :state-digest-mismatch
           (:reason
            (error-data
             #(lifecycle/verify-runtime-state!
               expected (str raw-state " ") decode-valid-state)))))
    (is (= :state-binding-mismatch
           (:reason
            (error-data
             #(lifecycle/verify-runtime-state!
               expected raw-state
               (fn [_]
                 (assoc valid-state :revisionWatermark 41)))))))
    (is (= :invalid-expected-state
           (:reason
            (error-data
             #(lifecycle/verify-runtime-state!
               (assoc expected :storageMode "disk")
               raw-state decode-valid-state)))))
    (is (= :invalid-expected-state
           (:reason
            (error-data
             #(lifecycle/verify-runtime-state!
               (assoc expected :objectSha256 "not-a-digest")
               raw-state decode-valid-state)))))
    (is (= :invalid-expected-state
           (:reason
            (error-data
             #(lifecycle/verify-runtime-state!
               (assoc expected :runtimeStateObjectKey
                      "runtime-state/datalevin-memory/invalid.json")
               raw-state decode-valid-state)))))
    (is (= :state-decode-failed
           (:reason
            (error-data
             #(lifecycle/verify-runtime-state!
               expected raw-state
               (fn [_] (throw (Exception. "sensitive decoder failure"))))))))))

(deftest lifecycle-state-is-closed-and-redacted-test
  (is (= valid-state (lifecycle/validate-state! valid-state)))
  (doseq [candidate [(assoc valid-state :unexpected "secret")
                     (dissoc valid-state :mutationPolicy)
                     (assoc valid-state :sourceLifecycle
                            (:nativeSourceId valid-state))
                     (assoc valid-state :revisionWatermark -1)
                     (assoc valid-state :logicalResourceCount 9999)]]
    (let [data (error-data #(lifecycle/validate-state! candidate))]
      (is (= :eacl-demo.datalevin/invalid-lifecycle-state (:type data)))
      (is (not (contains? data :value)))
      (is (not (contains? data :state))))))

(deftest lifecycle-transitions-are-deployment-bound-test
  (doseq [action ["concurrent-environment" "restore"]]
    (is (= valid-state
           (lifecycle/validate-transition!
            {:action action
             :current valid-state
             :candidate valid-state
             :rollbackTarget nil}))))
  (doseq [action ["rebuild" "lifecycle-rotation"]]
    (is (= rebuilt-state
           (lifecycle/validate-transition!
            {:action action
             :current valid-state
             :candidate rebuilt-state
             :rollbackTarget nil}))))
  (is (= deployed-state
         (lifecycle/validate-transition!
          {:action "deployment"
           :current rebuilt-state
           :candidate deployed-state
           :rollbackTarget nil})))
  (is (= valid-state
         (lifecycle/validate-transition!
          {:action "rollback"
           :current deployed-state
           :candidate valid-state
           :rollbackTarget valid-state})))
  (let [rotated-rollback
        (assoc valid-state
               :deploymentId "datalevin-rollback-45"
               :sourceLifecycle "723e4567-e89b-42d3-a456-426614174000"
               :nativeSourceId "823e4567-e89b-42d3-a456-426614174000")]
    (is (= rotated-rollback
           (lifecycle/validate-transition!
            {:action "rollback"
             :current deployed-state
             :candidate rotated-rollback
             :rollbackTarget valid-state})))))

(deftest lifecycle-transition-loopholes-fail-closed-test
  (doseq [[transition expected-reason]
          [[{:action "concurrent-environment"
             :current valid-state
             :candidate (assoc valid-state
                               :deploymentId "unexpected-environment")
             :rollbackTarget nil}
            :immutable-environment-drift]
           [{:action "restore"
             :current valid-state
             :candidate (assoc valid-state :revisionWatermark 43)
             :rollbackTarget nil}
            :immutable-environment-drift]
           [{:action "rebuild"
             :current valid-state
             :candidate (assoc rebuilt-state
                               :artifactSha256 (apply str (repeat 64 "0")))
             :rollbackTarget nil}
            :source-identity-drift]
           [{:action "rebuild"
             :current valid-state
             :candidate (assoc rebuilt-state
                               :sourceLifecycle (:sourceLifecycle valid-state))
             :rollbackTarget nil}
            :lifecycle-identity-reuse]
           [{:action "deployment"
             :current valid-state
             :candidate (assoc deployed-state
                               :deploymentId (:deploymentId valid-state))
             :rollbackTarget nil}
            :lifecycle-identity-reuse]
           [{:action "deployment"
             :current valid-state
             :candidate (assoc deployed-state
                               :sourceLifecycle (:sourceLifecycle valid-state)
                               :revisionWatermark 41)
             :rollbackTarget nil}
            :revision-regression-under-unchanged-lifecycle]
           [{:action "rollback"
             :current deployed-state
             :candidate deployed-state
             :rollbackTarget deployed-state}
            :invalid-rollback-target]
           [{:action "rollback"
             :current deployed-state
             :candidate valid-state
             :rollbackTarget (assoc valid-state
                                    :nativeSourceId
                                    (:nativeSourceId deployed-state))}
            :lifecycle-identity-reuse]
           [{:action "rollback"
             :current deployed-state
             :candidate (assoc valid-state
                               :artifactSha256 (apply str (repeat 64 "0")))
             :rollbackTarget valid-state}
            :rollback-source-mismatch]
           [{:action "restore"
             :current valid-state
             :candidate valid-state
             :rollbackTarget rebuilt-state}
            :invalid-transition]]]
    (let [data (error-data #(lifecycle/validate-transition! transition))]
      (is (= expected-reason (:reason data)))
      (is (= :eacl-demo.datalevin/invalid-lifecycle-state (:type data)))
      (is (not (contains? data :current)))
      (is (not (contains? data :candidate)))))
  (is (= :invalid-transition
         (:reason
          (error-data
           #(lifecycle/validate-transition!
             {:action "restore"
              :current valid-state
              :candidate valid-state
              :rollbackTarget nil
              :unexpected "secret"}))))))

(deftest environment-contract-rejects-topology-and-identity-drift-test
  (is (= 42 (:revisionWatermark
             (lifecycle/expected-state-from-environment! valid-environment))))
  (is (= (:eaclSha valid-state)
         (:eaclSha (lifecycle/expected-state-from-environment!
                    (dissoc valid-environment "EACL_CORE_SHA")))))
  (is (= (:eaclSha valid-state)
         (:eaclSha (lifecycle/expected-state-from-environment!
                    (assoc valid-environment "EACL_CORE_SHA"
                           (apply str (repeat 40 "0")))))))
  (doseq [[field value]
          [["EACL_DATALEVIN_STORAGE_MODE" "disk"]
           ["EACL_RUNTIME" "provided.al2023"]
           ["EACL_ARCHITECTURE" "x86_64"]
           ["EACL_DEMO_SHA" (apply str (repeat 40 "g"))]
           ["EACL_DEPLOYMENT_ID" "bad deployment"]
           ["EACL_MAXIMUM_CONCURRENCY" "2"]
           ["EACL_SNAPSHOT_STRATEGY" "unqualified"]
           ["EACL_DATALEVIN_REVISION_WATERMARK" "-1"]
           ["EACL_DATALEVIN_NATIVE_SOURCE_ID"
            (:sourceLifecycle valid-state)]
           ["EACL_DATALEVIN_RUNTIME_STATE_KEY"
            "runtime-state/datalevin-memory/invalid.json"]
           ["EACL_DATALEVIN_RUNTIME_STATE_VERSION" "bad\nversion"]]]
    (is (= :invalid-environment
           (:reason
            (error-data
             #(lifecycle/expected-state-from-environment!
               (assoc valid-environment field value))))))))

(deftest readiness-requires-the-exact-frozen-quiescent-store-test
  (let [expected (lifecycle/expected-state-from-environment! valid-environment)
        reads (atom [])
        read-state! (fn [location]
                      (swap! reads conj location)
                      raw-state)
        binding (lifecycle/bootstrap-ready!
                 expected valid-state valid-observation
                 read-state! decode-valid-state)
        client-options (:eacl-client-options binding)
        advance! (:advance-revision-watermark! client-options)]
    (is (= #{:native-source-id :eacl-client-options} (set (keys binding))))
    (is (= #{:source-lifecycle :revision-watermark
             :advance-revision-watermark!}
           (set (keys client-options))))
    (is (= (:sourceLifecycle valid-state)
           (:source-lifecycle client-options)))
    (is (= 42 @(:revision-watermark client-options)))
    (is (= 42 (advance! 42)))
    (is (= [{:runtimeStateBucket "eacl-demo-runtime-state"
             :runtimeStateObjectKey
             (get valid-environment "EACL_DATALEVIN_RUNTIME_STATE_KEY")
             :runtimeStateObjectVersion "exact-version-id"}
            {:runtimeStateBucket "eacl-demo-runtime-state"
             :runtimeStateObjectKey
             (get valid-environment "EACL_DATALEVIN_RUNTIME_STATE_KEY")
             :runtimeStateObjectVersion "exact-version-id"}]
           @reads))
    (is (= :immutable-revision-change
           (:reason (error-data #(advance! 43)))))
    (is (= 2 (count @reads)))
    (is (= 42 @(:revision-watermark client-options))))
  (doseq [[field value reason]
          [[:schemaFrozen false :bootstrap-not-frozen]
           [:relationsFrozen false :bootstrap-not-frozen]
           [:publicWriter true :public-writer-present]
           [:activeReadSnapshots 1 :bootstrap-not-quiescent]
           [:nativeInMemory true :invalid-bootstrap-topology]
           [:localDatabaseCount 2 :invalid-bootstrap-topology]
           [:remoteServer true :invalid-bootstrap-topology]
           [:haMode true :invalid-bootstrap-topology]
           [:wal true :invalid-bootstrap-topology]
           [:efsMounted true :invalid-bootstrap-topology]
           [:durableServingPath nil :invalid-bootstrap-topology]
           [:artifactSha256 (apply str (repeat 64 "0"))
            :bootstrap-binding-mismatch]
           [:snapshotStrategy "pre-checkpoint-quiesced"
            :bootstrap-binding-mismatch]
           [:revisionWatermark 41 :bootstrap-binding-mismatch]]]
    (is (= reason
           (:reason
            (error-data
             #(lifecycle/bootstrap-ready!
               (lifecycle/expected-state-from-environment! valid-environment)
               valid-state (assoc valid-observation field value)
               (constantly raw-state) decode-valid-state)))))))

(deftest watermark-reread-fails-closed-test
  (let [expected (lifecycle/expected-state-from-environment! valid-environment)
        binding (lifecycle/bootstrap-ready!
                 expected valid-state valid-observation
                 (let [reads (atom 0)]
                   (fn [_]
                     (if (= 1 (swap! reads inc))
                       raw-state
                       (str raw-state " "))))
                 decode-valid-state)
        advance! (get-in binding
                         [:eacl-client-options
                          :advance-revision-watermark!])]
    (is (= :state-digest-mismatch
           (:reason (error-data #(advance! 42))))))
  (let [expected (lifecycle/expected-state-from-environment! valid-environment)
        binding (lifecycle/bootstrap-ready!
                 expected valid-state valid-observation
                 (let [reads (atom 0)]
                   (fn [_]
                     (if (= 1 (swap! reads inc))
                       raw-state
                       (throw (Exception. "sensitive S3 failure")))))
                 decode-valid-state)
        advance! (get-in binding
                         [:eacl-client-options
                          :advance-revision-watermark!])]
    (is (= :state-read-failed
           (:reason (error-data #(advance! 42)))))))
