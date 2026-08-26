(ns eacl.datomic.memory.order
  "Versioned, allocation-bounded total ordering for indexed store values.")

(def ordering-abi 2)
(def maximum-integer 9007199254740991)
(def minimum-integer (- maximum-integer))
(def maximum-string-length 65536)
(def maximum-keyword-component-length 1024)
(def maximum-tuple-depth 16)
(def maximum-tuple-entries 1024)

(defn- invalid-value!
  [reason data]
  (throw
   (ex-info
    "Value is outside the EACL memory-store ordering domain."
    (merge {:type :eacl.store/invalid-indexed-value
            :eacl/error :eacl.store/invalid-indexed-value
            :reason reason
            :ordering-abi ordering-abi}
           data))))

(defn non-negative-id?
  [value]
  (and (integer? value)
       (<= 0 value maximum-integer)))

(declare analyze-value)

(defn- analyze-vector
  [value depth entries]
  (when (> depth maximum-tuple-depth)
    (invalid-value! :tuple-too-deep
                    {:maximum-depth maximum-tuple-depth}))
  (loop [remaining (seq value)
         entries entries
         result []]
    (if-not remaining
      [entries [4 result]]
      (do
        (when (= entries maximum-tuple-entries)
          (invalid-value! :tuple-too-large
                          {:maximum-entries maximum-tuple-entries}))
        (let [[next-entries key]
              (analyze-value (first remaining) (inc depth) (inc entries))]
          (recur (next remaining) next-entries (conj result key)))))))

(defn- analyze-value
  [value depth entries]
  (cond
    (false? value) [entries [0 0]]
    (true? value) [entries [0 1]]

    (integer? value)
    (if (<= minimum-integer value maximum-integer)
      [entries [1 value]]
      (invalid-value! :integer-out-of-range
                      {:minimum minimum-integer :maximum maximum-integer}))

    (string? value)
    (if (<= (count value) maximum-string-length)
      [entries [2 value]]
      (invalid-value! :string-too-large
                      {:maximum-length maximum-string-length}))

    (keyword? value)
    (let [keyword-namespace (namespace value)
          keyword-name (name value)]
      (when (or (> (count keyword-name) maximum-keyword-component-length)
                (and keyword-namespace
                     (> (count keyword-namespace)
                        maximum-keyword-component-length)))
        (invalid-value! :keyword-too-large
                        {:maximum-component-length
                         maximum-keyword-component-length}))
      [entries
       (if keyword-namespace
         [3 1 keyword-namespace keyword-name]
         [3 0 "" keyword-name])])

    (vector? value)
    (analyze-vector value depth entries)

    :else
    (invalid-value! :unsupported-type {:value-type (str (type value))})))

(defn value-order-key
  "Return the structural ABI key for one supported scalar or nested tuple."
  [value]
  (second (analyze-value value 0 1)))

(declare compare-order-keys)

(defn- compare-components
  [left right]
  (if (and (vector? left) (vector? right))
    (compare-order-keys left right)
    (compare left right)))

(defn compare-order-keys
  "Lexicographically compare structural order keys, including nested tuples.

  Jank's native vector comparison is length-first. Datomic tuple prefixes need
  element-first lexicographic ordering so `[a b]` is immediately before
  `[a b c]` rather than before every three-element tuple."
  [left right]
  (loop [position 0]
    (let [left-count (count left)
          right-count (count right)]
      (cond
        (= position left-count)
        (if (= position right-count) 0 -1)

        (= position right-count) 1

        :else
        (let [comparison
              (compare-components (nth left position)
                                  (nth right position))]
          (if (zero? comparison)
            (recur (inc position))
            comparison))))))

(defn supported-value?
  [value]
  (try
    (value-order-key value)
    true
    (catch #?(:jank cpp/jank.runtime.object_ref
              :clj clojure.lang.ExceptionInfo)
           _
      false)))

(defn compare-values
  [left right]
  (compare-order-keys (value-order-key left) (value-order-key right)))

(declare prefix-compare-order-keys)

(defn- compare-order-key-prefix
  [key prefix]
  (if (and (= 4 (first key)) (= 4 (first prefix)))
    ;; Tuple values may themselves be partial. Their type tag is complete; the
    ;; element vector is a structural prefix of the complete tuple value.
    (prefix-compare-order-keys (second key) (second prefix))
    (compare-order-keys key prefix)))

(defn prefix-compare-order-keys
  "Compare a complete structural index key with a possibly partial one."
  [key prefix]
  (loop [position 0]
    (if (= position (count prefix))
      0
      (if (= position (count key))
        -1
        (let [comparison (compare-order-key-prefix
                          (nth key position)
                          (nth prefix position))]
          (if (zero? comparison)
            (recur (inc position))
            comparison))))))
