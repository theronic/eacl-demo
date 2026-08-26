(ns eacl.relationships.mutations
  "Closed normalization and conflict detection for relationship batches."
  (:require [eacl.domain :as eacl]))

(def maximum-updates 10000)

(defn relationship-key
  [{:keys [subject relation resource]}]
  [(:type subject) (:id subject) relation
   (:type resource) (:id resource)])

(defn normalize-batch
  [updates]
  (when-not (vector? updates)
    (throw
     (ex-info
      "Relationship updates must be a vector."
      {:type :eacl/invalid-relationship-update-batch
       :eacl/error :eacl/invalid-relationship-update-batch
       :reason :batch-must-be-vector})))
  (when (> (count updates) maximum-updates)
    (throw
     (ex-info
      "Relationship update batch is too large."
      {:type :eacl/invalid-relationship-update-batch
       :eacl/error :eacl/invalid-relationship-update-batch
       :reason :too-many-updates :maximum maximum-updates})))
  (loop [remaining (seq updates)
         operations {}
         result []]
    (if-not remaining
      result
      (let [update (eacl/normalize-relationship-update (first remaining))
            key (relationship-key (:relationship update))
            prior (get operations key)]
        (cond
          (and prior (not= prior (:operation update)))
          (throw
           (ex-info
            "Conflicting operations target one relationship."
            {:type :eacl/invalid-relationship-update-batch
             :eacl/error :eacl/invalid-relationship-update-batch
             :reason :conflicting-operations
             :operations [prior (:operation update)]}))

          prior
          (recur (next remaining) operations result)

          :else
          (recur (next remaining)
                 (assoc operations key (:operation update))
                 (conj result update)))))))
