(ns eacl.engine.portable-decisions
  "Strict ordinary-function decisions extracted from the frozen portable kernel.")

;; Source basis: modules/eacl/src/eacl/engine/portable_decisions.cljc at
;; 1cbf80c7aaf4bfcf2564d2bf30135794ff406383. The DecisionKernel protocol and
;; record wrapper are intentionally omitted. Validation is executable here.

(def operations #{:indexed-scan-response :least-witness})

(defn- invalid!
  [reason data]
  (throw
   (ex-info
    "Invalid portable authorization decision input."
    (merge {:type :eacl.engine/invalid-decision-input
            :eacl/error :eacl.engine/invalid-decision-input
            :reason reason} data))))

(defn- closed-map!
  [value fields label]
  (when-not (and (map? value) (= fields (set (keys value))))
    (invalid! :invalid-shape {:label label :value value :fields fields}))
  value)

(defn- indexed-scan-response
  [input]
  (closed-map! input #{:command :response} :input)
  (let [command (closed-map! (:command input)
                             #{:request-id :chunk-size :bound}
                             :command)
        response (closed-map! (:response input)
                              #{:request-id :values :fetched-values :terminal?}
                              :response)
        values (:values response)
        rejection
        (cond
          (not (and (integer? (:request-id command))
                    (not (neg? (:request-id command))))) :invalid-request-id
          (not (and (integer? (:chunk-size command))
                    (pos? (:chunk-size command)))) :invalid-chunk-size
          (not= (:request-id command) (:request-id response))
          :mismatched-request
          (not (vector? values)) :invalid-values
          (> (count values) (:chunk-size command)) :oversized-chunk
          (not (boolean? (:terminal? response))) :invalid-terminal-marker
          (not= (:fetched-values response) (count values))
          :invalid-fetched-count)]
    (if rejection
      {:status :rejected :reason rejection}
      {:status :accepted
       :values values
       :terminal? (:terminal? response)
       :fetched-values (:fetched-values response)})))

(defn- witness-coordinate?
  [value]
  (and (vector? value)
       (every? #(and (integer? %) (not (neg? %))) value)))

(defn- least-witness
  [input]
  (closed-map! input #{:left :right} :input)
  (let [left (:left input) right (:right input)]
    (when-not (and (witness-coordinate? left)
                   (witness-coordinate? right))
      (invalid! :invalid-witness-coordinate {:left left :right right}))
    (if (neg? (compare left right)) left right)))

(defn decide
  [operation input]
  (when-not (contains? operations operation)
    (invalid! :unknown-operation
              {:operation operation :known-operations operations}))
  (case operation
    :indexed-scan-response (indexed-scan-response input)
    :least-witness (least-witness input)))
