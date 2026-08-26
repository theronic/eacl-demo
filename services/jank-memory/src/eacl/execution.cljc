(ns eacl.execution
  "Absolute request controls and finite scalar authorization work limits."
  (:require [eacl.cancellation :as cancellation]
            #?(:jank [eacl.runtime.native.clock :as clock])))

;; Adapted from modules/eacl/src/eacl/execution.cljc and the stable reducer
;; limits at frozen EACL commit 1cbf80c7aaf4bfcf2564d2bf30135794ff406383.
;; Protocol-backed cancellation and dynamic contracts are deliberately absent.

(def default-execution-timeout-ms 30000)
(def maximum-execution-timeout-ms 3600000)

(def default-scalar-limits
  {:max-depth 256
   :max-commands 1000000
   :max-transitions 4000000
   :max-fetched-values 1000000
   :max-allocation-proxy 10000000})

(def scalar-limit-keys (set (keys default-scalar-limits)))

(defn- invalid!
  [type reason data]
  (throw
   (ex-info
    "Invalid EACL execution contract."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn normalize-timeout-ms
  [value]
  (when-not (and (integer? value)
                 (pos? value)
                 (<= value maximum-execution-timeout-ms))
    (invalid! :eacl.execution/invalid-contract :invalid-timeout
              {:key :timeout-ms
               :value value
               :maximum-timeout-ms maximum-execution-timeout-ms}))
  value)

(defn normalize-scalar-limits
  [overrides]
  (let [overrides (or overrides {})]
    (when-not (map? overrides)
      (invalid! :eacl/invalid-config :invalid-scalar-limits
                {:value overrides}))
    (when-let [unknown (seq (remove scalar-limit-keys (keys overrides)))]
      (invalid! :eacl/invalid-config :unknown-scalar-limit
                {:unknown-keys (vec unknown)
                 :known-keys scalar-limit-keys}))
    (when-not (every? (fn [[_ value]]
                        (and (integer? value) (pos? value)))
                      overrides)
      (invalid! :eacl/invalid-config :invalid-scalar-limit
                {:value overrides}))
    (merge default-scalar-limits overrides)))

(defn now-nanos
  []
  #?(:jank (bigint (clock/monotonic-nanos))
     :clj (bigint (System/nanoTime))))

(defn normalize
  "Create one immutable execution contract with one absolute deadline."
  [client-options operation request]
  (let [client-options (or client-options {})
        request (or request {})
        token (:cancellation-token request)
        _ (when (and token (not (cancellation/cancellation-token? token)))
            (invalid! :eacl.execution/invalid-contract
                      :invalid-cancellation-token
                      {:key :cancellation-token}))
        timeout-ms
        (normalize-timeout-ms
         (or (:timeout-ms request)
             (:execution-timeout-ms client-options)
             default-execution-timeout-ms))
        started (now-nanos)]
    {:version 1
     :operation operation
     :configured-timeout-ms timeout-ms
     :started-nanos started
     :deadline-nanos (+ started (* (bigint timeout-ms) (bigint 1000000)))
     :cancellation-token token
     :limits (normalize-scalar-limits (:scalar-limits client-options))}))

(defn remaining-nanos
  [contract]
  (max (bigint 0) (- (:deadline-nanos contract) (now-nanos))))

(defn expired?
  [contract]
  (not (pos? (remaining-nanos contract))))

(defn deadline-exceeded!
  [contract stage counters]
  (throw
   (ex-info
    "EACL authorization execution deadline exceeded."
    (cond->
     {:type :eacl.execution/deadline-exceeded
      :eacl/error :eacl.execution/deadline-exceeded
      :operation (:operation contract)
      :stage stage
      :timeout-ms (:configured-timeout-ms contract)}
      (seq counters) (assoc :counters counters)))))

(defn cancellation-observed!
  [contract stage counters]
  (throw
   (ex-info
    "EACL authorization execution was cancelled."
    (cond->
     {:type :eacl.execution/cancelled
      :eacl/error :eacl.execution/cancelled
      :operation (:operation contract)
      :stage stage}
      (seq counters) (assoc :counters counters)))))

(defn check!
  ([contract stage]
   (check! contract stage nil))
  ([contract stage counters]
   (when (expired? contract)
     (deadline-exceeded! contract stage counters))
   (when (cancellation/cancelled? (:cancellation-token contract))
     (cancellation-observed! contract stage counters))
   contract))

(defn resource-limit!
  [contract limit-kind actual counters]
  (throw
   (ex-info
    "EACL authorization exhausted a scalar resource limit."
    {:type :eacl.execution/resource-limit-exceeded
     :eacl/error :eacl.execution/resource-limit-exceeded
     :reason :scalar-limit-exceeded
     :operation (:operation contract)
     :limit-kind limit-kind
     :limit (get (:limits contract) limit-kind)
     :actual actual
     :counters counters})))
