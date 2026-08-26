(ns eacl.feasibility.portable-decision-slice
  "Feasibility extraction of pure decisions from frozen EACL PR #145.")

;; Source: modules/eacl/src/eacl/engine/portable_decisions.cljc at
;; 1cbf80c7aaf4bfcf2564d2bf30135794ff406383 (blob
;; eba49351452697ab7ad1bd2b4892e095a1145f7b). The namespace, protocol-backed
;; wrapper, and unrelated decisions are intentionally omitted; function bodies
;; below retain the frozen value semantics.

(defn- page-decision
  [{:keys [length request default-size maximum-size]}]
  (let [{:keys [first last after before]} request
        invalid
        (cond
          (and (not= :absent first) (not= :absent last)) :both-directions
          (and (not= :absent after) (not= :absent before)) :both-bounds
          (and (not= :absent after) (= :absent first)) :after-without-first
          (and (not= :absent before) (= :absent last)) :before-without-last
          (= :nil after) :nil-after
          (= :nil before) :nil-before)
        requested (cond
                    (number? first) first
                    (number? last) last
                    :else default-size)
        invalid (or invalid
                    (when (<= requested 0) :non-positive-size)
                    (when (or (zero? maximum-size)
                              (> requested maximum-size))
                      :oversized-page))]
    (if invalid
      {:status :invalid :reason invalid}
      (let [direction (if (= :absent last) :asc :desc)
            bound (if (= :asc direction) after before)
            bound (when (number? bound) bound)
            start (if (= :asc direction)
                    (if bound (min length (inc bound)) 0)
                    (let [end (if bound (min length bound) length)]
                      (max 0 (- end requested))))
            end (if (= :asc direction)
                  (min length (+ start requested))
                  (if bound (min length bound) length))]
        {:status :valid
         :direction direction
         :size requested
         :start start
         :end end
         :has-next? (< end length)
         :has-previous? (pos? start)}))))

(defn- keyset-page-decision
  [{:keys [direction size bound? realized-count]}]
  (let [take-count (min size realized-count)
        any? (pos? take-count)
        sentinel? (> realized-count size)]
    {:take-count take-count
     :reverse? (= :desc direction)
     :has-next? (and any? (if (= :asc direction) sentinel? bound?))
     :has-previous? (and any? (if (= :asc direction) bound? sentinel?))}))

(defn- continuation-decision
  [{:keys [authenticated? scope-matches? expired? source cursor-source
           current-proof cursor-proof cursor-graph exact]}]
  (cond
    (not authenticated?) :invalid-authentication
    (or (not scope-matches?) (not= source cursor-source)) :scope-mismatch
    expired? :expired
    (= current-proof cursor-proof) :current
    (nil? exact) :snapshot-unavailable
    (or (not= (:graph exact) cursor-graph)
        (not= (:source exact) cursor-source)
        (not= (:proof exact) cursor-proof)) :history-divergence
    :else :exact))

(defn- consistency-plan
  [{:keys [mode capability-supported?]}]
  (cond
    (not capability-supported?)
    (case mode
      :minimize-latency :unsupported-capability
      :at-exact-snapshot :exact-snapshot-unavailable
      :unsupported-head-barrier)
    :else
    (case mode
      :minimize-latency :select-current
      :fully-consistent :select-authoritative
      :at-least-as-fresh :authenticate-and-select-at-least
      :at-exact-snapshot :authenticate-and-select-exact)))

(defn- consistency-validation
  [{:keys [kind selection-present? selected-adapter?
           same-source-scope? revision-satisfied?]}]
  (cond
    (not selection-present?)
    (if (= :exact kind) :exact-snapshot-unavailable :invalid-selected-adapter)
    (not selected-adapter?) :invalid-selected-adapter
    (not same-source-scope?) :incomparable-scope
    (and (contains? #{:at-least :exact} kind) (not revision-satisfied?))
    :history-divergence
    :else :accept))

(defn- merge-step
  [{:keys [direction left-head right-head]}]
  (cond
    (nil? left-head) :left-exhausted
    (nil? right-head) :right-exhausted
    (= left-head right-head) :take-both
    (if (= :asc direction)
      (< left-head right-head)
      (> left-head right-head)) :take-left
    :else :take-right))

(defn- merge-chunk
  [{:keys [direction left right]}]
  (loop [li 0 ri 0 values []]
    (if (or (= li (count left)) (= ri (count right)))
      {:values values :left-consumed li :right-consumed ri}
      (let [l (nth left li)
            r (nth right ri)]
        (cond
          (= l r) (recur (inc li) (inc ri) (conj values l))
          (if (= :asc direction) (< l r) (> l r))
          (recur (inc li) ri (conj values l))
          :else (recur li (inc ri) (conj values r)))))))

(defn- acyclic-count
  [{:keys [unique-count more? limit]}]
  (let [limited? (some? limit)]
    {:count (if (and limited? (< limit unique-count)) limit unique-count)
     :truncated? (boolean
                  (and limited?
                       (or (< limit unique-count)
                           (and (= limit unique-count) more?))))
     :recursive-work 0}))

(defn- scan-rejection
  [command response]
  (let [values (:values response)
        bound (get-in command [:projection :bound-eid])]
    (cond
      (not= (:request-scope command) (:request-scope response))
      :mismatched-request-scope
      (not= (:request-id command) (:request-id response)) :mismatched-request
      (> (count values) (:chunk-size command)) :oversized-chunk
      (if (:terminal? response)
        (not= (:fetched-values response) (count values))
        (not= (:fetched-values response) (inc (count values))))
      :invalid-fetched-count
      (and (not (:terminal? response)) (empty? values))
      :non-progressing-response
      (not-every? #(and (integer? %) (not (neg? %))) values) :invalid-eid
      (not (every? true? (map < values (rest values)))) :out-of-order
      (and bound (not-every? #(< bound %) values)) :bound-violation)))

(defn- indexed-scan-decision
  [{:keys [command response]}]
  (if-let [reason (scan-rejection command response)]
    {:status :rejected :reason reason}
    {:status :accepted
     :values (:values response)
     :terminal? (:terminal? response)
     :fetched-values (:fetched-values response)}))

(defn decide
  [operation input]
  (case operation
    :relationship-page (page-decision input)
    :relationship-keyset-page (keyset-page-decision input)
    :cursor-continuation (continuation-decision input)
    :consistency-plan (consistency-plan input)
    :consistency-validation (consistency-validation input)
    :ordered-merge-step (merge-step input)
    :ordered-merge-chunk (merge-chunk input)
    :acyclic-count (acyclic-count input)
    :indexed-scan-response (indexed-scan-decision input)))
