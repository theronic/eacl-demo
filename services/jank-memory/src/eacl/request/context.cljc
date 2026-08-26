(ns eacl.request.context
  "Plain-map synchronous context for one selected immutable snapshot."
  (:require [eacl.datomic.memory.source :as memory-source]
            [eacl.execution :as execution]
            [eacl.request.counters :as counters]
            [eacl.store :as store]
            #?(:jank [eacl.runtime.native.identity :as identity])))

;; Adapted from modules/eacl/src/eacl/request/context.cljc at frozen EACL
;; commit 1cbf80c7aaf4bfcf2564d2bf30135794ff406383. Nominal context types,
;; backend protocols, and proof-provider machinery are intentionally absent.

(def context-version 1)
(def ^:private context-kind ::context)
(def ^:private context-fields #{::kind ::version ::state})
(def ^:private input-keys
  #{:selection :operations :source-scope :schema-generation :contract
    :counter-ledger :plan-cache})
(def ^:private source-scope-keys #{:store-id :lifecycle-id})
(def ^:private memo-kinds
  #{:prepared-roots :dependency-proofs :decisions :completed-states
    :catalog-values :peer-validations})
(def ^:private atom-type (type (atom nil)))

(defn- invalid!
  [reason data]
  (throw
   (ex-info
    "Invalid EACL request context."
    (merge {:type :eacl.request/invalid-context
            :eacl/error :eacl.request/invalid-context
            :reason reason} data))))

(defn lineage-for-source-scope
  "Map the closed memory-store identity to locked Core's lineage shape.

  The bundled backend has one unbranched source. Its random store id is the
  source identity and its independently random lifecycle id is the history
  witness that must rotate when retained history is replaced."
  [scope]
  (when-not (and (map? scope)
                 (= source-scope-keys (set (keys scope)))
                 (every? #(and (string? %) (not (empty? %))) (vals scope)))
    (invalid! :invalid-source-scope {:source-scope scope}))
  {:source-scope {:backend :datomic-memory
                  :source-id (:store-id scope)
                  :branch nil}
   :source-lifecycle (:lifecycle-id scope)})

(defn context?
  [value]
  (and (map? value)
       (= context-fields (set (keys value)))
       (= context-kind (::kind value))
       (= context-version (::version value))
       (= atom-type (type (::state value)))))

(defn- state-of
  [context]
  ;; Context shape is checked at every public target boundary.  Internal
  ;; access stays fail-closed but avoids allocating and comparing a key set on
  ;; every seek, transition, counter update, and memo lookup.
  (if (and (map? context)
           (= context-kind (::kind context))
           (= context-version (::version context))
           (= atom-type (type (::state context))))
    @(::state context)
    (invalid! :invalid-context-value {})))

(defn- owner!
  [state]
  #?(:jank (identity/require-owner! (:owner state))
     :clj true))

(defn- open-state!
  [context]
  (let [state (state-of context)]
    (owner! state)
    (case (:close-state state)
      :open (do (memory-source/assert-open! (:selection state)) state)
      :closing
      (throw (ex-info "Request context cleanup is in progress."
                      {:type :eacl.request/context-close-in-progress
                       :eacl/error :eacl.request/context-close-in-progress}))
      :closed
      (throw (ex-info "Request context is closed."
                      {:type :eacl.request/context-closed
                       :eacl/error :eacl.request/context-closed})))))

(defn assert-open!
  [context]
  (open-state! context)
  context)

(defn closed?
  [context]
  (= :closed (:close-state (state-of context))))

(defn access-error-data
  "Return snapshot-view access failure data without throwing.

  Public convenience functions use this probe so the pinned Jank unwinder does
  not need to carry an exception across an otherwise redundant forwarding
  frame."
  [context]
  (let [state (state-of context)
        owner (:owner state)]
    (cond
      #?(:jank (not (identity/execution-identity? owner)) :clj false)
      {:type :eacl.snapshot/invalid-owner
       :eacl/error :eacl.snapshot/invalid-owner}

      #?(:jank (not (identity/same-execution? owner)) :clj false)
      {:type :eacl.snapshot/cross-execution-use
       :eacl/error :eacl.snapshot/cross-execution-use}

      (= :closing (:close-state state))
      {:type :eacl.request/context-close-in-progress
       :eacl/error :eacl.request/context-close-in-progress}

      (= :closed (:close-state state))
      {:type :eacl.request/context-closed
       :eacl/error :eacl.request/context-closed}

      :else nil)))

(defn- staged-counter!
  [ledger contract counter limit-kind amount]
  (let [actual (+ (counters/value ledger counter) amount)]
    (when (> actual (get-in contract [:limits limit-kind]))
      (execution/resource-limit!
       contract limit-kind actual
       (assoc (counters/snapshot ledger) counter actual)))
    (counters/add! ledger counter amount)))

(defn- raw-read!
  [operations database ledger contract index-name components]
  (execution/check! contract :context-schema-generation)
  (staged-counter! ledger contract :commands :max-commands 1)
  (counters/add! ledger :adapter-reads)
  (counters/add! ledger :seeks)
  (let [values (vec (store/seek-datoms-chunk-trusted
                     operations database index-name components 2))]
    ;; Observe a cancellation or deadline raised while the backend seek was in
    ;; progress. Semantic counter increments themselves remain clock-free.
    (execution/check! contract :after-adapter-read)
    (staged-counter! ledger contract :fetched-values
                     :max-fetched-values (count values))
    values))

(defn- certified-schema-generation!
  [selection operations ledger contract]
  (let [database (:db selection)
        controls
        (vec
         (filter
          #(and (= :eacl/id (:a %))
                (= "eacl.schema/control" (:v %)))
          (raw-read! operations database ledger contract :avet
                     [:eacl/id "eacl.schema/control"])))]
    (when (> (count controls) 1)
      (invalid! :duplicate-schema-control {}))
    (if (empty? controls)
      0
      (let [entity (:e (first controls))
            values
            (vec
             (filter
              #(and (= entity (:e %))
                    (= :eacl/schema-generation (:a %)))
              (raw-read! operations database ledger contract :eavt
                         [entity :eacl/schema-generation])))]
        (when-not (= 1 (count values))
          (invalid! :invalid-schema-generation-datoms
                    {:count (count values)}))
        (let [generation (:v (first values))]
          (when-not (and (integer? generation) (pos? generation))
            (invalid! :invalid-certified-schema-generation
                      {:schema-generation generation}))
          generation)))))

(defn- construction-failure!
  [release-fn error]
  (try
    (when-not (true? (release-fn))
      (throw
       (ex-info "Request snapshot release failed."
                {:type :eacl/snapshot-release-failed
                 :eacl/error :eacl/snapshot-release-failed
                 :context-error (ex-data error)})))
    (throw error)
    (catch #?(:jank cpp/jank.runtime.object_ref
              :clj Throwable) release-error
      (if (= release-error error)
        (throw error)
        (throw
         (ex-info "Context construction and snapshot release both failed."
                  {:type :eacl/snapshot-release-failed
                   :eacl/error :eacl/snapshot-release-failed
                   :context-error (ex-data error)
                   :release-error (ex-data release-error)}))))))

(defn make-context
  [input]
  (when-not (map? input)
    (invalid! :input-not-map {}))
  (when-let [unknown (seq (remove input-keys (keys input)))]
    (invalid! :unknown-input-keys {:unknown-keys (vec unknown)}))
  (let [selection (:selection input)
        contract (:contract input)
        ledger (or (:counter-ledger input) (counters/make-ledger))]
    (when-not (memory-source/selection? selection)
      (invalid! :invalid-selection {:selection selection}))
    (memory-source/assert-open! selection)
    (let [release-fn #(memory-source/release! selection)]
      (try
        (let [scope (:source-scope input)
              basis-identity (:semantic-identity selection)
              expected-scope
              {:store-id (:source-id basis-identity)
               :lifecycle-id (:source-lifecycle basis-identity)}
              _ (when-not (= expected-scope scope)
                  (invalid! :selection-source-scope-mismatch {}))
              lineage (memory-source/lineage-for-basis basis-identity)
              _ (when-not (and (map? contract) (map? (:limits contract)))
                  (invalid! :invalid-contract {}))
              _ (when-not (store/operations? (:operations input))
                  (invalid! :invalid-store-operations {}))
              _ (when-not (counters/ledger? ledger)
                  (invalid! :invalid-counter-ledger {}))]
        (let [generation
            (certified-schema-generation!
             selection (:operations input) ledger contract)
            supplied (:schema-generation input)
            _ (when (and (some? supplied) (not= supplied generation))
                (invalid! :schema-generation-mismatch
                          {:supplied supplied :certified generation}))
            context
            {::kind context-kind
             ::version context-version
             ::state
             (atom
              {:close-state :open
               :owner #?(:jank (identity/current-execution-identity) :clj 1)
               :selection selection
               :basis-identity basis-identity
               :operations (:operations input)
               :source-scope scope
               :lineage lineage
               :schema-generation generation
               :relationship-halves-certified?
               (do
                 (counters/add! ledger :adapter-reads)
                 (store/relationship-halves-certified?
                  (:operations input) (:db selection)))
               :contract contract
               :counter-ledger ledger
               ;; Most public requests never open a child-demand scope. Build
               ;; its 24 scalar slots only if vectorized/scalar work needs it.
               :demand-counter-ledger nil
               :active-counter-ledger nil
               :plan-cache (:plan-cache input)
               :release-fn release-fn
               ;; All request access is execution-confined. One volatile map
               ;; avoids six atom allocations and six CAS domains per request.
               :memos (volatile! {})})}]
          (counters/add! ledger :acquisitions)
          (counters/add! ledger :context-constructions)
          context))
        (catch #?(:jank cpp/jank.runtime.object_ref
                  :clj Throwable) error
          (construction-failure! release-fn error))))))

(defn- value
  [context key]
  (get (open-state! context) key))

(defn database [context] (memory-source/database (value context :selection)))
(defn selection [context] (value context :selection))
(defn basis-identity [context] (value context :basis-identity))
(defn operations [context] (value context :operations))
(defn source-scope [context] (value context :source-scope))
(defn lineage [context] (value context :lineage))
(defn schema-generation [context] (value context :schema-generation))
(defn relationship-halves-certified?
  [context]
  (boolean (value context :relationship-halves-certified?)))
(defn contract [context] (value context :contract))
(defn counter-ledger [context] (value context :counter-ledger))
(defn plan-cache [context] (value context :plan-cache))

(defn- work-ledger
  [context]
  (let [state (open-state! context)]
    (or (:active-counter-ledger state) (:counter-ledger state))))

(defn counters
  [context]
  (counters/snapshot (work-ledger context)))

(defn aggregate-counters
  [context]
  (let [state (open-state! context)
        aggregate (counters/snapshot (:counter-ledger state))]
    ;; Preserve the observable non-resetting aggregate while a child demand is
    ;; active even though its atom is merged only once at the child boundary.
    (if-let [active (:active-counter-ledger state)]
      (let [child (counters/snapshot active)]
        (reduce (fn [result counter]
                  (update result counter + (get child counter)))
                aggregate counters/counter-keys))
      aggregate)))

(defn begin-demand!
  [context]
  (let [state (open-state! context)
        state-atom (::state context)
        demand-ledger (or (:demand-counter-ledger state)
                          (counters/make-ledger))]
    (when (:active-counter-ledger state)
      (invalid! :nested-demand-scope {}))
    (reset! state-atom
            (assoc state
                   :demand-counter-ledger demand-ledger
                   :active-counter-ledger demand-ledger))
    true))

(defn end-demand!
  [context]
  (let [state (open-state! context)
        state-atom (::state context)
        ledger (:active-counter-ledger state)]
    (when-not ledger
      (invalid! :missing-demand-scope {}))
    ;; Child work needs scalar counters while it runs and aggregate counters
    ;; after it completes. Merge directly and clear the reusable child without
    ;; allocating a complete counter snapshot at every candidate boundary.
    (counters/merge-and-clear! (:counter-ledger state) ledger)
    (reset! state-atom (assoc state :active-counter-ledger nil))
    nil))

(defn abort-demand!
  "Discard an internal speculative demand and return to aggregate scope."
  [context]
  (let [state (open-state! context)
        state-atom (::state context)
        ledger (:active-counter-ledger state)]
    (when-not ledger
      (invalid! :missing-demand-scope {}))
    (counters/clear! ledger)
    (reset! state-atom (assoc state :active-counter-ledger nil))
    nil))

(defn aggregate-counter-value
  "Read one aggregate counter without materializing a full snapshot."
  [context counter]
  (let [state (open-state! context)
        aggregate (counters/value (:counter-ledger state) counter)]
    (if-let [active (:active-counter-ledger state)]
      (+ aggregate (counters/value active counter))
      aggregate)))

(defn cut-point!
  [context stage]
  (let [state (open-state! context)]
    (execution/check! (:contract state) stage)))

(def ^:private counter->limit
  {:commands :max-commands
   :transitions :max-transitions
   :fetched-values :max-fetched-values
   :allocation-proxy :max-allocation-proxy})

(defn record!
  ([context counter]
   (record! context counter 1))
  ([context counter amount]
   (let [state (open-state! context)
         aggregate (:counter-ledger state)
         work (or (:active-counter-ledger state) aggregate)]
     (counters/add! work counter amount)
     nil)))

(defn consume!
  ([context counter]
   (consume! context counter 1))
  ([context counter amount]
   (let [state (open-state! context)
         contract (:contract state)
         ledger (or (:active-counter-ledger state)
                    (:counter-ledger state))
         limit-kind (get counter->limit counter)
         actual (+ (counters/value ledger counter) amount)
         limit (get-in contract [:limits limit-kind])]
     (when-not limit-kind
       (invalid! :unlimited-semantic-counter {:counter counter}))
     (when (> actual limit)
       (execution/resource-limit!
        contract limit-kind actual
        (assoc (counters/snapshot ledger) counter actual)))
     (counters/add! ledger counter amount))))

(defn check-depth!
  [context depth]
  (let [state (open-state! context)
        contract (:contract state)
        ledger (or (:active-counter-ledger state)
                   (:counter-ledger state))
        _ (execution/check! contract :authorization-state)
        limit (get-in contract [:limits :max-depth])]
    (when (> depth limit)
      (execution/resource-limit!
       contract :max-depth depth (counters/snapshot ledger))))
  depth)

(defn memo-value
  "Return a closed lookup result without invoking caller code."
  [context memo-kind key]
  (when-not (contains? memo-kinds memo-kind)
    (invalid! :unknown-memo-kind {:memo-kind memo-kind}))
  (let [slot (:memos (open-state! context))
        composite [memo-kind key]
        values @slot]
    (if (contains? values composite)
      {:found? true :value (get values composite)}
      {:found? false :value nil})))

(defn install-memo!
  "Install a completely built immutable value if the key is still absent."
  [context memo-kind key built]
  (when-not (contains? memo-kinds memo-kind)
    (invalid! :unknown-memo-kind {:memo-kind memo-kind}))
  (let [slot (:memos (open-state! context))
        composite [memo-kind key]
        values @slot]
    (if (contains? values composite)
      (get values composite)
      (do
        (vreset! slot (assoc values composite built))
        built))))

(defn close!
  [context]
  (let [state-atom (::state context)
        state @state-atom]
    (owner! state)
    (case (:close-state state)
      :closed false
      :closing
      (throw (ex-info "Request context cleanup is in progress."
                      {:type :eacl.request/context-close-in-progress
                       :eacl/error :eacl.request/context-close-in-progress}))
      :open
      (if (compare-and-set! state-atom state (assoc state :close-state :closing))
        (let [closing @state-atom
              released
              (try
                ((:release-fn closing))
                (catch #?(:jank cpp/jank.runtime.object_ref
                          :clj Throwable) error
                  (reset! state-atom (assoc closing :close-state :open))
                  (throw error)))]
          (when-not (true? released)
            (reset! state-atom (assoc closing :close-state :open))
            (throw
             (ex-info "Request snapshot release failed."
                      {:type :eacl/snapshot-release-failed
                       :eacl/error :eacl/snapshot-release-failed})))
          (counters/add! (:counter-ledger closing) :releases)
          (reset! state-atom (assoc closing :close-state :closed))
          true)
        (recur context)))))
