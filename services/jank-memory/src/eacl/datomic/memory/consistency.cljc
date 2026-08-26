(ns eacl.datomic.memory.consistency
  "Deadline/cancellation-aware selection of current or exact retained snapshots."
  (:require [eacl.cancellation :as cancellation]
            [eacl.datomic.memory.order :as order]
            [eacl.datomic.memory.source :as source]
            [eacl.datomic.memory.store :as store]
            [eacl.datomic.memory.token :as token]
            [eacl.runtime.native.clock :as clock]))

(def modes
  #{:minimize-latency :fully-consistent
    :at-least-as-fresh :at-exact-snapshot})
(def ^:private control-keys #{:deadline-nanos :cancellation-token})

(defn- selection-error!
  [type reason data]
  (throw
   (ex-info
    "EACL memory snapshot selection failed."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn- normalize-controls
  [controls]
  (let [controls (or controls {})]
    (when-not (and (map? controls)
                   (every? control-keys (keys controls)))
      (selection-error! :eacl/invalid-request :invalid-controls {}))
    (when-let [deadline (:deadline-nanos controls)]
      (when-not (and (integer? deadline) (pos? deadline))
        (selection-error! :eacl/invalid-request :invalid-deadline {})))
    controls))

(defn- check-boundary!
  [controls phase]
  (cancellation/check! (:cancellation-token controls) phase)
  (when-let [deadline (:deadline-nanos controls)]
    (when (>= (clock/monotonic-nanos) deadline)
      (selection-error! :eacl.execution/deadline-exceeded
                        :deadline-exceeded {:phase phase}))))

(defn- normalize-descriptor
  [descriptor]
  (cond
    (contains? #{:minimize-latency :fully-consistent} descriptor)
    {:mode descriptor}

    (map? descriptor)
    (let [mode (:mode descriptor)]
      (when-not (and (contains? #{:at-least-as-fresh :at-exact-snapshot}
                                mode)
                     (= #{:mode :token} (set (keys descriptor)))
                     (string? (:token descriptor)))
        (selection-error! :eacl/invalid-request
                          :invalid-consistency-descriptor {}))
      descriptor)

    :else
    (selection-error! :eacl/invalid-request
                      :invalid-consistency-descriptor {})))

(defn- authenticate!
  [connection encoded now-seconds]
  (let [payload (token/decode (:token-keyring (store/config connection))
                              encoded)
        identities (store/identities connection)]
    (when-not (= (:store-id identities) (:store payload))
      (selection-error! :eacl.consistency/foreign-token
                        :foreign-store {}))
    (when-not (= (:lifecycle-id identities) (:lifecycle payload))
      (selection-error! :eacl.consistency/lifecycle-unavailable
                        :foreign-lifecycle {}))
    (when (> (:issued-at payload) (+ now-seconds 300))
      (selection-error! :eacl.consistency/invalid-token
                        :issued-in-future {}))
    ;; Expiry is an exclusive upper bound: a token is no longer valid at the
    ;; first second equal to :expires-at.
    (when (>= now-seconds (:expires-at payload))
      (selection-error! :eacl.consistency/token-expired
                        :expired {:expired-at (:expires-at payload)}))
    payload))

(defn- issue-for
  [connection revision now-seconds]
  (store/causal-token-for connection revision now-seconds))

(defn select
  ([connection descriptor]
   (select connection descriptor {}))
  ([connection descriptor controls]
   (let [descriptor (normalize-descriptor descriptor)
         controls (normalize-controls controls)
         mode (:mode descriptor)
         now-seconds (bigint (quot (clock/unix-time-millis) 1000))]
     (check-boundary! controls :before-snapshot-selection)
     (let [[database causal-token]
           (case mode
             :minimize-latency
             (let [database (store/db connection)]
               [database (issue-for connection
                                    (:basis database) now-seconds)])

             :fully-consistent
             (let [database (store/db connection)]
               [database (issue-for connection
                                    (:basis database) now-seconds)])

             :at-least-as-fresh
             (let [payload (authenticate! connection (:token descriptor)
                                          now-seconds)
                   database (store/db connection)]
               (when (< (:basis database) (:revision payload))
                 (selection-error! :eacl.consistency/freshness-unavailable
                                   :revision-not-reached
                                   {:requested (:revision payload)
                                    :current (:basis database)}))
               [database (issue-for connection
                                    (:basis database) now-seconds)])

             :at-exact-snapshot
             (let [payload (authenticate! connection (:token descriptor)
                                          now-seconds)
                   database (store/as-of connection (:locator payload))]
               [database (:token descriptor)]))]
       (check-boundary! controls :after-snapshot-selection)
       (source/selection
        connection database mode causal-token
        (if (= :at-exact-snapshot mode) :as-of :ordinary))))))

(defn deadline-after-millis
  [milliseconds]
  (when-not (and (integer? milliseconds) (not (neg? milliseconds)))
    (selection-error! :eacl/invalid-request :invalid-timeout {}))
  (+ (bigint (clock/monotonic-nanos))
     (* (bigint milliseconds) (bigint 1000000))))
