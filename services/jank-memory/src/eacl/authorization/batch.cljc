(ns eacl.authorization.batch
  "Closed validation and hierarchical accounting for ordered point batches."
  (:require [eacl.execution :as execution]
            [eacl.request.counters :as counters]))

(def default-aggregate-limits
  {:max-batch-size 256
   :max-commands 1000000
   :max-transitions 4000000
   :max-fetched-values 1000000
   :max-candidates-examined 1000000
   :max-probes 1000000
   :max-output-units 100000
   :max-allocation-proxy 10000000
   :max-publication-attempts 1024
   :candidate-window 10000})

(def aggregate-limit-keys (set (keys default-aggregate-limits)))
(def request-keys
  #{:checks :consistency :timeout-ms :cancellation-token :cache?
    :populate-cache?
    :evaluation :aggregate-limits})
(def demand-keys #{:subject :permission :resource})
(def endpoint-keys #{:type :id :relation})
(def per-demand-control-keys
  #{:consistency :timeout-ms :cancellation-token :cache? :populate-cache?
    :evaluation
    :aggregate-limits :scalar-limits :recursive-traversal-limits
    :permission-tree-limits :cache-attempt})

(defn- fail!
  [type reason data]
  (throw
   (ex-info
    "Invalid EACL ordered authorization batch."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn normalize-client-limits
  [overrides]
  (let [overrides (or overrides {})]
    (when-not (map? overrides)
      (fail! :eacl/invalid-config :invalid-aggregate-limits
             {:value overrides}))
    (let [unknown (vec (remove aggregate-limit-keys (keys overrides)))]
      (when (seq unknown)
        (fail! :eacl/invalid-config :unknown-aggregate-limit
               {:unknown-keys unknown
                :known-keys aggregate-limit-keys})))
    (when-not (every? (fn [[_ value]]
                        (and (integer? value) (pos? value)))
                      overrides)
      (fail! :eacl/invalid-config :invalid-aggregate-limit
             {:value overrides}))
    (merge default-aggregate-limits overrides)))

(defn normalize-request-limits
  [configured overrides]
  (let [configured (or configured default-aggregate-limits)
        overrides (or overrides {})]
    (when-not (map? overrides)
      (fail! :eacl.batch/invalid-request :invalid-aggregate-limits
             {:value overrides}))
    (let [unknown (vec (remove aggregate-limit-keys (keys overrides)))]
      (when (seq unknown)
        (fail! :eacl.batch/invalid-request :unknown-request-key
               {:key :aggregate-limits
                :unknown-keys unknown
                :known-keys aggregate-limit-keys})))
    (loop [remaining (seq overrides)]
      (when remaining
        (let [[key value] (first remaining)]
          (when-not (and (integer? value) (pos? value))
            (fail! :eacl.batch/invalid-request :invalid-aggregate-limit
                   {:key key :value value}))
          (when (> value (get configured key))
            (fail! :eacl.batch/invalid-request
                   :aggregate-limit-weakening
                   {:key key :value value
                    :configured-maximum (get configured key)}))
          (recur (next remaining)))))
    (merge configured overrides)))

(defn- validate-endpoint!
  [endpoint position demand-index]
  (when-not (map? endpoint)
    (fail! :eacl.batch/invalid-request :malformed-demand
           {:demand-index demand-index :position position :value endpoint}))
  (let [unknown (vec (remove endpoint-keys (keys endpoint)))]
    (when (seq unknown)
      (fail! :eacl.batch/invalid-request :unknown-demand-key
             {:demand-index demand-index :position position
              :unknown-keys unknown :known-keys endpoint-keys})))
  (when-not (and (contains? endpoint :type)
                 (keyword? (:type endpoint)))
    (fail! :eacl.batch/invalid-request :malformed-demand
           {:demand-index demand-index :position position :key :type
            :value (:type endpoint)}))
  (when-not (and (contains? endpoint :id)
                 (string? (:id endpoint))
                 (not (empty? (:id endpoint))))
    (fail! :eacl.batch/invalid-request :malformed-demand
           {:demand-index demand-index :position position :key :id
            :value (:id endpoint)}))
  (when-not (or (not (contains? endpoint :relation))
                (nil? (:relation endpoint)))
    (fail! :eacl.batch/invalid-request :unsupported-subject-relation
           {:demand-index demand-index :position position}))
  endpoint)

(defn validate-demand!
  [demand demand-index]
  (when-not (map? demand)
    (fail! :eacl.batch/invalid-request :malformed-demand
           {:demand-index demand-index :value demand}))
  (let [controls (vec (filter per-demand-control-keys (keys demand)))]
    (when (seq controls)
      (fail! :eacl.batch/invalid-request :per-demand-control
             {:demand-index demand-index :forbidden-keys controls})))
  (let [unknown (vec (remove demand-keys (keys demand)))
        missing (vec (remove #(contains? demand %) demand-keys))]
    (when (seq unknown)
      (fail! :eacl.batch/invalid-request :unknown-demand-key
             {:demand-index demand-index :unknown-keys unknown
              :known-keys demand-keys}))
    (when (seq missing)
      (fail! :eacl.batch/invalid-request :malformed-demand
             {:demand-index demand-index :missing-keys missing})))
  (when-not (keyword? (:permission demand))
    (fail! :eacl.batch/invalid-request :malformed-demand
           {:demand-index demand-index :key :permission
            :value (:permission demand)}))
  (validate-endpoint! (:subject demand) :subject demand-index)
  (validate-endpoint! (:resource demand) :resource demand-index)
  demand)

(defn validate-request!
  [request configured-limits]
  (when-not (map? request)
    (fail! :eacl.batch/invalid-request :malformed-request
           {:value request}))
  (let [unknown (vec (remove request-keys (keys request)))]
    (when (seq unknown)
      (fail! :eacl.batch/invalid-request :unknown-request-key
             {:unknown-keys unknown :known-keys request-keys})))
  (when-not (contains? request :checks)
    (fail! :eacl.batch/invalid-request :malformed-request
           {:missing-key :checks}))
  (when-not (vector? (:checks request))
    (fail! :eacl.batch/invalid-request :malformed-request
           {:key :checks :value (:checks request)}))
  (when (and (contains? request :cache?)
             (not (boolean? (:cache? request))))
    (fail! :eacl.batch/invalid-request :invalid-cache-control
           {:key :cache? :value (:cache? request)}))
  (when (and (contains? request :populate-cache?)
             (not (boolean? (:populate-cache? request))))
    (fail! :eacl.batch/invalid-request :invalid-cache-control
           {:key :populate-cache? :value (:populate-cache? request)}))
  (when-not (contains? #{nil :demand} (:evaluation request))
    (fail! :eacl/unsupported-feature :unsupported-evaluation-mode
           {:evaluation (:evaluation request)}))
  (let [limits (normalize-request-limits
                configured-limits (:aggregate-limits request))
        checks (:checks request)]
    (when (> (count checks) (:max-batch-size limits))
      (fail! :eacl.execution/resource-limit-exceeded
             :aggregate-limit-exceeded
             {:limit-kind :batch-size
              :limit (:max-batch-size limits)
              :actual (count checks)}))
    ;; Explicit loop: exceptions thrown from reduce/map callbacks corrupt the
    ;; pinned Jank unwinder in this validation shape.
    (loop [index 0]
      (when (< index (count checks))
        (validate-demand! (nth checks index) index)
        (recur (inc index))))
    (assoc request :aggregate-limits limits)))

(defn aggregate-counters
  [before after output-units]
  (let [delta (counters/delta before after)]
    {:commands (:commands delta)
     :transitions (:transitions delta)
     :fetched-values (:fetched-values delta)
     :candidates-examined (:candidates-examined delta)
     :probes (:probes delta)
     :output-units output-units
     :allocation-proxy (+ (:allocation-proxy delta) output-units)
     :publication-attempts (:completed-answer-publications delta)}))

(def limit->counter
  {:max-commands :commands
   :max-transitions :transitions
   :max-fetched-values :fetched-values
   :max-candidates-examined :candidates-examined
   :max-probes :probes
   :max-output-units :output-units
   :max-allocation-proxy :allocation-proxy
   :max-publication-attempts :publication-attempts})

(defn check-aggregate-limits!
  [limits values demand-index]
  (loop [remaining (seq limit->counter)]
    (when remaining
      (let [[limit-key counter-key] (first remaining)
            limit (get limits limit-key)
            actual (get values counter-key 0)]
        (when (> actual limit)
          (fail! :eacl.execution/resource-limit-exceeded
                 :aggregate-limit-exceeded
                 {:limit-kind counter-key :limit limit :actual actual
                  :demand-index demand-index
                  :aggregate-counters values}))
        (recur (next remaining)))))
  values)

(defn demand-error
  [error demand-index aggregate-counters]
  (let [data (or (ex-data error) {})]
    (ex-info
     (or (ex-message error) "Authorization batch demand failed.")
     (assoc data
            :demand-index (or (:demand-index data) demand-index)
            :aggregate-counters
            (or (:aggregate-counters data) aggregate-counters))
     error)))
