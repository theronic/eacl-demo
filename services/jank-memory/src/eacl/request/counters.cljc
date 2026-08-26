(ns eacl.request.counters
  "Plain-map counters for one request and its scalar semantic work.")

;; Adapted from modules/eacl/src/eacl/request/counters.cljc at frozen EACL
;; commit 1cbf80c7aaf4bfcf2564d2bf30135794ff406383. The primitive-array record
;; ledger is replaced by a closed map of scalar volatiles. Updating one counter
;; must not rebuild the complete persistent counter map in Jank's hot path.
;; A request context is execution-confined, so atomic read/modify/write is both
;; unnecessary and materially more expensive than owner-local mutation.

(def counter-keys
  [:acquisitions :releases :public-entries :context-constructions
   :generation-reads :definition-reads :seals :prepared-root-hits
   :point-kernel-entries :adapter-reads :writer-submissions
   :seeks :commands :transitions
   :fetched-values :allocation-proxy :repeated-states :probes
   :cache-key-builds :completed-answer-hits
   :completed-answer-publications :cache-bypasses
   :candidates-examined :output-units])

(def ^:private known-counter-keys (set counter-keys))
(def ^:private ledger-kind ::ledger)
(def ^:private ledger-fields #{::kind ::values})
(def ^:private volatile-type (type (volatile! nil)))

(defn empty-counts
  []
  (zipmap counter-keys (repeat 0)))

(defn make-ledger
  []
  {::kind ledger-kind
   ::values (zipmap counter-keys (repeatedly #(volatile! 0)))})

(defn ledger?
  [value]
  (and (map? value)
       (= ledger-fields (set (keys value)))
       (= ledger-kind (::kind value))
       (map? (::values value))
       (= known-counter-keys (set (keys (::values value))))
       (every? (fn [slot]
                 (and (= volatile-type (type slot))
                      (integer? @slot)
                      (not (neg? @slot))))
               (vals (::values value)))))

(defn- values!
  [ledger]
  ;; Ledgers are closed values created by `make-ledger` and are validated once
  ;; when a request context is constructed.  Rebuilding two key sets and
  ;; validating all 24 entries on every semantic counter increment made the
  ;; instrumentation substantially more expensive than the work it records.
  (when-not (and (map? ledger)
                 (= ledger-kind (::kind ledger))
                 (map? (::values ledger)))
    (throw
     (ex-info
      "Invalid EACL request counter ledger."
      {:type :eacl.request/invalid-counter-ledger
       :eacl/error :eacl.request/invalid-counter-ledger})))
  (::values ledger))

(defn value
  "Read one counter without materializing a complete snapshot."
  [ledger counter]
  (when-not (contains? known-counter-keys counter)
    (throw
     (ex-info "Unknown request counter."
              {:type :eacl.request/unknown-counter
               :eacl/error :eacl.request/unknown-counter
               :counter counter})))
  @(get (values! ledger) counter))

(defn add!
  ([ledger counter]
   (add! ledger counter 1))
  ([ledger counter amount]
   (when-not (contains? known-counter-keys counter)
     (throw
      (ex-info "Unknown request counter."
               {:type :eacl.request/unknown-counter
                :eacl/error :eacl.request/unknown-counter
                :counter counter})))
   (when-not (and (integer? amount) (not (neg? amount)))
     (throw
      (ex-info "Counter increments must be non-negative integers."
               {:type :eacl.request/invalid-counter-increment
                :eacl/error :eacl.request/invalid-counter-increment
                :counter counter :amount amount})))
   (let [slot (get (values! ledger) counter)]
     (vreset! slot (+ @slot amount)))
   nil))

(defn clear!
  "Reset a reusable owner-confined demand ledger."
  [ledger]
  (let [values (values! ledger)]
    (doseq [counter counter-keys]
      (vreset! (get values counter) 0)))
  nil)

(defn add-counts!
  "Merge a completed child ledger into its owner-confined aggregate ledger."
  [ledger additions]
  (when-not (and (map? additions)
                 (= known-counter-keys (set (keys additions)))
                 (every? (fn [[_ amount]]
                           (and (integer? amount) (not (neg? amount))))
                         additions))
    (throw
     (ex-info "Invalid completed request counter values."
              {:type :eacl.request/invalid-counter-increment
               :eacl/error :eacl.request/invalid-counter-increment})))
  (let [values (values! ledger)]
    (doseq [counter counter-keys]
      (let [amount (get additions counter)]
        (when (pos? amount)
          (let [slot (get values counter)]
            (vreset! slot (+ @slot amount)))))))
  nil)

(defn merge-and-clear!
  "Merge an owner-confined child ledger directly, then reset it for reuse.

  Unlike `snapshot` plus `add-counts!`, this does not allocate a 24-entry
  persistent map at every demand boundary."
  [ledger child]
  (let [values (values! ledger)
        child-values (values! child)]
    (doseq [counter counter-keys]
      (let [child-slot (get child-values counter)
            amount @child-slot]
        (when (pos? amount)
          (let [slot (get values counter)]
            (vreset! slot (+ @slot amount))))
        (vreset! child-slot 0))))
  nil)

(defn snapshot
  [ledger]
  (let [values (values! ledger)]
    (reduce (fn [result counter]
              (assoc result counter @(get values counter)))
            {} counter-keys)))

(defn delta
  [before after]
  (reduce
   (fn [result counter]
     (let [difference (- (get after counter 0) (get before counter 0))]
       (when (neg? difference)
         (throw
          (ex-info "Request counters cannot move backwards."
                   {:type :eacl.request/counter-regression
                    :eacl/error :eacl.request/counter-regression
                    :counter counter})))
       (assoc result counter difference)))
   {}
   counter-keys))
