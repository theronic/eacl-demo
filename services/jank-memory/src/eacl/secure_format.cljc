(ns eacl.secure-format
  "Bounded canonical binary value codec represented as lowercase hex."
  #?(:jank
     (:require [eacl.runtime.native.encoding :as native-encoding])))

;; This is a Jank-safe replacement for the EDN-reader codec in frozen
;; modules/eacl/src/eacl/secure_format.cljc. The pinned Jank standard library
;; has no clojure.edn module, so the wire representation is an explicit TLV
;; grammar rather than text read by a general reader.

(def canonical-version 1)
(def default-maximum-size 65536)
(def default-maximum-depth 32)
(def default-maximum-entries 16384)
(def maximum-safe-integer 9007199254740991)
(def minimum-safe-integer (- maximum-safe-integer))

(def ^:private hex-digits "0123456789abcdef")
(def ^:private tags
  {:nil 0
   :false 1
   :true 2
   :integer 3
   :string 4
   :keyword 5
   :vector 6
   :map 7
   :set 8})

(defn- format-error!
  [reason data]
  (throw
   (ex-info
    "Invalid EACL secure format."
    (merge {:type :eacl.format/invalid
            :eacl/error :eacl.format/invalid
            :reason reason}
           data))))

(defn- require-limits!
  [{:keys [maximum-size maximum-depth maximum-entries] :as limits}]
  (doseq [[field value]
          [[:maximum-size maximum-size]
           [:maximum-depth maximum-depth]
           [:maximum-entries maximum-entries]]]
    (when-not (and (integer? value) (pos? value))
      (format-error! :invalid-limit {:field field :value value})))
  limits)

(defn- limits
  [overrides]
  (require-limits!
   {:maximum-size (or (:maximum-size overrides) default-maximum-size)
    :maximum-depth (or (:maximum-depth overrides) default-maximum-depth)
    :maximum-entries (or (:maximum-entries overrides)
                         default-maximum-entries)}))

(defn- byte->hex
  [value]
  (when-not (and (integer? value) (<= 0 value 255))
    (format-error! :invalid-byte {}))
  (str (subs hex-digits (quot value 16) (inc (quot value 16)))
       (subs hex-digits (bit-and value 15) (inc (bit-and value 15)))))

(defn- hex-nibble
  [value]
  (case value
    "0" 0 "1" 1 "2" 2 "3" 3 "4" 4 "5" 5 "6" 6 "7" 7
    "8" 8 "9" 9 "a" 10 "b" 11 "c" 12 "d" 13 "e" 14 "f" 15
    (format-error! :malformed {})))

(defn- read-byte
  [encoded position]
  (when (> (+ position 2) (count encoded))
    (format-error! :truncated {}))
  [(+ (* 16 (hex-nibble (subs encoded position (inc position))))
      (hex-nibble (subs encoded (inc position) (+ position 2))))
   (+ position 2)])

(defn- encode-varuint
  [value]
  (when-not (and (integer? value) (not (neg? value)))
    (format-error! :invalid-integer {}))
  (loop [remaining value
         encoded ""]
    ;; Pinned Jank's `mod` returns a small_real even for integer operands.
    ;; Power-of-two masks preserve the exact integer representation required
    ;; by byte indexing and canonical varuint arithmetic.
    (let [low (bit-and remaining 127)
          rest-value (quot remaining 128)]
      (if (zero? rest-value)
        (str encoded (byte->hex low))
        (recur rest-value (str encoded (byte->hex (+ 128 low))))))))

(defn- read-varuint
  [encoded position]
  (let [start position]
    (loop [position position
           ;; Force arbitrary-precision loop slots from the first iteration.
           ;; Pinned Jank otherwise specializes a small-integer recur slot and
           ;; silently wraps the multiplier at 2^32.
           multiplier (bigint 1)
           value (bigint 0)
           octets 0]
      (when (= octets 9)
        (format-error! :integer-out-of-range {}))
      (let [[byte next-position] (read-byte encoded position)
            next-value (+ value (* (bit-and byte 127) multiplier))]
        (when (> next-value (* 2 maximum-safe-integer))
          (format-error! :integer-out-of-range {}))
        (if (< byte 128)
          (do
            (when-not (= (subs encoded start next-position)
                         (encode-varuint next-value))
              (format-error! :non-canonical {}))
            [next-value next-position])
          (recur next-position (* multiplier 128) next-value (inc octets)))))))

(defn- encode-text
  [value maximum-size]
  (when-not (string? value)
    (format-error! :unsupported-value {}))
  (when (> (count value) maximum-size)
    (format-error! :too-large {:maximum-size maximum-size}))
  (let [hex #?(:jank (native-encoding/utf8->hex value)
               :clj (format-error! :unsupported-runtime {}))
        size (quot (count hex) 2)]
    (str (encode-varuint size) hex)))

(defn- decode-text
  [encoded position]
  (let [[size position] (read-varuint encoded position)
        end (+ position (* size 2))]
    (when (> end (count encoded))
      (format-error! :truncated {}))
    [#?(:jank (native-encoding/hex->utf8 (subs encoded position end))
        :clj (format-error! :unsupported-runtime {}))
     end]))

(declare encode-node)

(defn- require-depth!
  [depth {:keys [maximum-depth]}]
  (when (> depth maximum-depth)
    (format-error! :too-deep {:maximum-depth maximum-depth})))

(defn- require-entry-count!
  [entries {:keys [maximum-entries]}]
  (when (> entries maximum-entries)
    (format-error! :too-many-entries {:maximum-entries maximum-entries})))

(defn- require-encoded-size!
  [encoded {:keys [maximum-size]}]
  (when (> (quot (count encoded) 2) maximum-size)
    (format-error! :too-large {:maximum-size maximum-size}))
  encoded)

(defn- encode-children-bounded
  [values depth limits]
  ;; Consume at most maximum-entries children. This preserves the frozen
  ;; codec's finite sequential-value support without hanging on an infinite
  ;; lazy sequence or retaining more than the configured wire-size budget.
  (loop [remaining (seq values)
         children []
         child-count 0
         entries 0
         encoded-characters 0]
    (if-not remaining
      children
      (do
        (when (>= child-count (:maximum-entries limits))
          (format-error! :too-many-entries
                         {:maximum-entries (:maximum-entries limits)}))
        (let [child (encode-node (first remaining) depth limits)
              next-entries (+ entries (:entries child))
              next-characters (+ encoded-characters (count (:hex child)))]
          (require-entry-count! (inc next-entries) limits)
          (when (> (quot next-characters 2) (:maximum-size limits))
            (format-error! :too-large
                           {:maximum-size (:maximum-size limits)}))
          (recur (next remaining)
                 (conj children child)
                 (inc child-count)
                 next-entries
                 next-characters))))))

(defn- combine-children
  [tag children limits]
  (let [entries (+ 1 (reduce + 0 (map :entries children)))]
    (require-entry-count! entries limits)
    (let [encoded (str (byte->hex tag)
                       (encode-varuint (count children))
                       (apply str (map :hex children)))]
      (require-encoded-size! encoded limits)
      {:hex encoded
       :entries entries})))

(defn- encode-node
  [value depth limits]
  (require-depth! depth limits)
  (let [tag #(byte->hex (get tags %))
        result
        (cond
      (nil? value) {:hex (tag :nil) :entries 1}
      (false? value) {:hex (tag :false) :entries 1}
      (true? value) {:hex (tag :true) :entries 1}

      (integer? value)
      (do
        (when-not (<= minimum-safe-integer value maximum-safe-integer)
          (format-error! :integer-out-of-range
                         {:minimum minimum-safe-integer
                          :maximum maximum-safe-integer}))
        {:hex (str (tag :integer)
                   (encode-varuint
                    (if (neg? value)
                      (dec (* (bigint -2) (bigint value)))
                      (* (bigint 2) (bigint value)))))
         :entries 1})

      (string? value)
      {:hex (str (tag :string) (encode-text value (:maximum-size limits)))
       :entries 1}

      (keyword? value)
      (let [keyword-namespace (namespace value)
            keyword-name (name value)
            reconstructed (if keyword-namespace
                            (keyword keyword-namespace keyword-name)
                            (keyword keyword-name))]
        (when-not (= value reconstructed)
          (format-error! :ambiguous-keyword {}))
        {:hex (str (tag :keyword)
                   (byte->hex (if keyword-namespace 1 0))
                   (when keyword-namespace
                     (encode-text keyword-namespace (:maximum-size limits)))
                   (encode-text keyword-name (:maximum-size limits)))
         :entries 1})

      (or (vector? value) (sequential? value))
      (combine-children
       (get tags :vector)
       (encode-children-bounded value (inc depth) limits)
       limits)

      (map? value)
      (let [children (encode-children-bounded
                      (mapcat identity value) (inc depth) limits)
            pairs (->> children
                       (partition 2)
                       (sort-by (comp :hex first)))
            _ (loop [remaining (seq pairs)
                     previous-key nil]
                (when remaining
                  (let [key-hex (:hex (first (first remaining)))]
                    (when (= previous-key key-hex)
                      (format-error! :non-canonical-key {}))
                    (recur (next remaining) key-hex))))
            children (into [] (mapcat identity) pairs)
            entries (+ 1 (reduce + 0 (map :entries children)))]
        (require-entry-count! entries limits)
        (let [encoded (str (tag :map)
                           (encode-varuint (count pairs))
                           (apply str (map :hex children)))]
          (require-encoded-size! encoded limits)
          {:hex encoded
           :entries entries}))

      (set? value)
      (let [children
            (->> (encode-children-bounded value (inc depth) limits)
                 (sort-by :hex))
            _ (loop [remaining (seq children)
                     previous nil]
                (when remaining
                  (let [item-hex (:hex (first remaining))]
                    (when (= previous item-hex)
                      (format-error! :non-canonical-value {}))
                    (recur (next remaining) item-hex))))]
        (combine-children (get tags :set) children limits))

      :else
      (format-error! :unsupported-value {:value-type (str (type value))}))]
    (require-encoded-size! (:hex result) limits)
    result))

(defn encode-canonical
  ([value]
   (encode-canonical value {}))
  ([value overrides]
   (let [limits (limits overrides)
         encoded (:hex (encode-node value 0 limits))]
     (require-encoded-size! encoded limits)
     encoded)))

(declare decode-node)

(defn- ensure-next-entry
  [entries limits]
  (let [next-entries (inc entries)]
    (require-entry-count! next-entries limits)
    next-entries))

(defn- decode-vector
  [encoded position depth entries limits]
  (let [[size position] (read-varuint encoded position)]
    (when (> size (:maximum-entries limits))
      (format-error! :too-many-entries
                     {:maximum-entries (:maximum-entries limits)}))
    (loop [remaining size
           position position
           entries entries
           result []]
      (if (zero? remaining)
        [result position entries]
        (let [[value position entries]
              (decode-node encoded position (inc depth) entries limits)]
          (recur (dec remaining) position entries (conj result value)))))))

(defn- decode-map
  [encoded position depth entries limits]
  (let [[size position] (read-varuint encoded position)]
    (when (> (* 2 size) (:maximum-entries limits))
      (format-error! :too-many-entries
                     {:maximum-entries (:maximum-entries limits)}))
    (loop [remaining size
           position position
           entries entries
           previous-key-hex nil
           result {}]
      (if (zero? remaining)
        [result position entries]
        (let [key-start position
              [key position entries]
              (decode-node encoded position (inc depth) entries limits)
              key-hex (subs encoded key-start position)
              _ (when (and previous-key-hex
                           (not (neg? (compare previous-key-hex key-hex))))
                  (format-error! :non-canonical {}))
              _ (when (contains? result key)
                  (format-error! :duplicate-key {}))
              [value position entries]
              (decode-node encoded position (inc depth) entries limits)]
          (recur (dec remaining) position entries key-hex
                 (assoc result key value)))))))

(defn- decode-set
  [encoded position depth entries limits]
  (let [[size position] (read-varuint encoded position)]
    (when (> size (:maximum-entries limits))
      (format-error! :too-many-entries
                     {:maximum-entries (:maximum-entries limits)}))
    (loop [remaining size
           position position
           entries entries
           previous-hex nil
           result #{}]
      (if (zero? remaining)
        [result position entries]
        (let [start position
              [value position entries]
              (decode-node encoded position (inc depth) entries limits)
              item-hex (subs encoded start position)]
          (when (and previous-hex
                     (not (neg? (compare previous-hex item-hex))))
            (format-error! :non-canonical {}))
          (when (contains? result value)
            (format-error! :duplicate-value {}))
          (recur (dec remaining) position entries item-hex
                 (conj result value)))))))

(defn- decode-node
  [encoded position depth entries limits]
  (require-depth! depth limits)
  (let [entries (ensure-next-entry entries limits)
        [tag position] (read-byte encoded position)]
    (case tag
      0 [nil position entries]
      1 [false position entries]
      2 [true position entries]
      3 (let [[zigzag position] (read-varuint encoded position)
              value (if (odd? zigzag)
                      (- (quot (inc zigzag) 2))
                      (quot zigzag 2))]
          (when-not (<= minimum-safe-integer value maximum-safe-integer)
            (format-error! :integer-out-of-range {}))
          [value position entries])
      4 (let [[value position] (decode-text encoded position)]
          [value position entries])
      5 (let [[namespace-flag position] (read-byte encoded position)
              _ (when-not (contains? #{0 1} namespace-flag)
                  (format-error! :malformed-keyword {}))
              [keyword-namespace position]
              (if (= 1 namespace-flag)
                (decode-text encoded position)
                [nil position])
              [keyword-name position] (decode-text encoded position)
              value (if keyword-namespace
                      (keyword keyword-namespace keyword-name)
                      (keyword keyword-name))]
          (when-not (and value
                         (= keyword-namespace (namespace value))
                         (= keyword-name (name value)))
            (format-error! :malformed-keyword {}))
          [value position entries])
      6 (decode-vector encoded position depth entries limits)
      7 (decode-map encoded position depth entries limits)
      8 (decode-set encoded position depth entries limits)
      (format-error! :unknown-tag {:tag tag}))))

(defn decode-canonical
  ([encoded]
   (decode-canonical encoded {}))
  ([encoded overrides]
   (let [limits (limits overrides)]
     (when-not (and (string? encoded)
                    #?(:jank (native-encoding/hex-string? encoded)
                       :clj false))
       (format-error! :malformed {}))
     (when (> (quot (count encoded) 2) (:maximum-size limits))
       (format-error! :too-large {:maximum-size (:maximum-size limits)}))
     (try
       (let [[value position _] (decode-node encoded 0 0 0 limits)]
         (when-not (= position (count encoded))
           (format-error! :trailing-data {}))
         (when-not (= encoded (encode-canonical value limits))
           (format-error! :non-canonical {}))
         (when-let [allowed-keys (:allowed-keys overrides)]
           (when (or (not (map? value))
                     (not= (set allowed-keys) (set (keys value))))
             (format-error! :unknown-fields
                            {:allowed-keys (set allowed-keys)})))
         value)
       (catch #?(:jank cpp/jank.runtime.object_ref
                 :clj clojure.lang.ExceptionInfo)
              error
         (if (= :eacl.format/invalid (:type (ex-data error)))
           (throw error)
           (format-error! :malformed {})))))))

(defn canonicalize
  "Validates a supported value and returns the codec's canonical collection
  representation. Sequential values normalize to vectors."
  ([value]
   (canonicalize value {}))
  ([value overrides]
   (decode-canonical (encode-canonical value overrides) overrides)))
