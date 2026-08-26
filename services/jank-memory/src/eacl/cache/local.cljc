(ns eacl.cache.local
  "Finite process-local caches implemented with tagged maps and atoms.")

(def ^:private cache-kind ::cache)
(def ^:private cache-fields
  #{::kind ::name ::maximum-entries ::state})
(def ^:private atom-type (type (atom nil)))

(defn- cache-error!
  [type reason data]
  (throw
   (ex-info
    "Invalid EACL local cache operation."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn cache
  [name maximum-entries]
  (when-not (keyword? name)
    (cache-error! :eacl/invalid-config :invalid-cache-name {:name name}))
  (when-not (and (integer? maximum-entries)
                 (pos? maximum-entries))
    (cache-error! :eacl/invalid-config :invalid-cache-capacity
                  {:maximum-entries maximum-entries}))
  {::kind cache-kind
   ::name name
   ::maximum-entries maximum-entries
   ::state (atom {:clock 0
                  :entries {}
                  :hits 0
                  :misses 0
                  :publications 0
                  :evictions 0
                  :bypasses 0
                  :clears 0})})

(defn cache?
  [value]
  (and (map? value)
       (= cache-fields (set (keys value)))
       (= cache-kind (::kind value))
       (keyword? (::name value))
       (integer? (::maximum-entries value))
       (pos? (::maximum-entries value))
       (= atom-type (type (::state value)))))

(defn- require-cache!
  [value]
  ;; Caches are constructed once and retained inside a validated client.  The
  ;; hot path only needs the nominal tag and state atom; exact shape checking
  ;; remains available through `cache?` at construction boundaries.
  (when-not (and (map? value)
                 (= cache-kind (::kind value))
                 (= atom-type (type (::state value))))
    (cache-error! :eacl/invalid-request :invalid-cache {}))
  value)

(defn- oldest-key
  [entries]
  (first
   (reduce
    (fn [oldest [key entry]]
      (if (or (nil? oldest)
              (< (:tick entry) (second oldest)))
        [key (:tick entry)]
        oldest))
    nil entries)))

(defn lookup-if!
  "Atomically return and touch an entry only when `accepted?` approves it.

  `accepted?` must be total, deterministic, side-effect free, and non-throwing.
  It may run more than once because an atom update can retry. Keeping the entry
  selection and the hit/miss transition in one `swap-vals!` prevents a racing
  clear or eviction from resurrecting an entry without its value."
  [value key accepted?]
  (let [cache (require-cache! value)]
    (when-not (fn? accepted?)
      (cache-error! :eacl/invalid-config :invalid-cache-acceptance-predicate {}))
    (let [state-atom (::state cache)
          [before _]
          (swap-vals!
           state-atom
           (fn [state]
             (let [entry (get (:entries state) key)
                   accepted (and entry (boolean (accepted? (:value entry))))]
               (if accepted
                 (let [tick (inc (:clock state))]
                   (-> state
                       (assoc :clock tick)
                       (update :hits inc)
                       (assoc-in [:entries key :tick] tick)))
                 (update state :misses inc)))))
          entry (get (:entries before) key)
          accepted (and entry (boolean (accepted? (:value entry))))]
      (if accepted
        {:found? true :value (:value entry)}
        {:found? false :value nil}))))

(defn- accept-any?
  [_]
  true)

(defn lookup!
  "Atomically return and touch an entry when present."
  [value key]
  (lookup-if! value key accept-any?))

(defn install!
  "Install one completely computed immutable value if absent.

  Concurrent publication is first-writer-wins. The returned value is the value
  actually retained, allowing every caller to report truthful provenance."
  [value key built]
  (let [cache (require-cache! value)
        state-atom (::state cache)]
    (let [published
          (swap!
           state-atom
           (fn [state]
             (if (contains? (:entries state) key)
               state
               (let [tick (inc (:clock state))
                     entries (assoc (:entries state) key
                                    {:value built :tick tick})
                     overflow? (> (count entries)
                                  (::maximum-entries cache))
                     evicted (when overflow? (oldest-key entries))
                     entries (if evicted (dissoc entries evicted) entries)]
                 (-> state
                     (assoc :clock tick :entries entries)
                     (update :publications inc)
                     (update :evictions + (if evicted 1 0)))))))
          retained (get-in published [:entries key])]
      ;; A capacity of at least one means a just-installed key cannot be the
      ;; oldest entry, because its tick is strictly newest.
      (when-not retained
        (cache-error! :eacl.cache/invariant-violation
                      :publication-not-retained {}))
      (:value retained))))

(defn bypass!
  [value]
  (let [cache (require-cache! value)]
    (swap! (::state cache) update :bypasses inc)
    true))

(defn clear!
  [value]
  (let [cache (require-cache! value)
        state-atom (::state cache)
        before (count (:entries @state-atom))]
    (swap! state-atom
           (fn [state]
             (-> state
                 (assoc :entries {})
                 (update :clears inc))))
    before))

(defn stats
  [value]
  (let [cache (require-cache! value)
        state @(::state cache)]
    {:name (::name cache)
     :maximum-entries (::maximum-entries cache)
     :size (count (:entries state))
     :hits (:hits state)
     :misses (:misses state)
     :publications (:publications state)
     :evictions (:evictions state)
     :bypasses (:bypasses state)
     :clears (:clears state)}))
