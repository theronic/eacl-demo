(ns eacl.datomic.memory.index
  "Immutable EAVT, AEVT, AVET, and direct-reference-only VAET indexes."
  (:require [eacl.datomic.memory.datom :as datom]
            [eacl.datomic.memory.order :as order]))

(def supported-indexes #{:eavt :aevt :avet :vaet})
(def index-width 4)
(def maximum-chunk-size 4096)
(def ^:private index-components
  {:eavt [:e :a :v :tx]
   :aevt [:a :e :v :tx]
   :avet [:a :v :e :tx]
   :vaet [:v :a :e :tx]})

(defn- index-error!
  [reason data]
  (throw
   (ex-info
    "Invalid EACL memory-store index operation."
    (merge {:type :eacl.store/invalid-index-operation
            :eacl/error :eacl.store/invalid-index-operation
            :reason reason}
           data))))

(defn index-key
  [index value]
  (case index
    :eavt [(:e value) (:a value) (:v value) (:tx value)]
    :aevt [(:a value) (:e value) (:v value) (:tx value)]
    :avet [(:a value) (:v value) (:e value) (:tx value)]
    :vaet [(:v value) (:a value) (:e value) (:tx value)]
    (index-error! :unsupported-index {:index index})))

(defn index-order-key
  [index value]
  (loop [roles (seq (get index-components index))
         components (seq (index-key index value))
         result []]
    (if-not roles
      result
      (let [role (first roles)
            component (first components)]
        (recur
         (next roles)
         (next components)
         (conj result
               (if (= :tx role)
                 ;; Datomic orders E/A/V ascending and T descending.
                 (order/value-order-key (- component))
                 (order/value-order-key component))))))))

(defn- require-reference-attributes!
  [reference-attributes]
  (when-not (and (set? reference-attributes)
                 (every? keyword? reference-attributes))
    (index-error! :invalid-reference-attributes {}))
  reference-attributes)

(defn- require-unique-assertions!
  [datoms]
  (loop [remaining (seq datoms)
         seen #{}]
    (when remaining
      (let [value (first remaining)
            identity [(:e value) (:a value) (:v value)]]
        (when (contains? seen identity)
          (index-error! :duplicate-assertion {:identity identity}))
        (recur (next remaining) (conj seen identity))))))

(defn- build-index
  [index datoms]
  (let [entries (->> datoms
                     (mapv (fn [value]
                             {:order-key (index-order-key index value)
                              :datom value}))
                     (sort-by :order-key order/compare-order-keys))
        sorted-datoms (mapv :datom entries)
        roles (get index-components index)
        value-position
        (loop [position 0]
          (if (= :v (nth roles position))
            position
            (recur (inc position))))
        prefix-ranges
        (reduce
         (fn [ranges [position value]]
           (let [key (index-key index value)
                 indexed-value (nth key value-position)
                 ;; Cache only the engine's relationship tuple prefix. A full
                 ;; all-index prefix table multiplies memory by O(D) and is not
                 ;; acceptable for the demo's 100k-object seed. Other seeks
                 ;; retain logarithmic positioning through the sorted keys.
                 prefixes
                 (if (and (= :eavt index)
                          (vector? indexed-value)
                          (<= 3 (count indexed-value)))
                   [(conj (subvec key 0 value-position)
                          (subvec indexed-value 0 3))]
                   [])]
             (reduce
              (fn [current prefix]
                (if-let [existing (get current prefix)]
                  (assoc current prefix [(first existing) (inc position)])
                  (assoc current prefix [position (inc position)])))
              ranges (distinct prefixes))))
         {} (map-indexed vector sorted-datoms))]
    {:index index
     :keys (mapv :order-key entries)
     :datoms sorted-datoms
     :prefix-ranges prefix-ranges}))

(defn build-indexes
  "Build all four indexes. VAET receives only direct values of declared ref
  attributes; tuple-contained entity IDs are never projected into VAET."
  [values reference-attributes]
  (let [reference-attributes
        (require-reference-attributes! reference-attributes)
        values (mapv datom/require-assertion! values)]
    (require-unique-assertions! values)
    (doseq [value values]
      (when (and (contains? reference-attributes (:a value))
                 (not (order/non-negative-id? (:v value))))
        (index-error! :invalid-reference-value
                      {:attribute (:a value) :value (:v value)})))
    (let [vaet-values
          (filterv #(contains? reference-attributes (:a %)) values)]
      {:eavt (build-index :eavt values)
       :aevt (build-index :aevt values)
       :avet (build-index :avet values)
       :vaet (build-index :vaet vaet-values)})))

(defn- require-index-data!
  [value]
  (when-not (and (map? value)
                 (= #{:index :keys :datoms :prefix-ranges}
                    (set (keys value)))
                 (contains? supported-indexes (:index value))
                 (vector? (:keys value))
                 (vector? (:datoms value))
                 (map? (:prefix-ranges value))
                 (= (count (:keys value)) (count (:datoms value))))
    (index-error! :invalid-index-data {}))
  value)

(defn- require-prefix!
  [index prefix]
  (when-not (and (vector? prefix) (<= (count prefix) index-width))
    (index-error! :invalid-prefix {}))
  (doseq [position (range (count prefix))]
    (let [role (nth (get index-components index) position)
          value (nth prefix position)]
      (case role
        :e (when-not (order/non-negative-id? value)
             (index-error! :invalid-entity-component
                           {:position position}))
        :tx (when-not (order/non-negative-id? value)
              (index-error! :invalid-transaction-component
                            {:position position}))
        :a (when-not (keyword? value)
             (index-error! :invalid-attribute-component
                           {:position position}))
        :v (do
             (order/value-order-key value)
             (when (and (= :vaet index)
                        (not (order/non-negative-id? value)))
               (index-error! :invalid-reference-component
                             {:position position}))))))
  (loop [position 0
         result []]
    (if (= position (count prefix))
      result
      (let [component (nth prefix position)]
        (recur
         (inc position)
         (conj result
               (if (= :tx (nth (get index-components index) position))
                 (order/value-order-key (- component))
                 (order/value-order-key component))))))))

(defn lower-bound
  "First key not before a structural partial prefix."
  ([keys prefix-order-key]
   (loop [low 0
          high (count keys)]
     (if (< low high)
       (let [middle (+ low (quot (- high low) 2))
             comparison
             (order/prefix-compare-order-keys
              (nth keys middle) prefix-order-key)]
         (if (neg? comparison)
           (recur (inc middle) high)
           (recur low middle)))
       low)))
  ([keys prefix-order-key comparison-counter]
   ;; Diagnostic arity: production calls the allocation-free two-argument
   ;; path; complexity gates use this counter without changing the algorithm.
   (loop [low 0
          high (count keys)]
     (if (< low high)
       (let [_ (swap! comparison-counter inc)
             middle (+ low (quot (- high low) 2))
             comparison
             (order/prefix-compare-order-keys
              (nth keys middle) prefix-order-key)]
         (if (neg? comparison)
           (recur (inc middle) high)
           (recur low middle)))
       low))))

(defn upper-bound
  "First key after a structural partial prefix."
  ([keys prefix-order-key]
   (loop [low 0
          high (count keys)]
     (if (< low high)
       (let [middle (+ low (quot (- high low) 2))
             comparison
             (order/prefix-compare-order-keys
              (nth keys middle) prefix-order-key)]
         (if (pos? comparison)
           (recur low middle)
           (recur (inc middle) high)))
       low)))
  ([keys prefix-order-key comparison-counter]
   (loop [low 0
          high (count keys)]
     (if (< low high)
       (let [_ (swap! comparison-counter inc)
             middle (+ low (quot (- high low) 2))
             comparison
             (order/prefix-compare-order-keys
              (nth keys middle) prefix-order-key)]
         (if (pos? comparison)
           (recur low middle)
           (recur (inc middle) high)))
       low))))

(defn seek
  [index-data prefix]
  (let [{:keys [index keys datoms]} (require-index-data! index-data)
        cached-range (get (:prefix-ranges index-data) prefix)
        prefix-order-key (when-not cached-range (require-prefix! index prefix))
        start (if cached-range (first cached-range)
                  (lower-bound keys prefix-order-key))]
    (subvec datoms start (count datoms))))

(defn rseek
  [index-data prefix]
  (let [{:keys [index keys datoms]} (require-index-data! index-data)
        cached-range (get (:prefix-ranges index-data) prefix)
        prefix-order-key (when-not cached-range (require-prefix! index prefix))
        start (dec (if cached-range (second cached-range)
                       (upper-bound keys prefix-order-key)))]
    (map #(nth datoms %) (range start -1 -1))))

(defn- require-chunk-size!
  [chunk-size]
  (when-not (and (integer? chunk-size)
                 (pos? chunk-size)
                 (<= chunk-size maximum-chunk-size))
    (index-error! :invalid-chunk-size
                  {:maximum-chunk-size maximum-chunk-size}))
  chunk-size)

(defn seek-chunk
  [index-data prefix chunk-size]
  (require-chunk-size! chunk-size)
  (let [{:keys [index keys datoms]} (require-index-data! index-data)
        cached-range (get (:prefix-ranges index-data) prefix)
        prefix-order-key (when-not cached-range (require-prefix! index prefix))
        start (if cached-range (first cached-range)
                  (lower-bound keys prefix-order-key))
        end (min (count datoms) (+ start chunk-size))]
    (subvec datoms start end)))

(defn seek-chunk-trusted
  "Bounded engine read after the owning database validated its index table."
  [index-data prefix chunk-size]
  (require-chunk-size! chunk-size)
  (let [{:keys [index keys datoms prefix-ranges]} index-data
        cached-range (get prefix-ranges prefix)
        prefix-order-key (when-not cached-range (require-prefix! index prefix))
        start (if cached-range (first cached-range)
                  (lower-bound keys prefix-order-key))
        end (min (count datoms) (+ start chunk-size))]
    (subvec datoms start end)))

(defn rseek-chunk
  [index-data prefix chunk-size]
  (require-chunk-size! chunk-size)
  (let [{:keys [index keys datoms]} (require-index-data! index-data)
        cached-range (get (:prefix-ranges index-data) prefix)
        prefix-order-key (when-not cached-range (require-prefix! index prefix))]
    (loop [position (dec (if cached-range (second cached-range)
                             (upper-bound keys prefix-order-key)))
           remaining chunk-size
           result []]
      (if (or (neg? position) (zero? remaining))
        result
        (recur (dec position) (dec remaining)
               (conj result (nth datoms position)))))))

(defn rseek-chunk-trusted
  "Bounded reverse engine read after database/index construction validation."
  [index-data prefix chunk-size]
  (require-chunk-size! chunk-size)
  (let [{:keys [index keys datoms prefix-ranges]} index-data
        cached-range (get prefix-ranges prefix)
        prefix-order-key (when-not cached-range (require-prefix! index prefix))]
    (loop [position (dec (if cached-range (second cached-range)
                             (upper-bound keys prefix-order-key)))
           remaining chunk-size
           result []]
      (if (or (neg? position) (zero? remaining))
        result
        (recur (dec position) (dec remaining)
               (conj result (nth datoms position)))))))
