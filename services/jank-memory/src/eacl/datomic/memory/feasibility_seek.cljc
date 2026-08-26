(ns eacl.datomic.memory.feasibility-seek
  "Early forward/reverse binary-seek slice for the hard Jank feasibility gate.")

(defn prefix-compare
  "Compare a complete index key to a possibly partial seek prefix."
  [key prefix]
  (loop [position 0]
    (if (= position (count prefix))
      0
      (if (= position (count key))
        -1
        (let [comparison (compare (nth key position)
                                  (nth prefix position))]
          (if (zero? comparison)
            (recur (inc position))
            comparison))))))

(defn lower-bound
  "Return the first index whose key is not before the partial prefix."
  [items prefix key-fn]
  (loop [low 0
         high (count items)]
    (if (< low high)
      (let [middle (+ low (quot (- high low) 2))
            comparison (prefix-compare (key-fn (nth items middle)) prefix)]
        (if (neg? comparison)
          (recur (inc middle) high)
          (recur low middle)))
      low)))

(defn upper-bound
  "Return the first index whose key is after the partial prefix."
  [items prefix key-fn]
  (loop [low 0
         high (count items)]
    (if (< low high)
      (let [middle (+ low (quot (- high low) 2))
            comparison (prefix-compare (key-fn (nth items middle)) prefix)]
        (if (pos? comparison)
          (recur low middle)
          (recur (inc middle) high)))
      low)))

(defn seek-chunk
  "Return at most chunk-size items from the first key at/after prefix."
  [items prefix key-fn chunk-size]
  (let [start (lower-bound items prefix key-fn)
        end (min (count items) (+ start chunk-size))]
    (subvec items start end)))

(defn rseek-chunk
  "Return at most chunk-size descending items from the last key at/before prefix."
  [items prefix key-fn chunk-size]
  (loop [position (dec (upper-bound items prefix key-fn))
         result []]
    (if (or (neg? position) (= (count result) chunk-size))
      result
      (recur (dec position) (conj result (nth items position))))))
