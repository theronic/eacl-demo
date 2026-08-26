(ns eacl.engine.v8
  "Snapshot-bound scalar authorization over sealed positive-rule plans."
  (:require [eacl.domain :as eacl]
            [eacl.engine.portable-indexed :as indexed]
            [eacl.engine.sealed-plan :as sealed-plan]
            [eacl.request.context :as context]))

;; Semantic source: modules/eacl/src/eacl/engine/v8.cljc plus the sealed stable
;; route at frozen EACL commit 1cbf80c7aaf4bfcf2564d2bf30135794ff406383.
;; This is an ordinary-function, context-bound point kernel. It never re-enters
;; a public operation and never acquires or changes a snapshot.

(def engine-version 8)
(def ^:private demand-fields #{:subject :permission :resource})

(defn- authorization-error!
  [type reason data]
  (throw
   (ex-info
    "EACL scalar authorization failed."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn normalize-point-demand
  [demand]
  (when-not (and (map? demand)
                 (= demand-fields (set (keys demand))))
    (authorization-error! :eacl/invalid-request :invalid-point-demand
                          {:known-keys demand-fields}))
  (when-not (keyword? (:permission demand))
    (authorization-error! :eacl/invalid-request :invalid-permission
                          {:permission (:permission demand)}))
  (let [subject (eacl/normalize-object (:subject demand))
        resource (eacl/normalize-object (:resource demand))]
    (when (or (:relation subject) (:relation resource))
      (authorization-error! :eacl/invalid-request
                            :subject-relations-unsupported {}))
    {:subject subject
     :permission (:permission demand)
     :resource resource}))

(defn- strictly-increasing?
  [values]
  (every? true? (map < values (rest values))))

(defn- ordered-intermediates!
  [request-context resource-type resource-eid relation-eid intermediate-type]
  (let [values
        (indexed/resource->subjects!
         request-context resource-type resource-eid relation-eid
         intermediate-type)]
    (when-not (and (= (count values) (count (distinct values)))
                   (strictly-increasing? values))
      (authorization-error! :eacl.store/integrity-error
                            :unordered-or-duplicate-intermediates
                            {:relation-eid relation-eid}))
    values))

(defn- granted
  [coordinate witness]
  {:allowed? true :coordinate coordinate :witness witness
   ::complete? true})

(def ^:private denied {:allowed? false :coordinate nil :witness nil})

(defn- denied-result
  [complete?]
  (assoc denied ::complete? complete?))

(defn- completed-state-key
  [plan state]
  [(:fingerprint plan) state])

(defn- publish-completed-state!
  [request-context plan state result]
  ;; A positive result carries a complete witness. A negative result is shared
  ;; only when every child denial was complete and no active-path cycle cut
  ;; contributed to it. Both are independent of the DFS path and safe to reuse
  ;; across candidates in this immutable request.
  (context/install-memo!
   request-context :completed-states (completed-state-key plan state) result))

(defn- state-frame
  [node resource-eid subject-type subject-eid depth]
  {:state [node resource-eid subject-type subject-eid]
   :node node
   :resource-eid resource-eid
   :depth depth
   :phase :enter
   :position 0
   :denial-complete? true})

(defn- evaluate-state!
  "Explicit DFS machine. Recursive permission semantics do not consume the
  native call stack, which also keeps typed limit unwinding reliable on the
  pinned Jank compiler."
  [request-context plan subject-type subject-eid node resource-eid]
  (loop [stack [(state-frame node resource-eid subject-type subject-eid 0)]
         memo {}
         active #{}
         returned nil]
    (if (empty? stack)
      (do
        (when-not (map? returned)
          (authorization-error! :eacl.store/integrity-error
                                :missing-machine-result {}))
        returned)
      (let [frame (peek stack)
            state (:state frame)
            rules (get-in plan [:indexes :by-node (:node frame)])
            shared
            (when (and (= :enter (:phase frame))
                       (not (contains? memo state)))
              (context/memo-value
               request-context :completed-states
               (completed-state-key plan state)))]
        (case (:phase frame)
        :enter
        (do
          (context/check-depth! request-context (:depth frame))
          (cond
            (contains? memo state)
            (recur (pop stack) memo active (get memo state))

            (:found? shared)
            (recur (pop stack) memo active (:value shared))

            (contains? active state)
            (do
              (context/record! request-context :repeated-states)
              (recur (pop stack) memo active (denied-result false)))

            (not (vector? rules))
            (authorization-error! :eacl.store/integrity-error
                                  :missing-sealed-node {:node (:node frame)})

            :else
            (do
              (context/consume! request-context :allocation-proxy)
              (recur (conj (pop stack) (assoc frame :phase :rules))
                     memo (conj active state) nil))))

        :rules
        (let [position (:position frame)]
          (if (= position (count rules))
            (let [result (denied-result (:denial-complete? frame))
                  shareable? (::complete? result)
                  result (if shareable?
                           (publish-completed-state!
                            request-context plan state result)
                           result)]
              (recur (pop stack)
                     (if shareable? (assoc memo state result) memo)
                     (disj active state) result))
            (let [rule (nth rules position)]
              (context/consume! request-context :transitions)
              (case (:rule rule)
                :relation
                (if (and (= subject-type (:subject-type rule))
                         (indexed/direct-match!
                          request-context subject-type subject-eid
                          (:relation-eid rule) (first (:node rule))
                          (:resource-eid frame)))
                  (let [result
                        (granted
                         [position]
                         [{:kind :relation
                           :rule-ordinal (:ordinal rule)
                           :relation-eid (:relation-eid rule)
                           :resource-eid (:resource-eid frame)}])]
                    (let [result (publish-completed-state!
                                  request-context plan state result)]
                      (recur (pop stack) (assoc memo state result)
                             (disj active state) result)))
                  (recur (conj (pop stack)
                               (update frame :position inc))
                         memo active nil))

                :self-permission
                (let [parent (assoc frame :phase :await-self :rule rule)
                      child
                      (state-frame (:target-node rule) (:resource-eid frame)
                                   subject-type subject-eid
                                   (inc (:depth frame)))]
                  (recur (conj (pop stack) parent child)
                         memo active nil))

                :arrow-relation
                (if (not= subject-type (:target-subject-type rule))
                  (recur (conj (pop stack)
                               (update frame :position inc))
                         memo active nil)
                  (let [intermediates
                        (ordered-intermediates!
                         request-context (first (:node rule))
                         (:resource-eid frame) (:via-relation-eid rule)
                         (:intermediate-type rule))]
                    (recur
                     (conj (pop stack)
                           (assoc frame
                                  :phase :arrow-relation
                                  :rule rule
                                  :intermediates intermediates
                                  :intermediate-index 0))
                     memo active nil)))

                :arrow-permission
                (let [intermediates
                      (ordered-intermediates!
                       request-context (first (:node rule))
                       (:resource-eid frame) (:via-relation-eid rule)
                       (:intermediate-type rule))]
                  (recur
                   (conj (pop stack)
                         (assoc frame
                                :phase :arrow-permission
                                :rule rule
                                :intermediates intermediates
                                :intermediate-index 0))
                   memo active nil))

                (authorization-error! :eacl.store/integrity-error
                                      :unknown-sealed-rule {:rule rule})))))

        :await-self
        (let [rule (:rule frame)]
          (if (:allowed? returned)
            (do
              (context/consume! request-context :allocation-proxy)
              (let [result
                    (granted
                     (into [(:position frame)] (:coordinate returned))
                     (into [{:kind :self-permission
                             :rule-ordinal (:ordinal rule)
                             :resource-eid (:resource-eid frame)}]
                           (:witness returned)))]
                (let [result (publish-completed-state!
                              request-context plan state result)]
                  (recur (pop stack) (assoc memo state result)
                         (disj active state) result))))
            (recur (conj (pop stack)
                         (-> frame
                             (assoc :phase :rules
                                    :denial-complete?
                                    (and (:denial-complete? frame)
                                         (::complete? returned)))
                             (update :position inc)
                             (dissoc :rule)))
                   memo active nil)))

        :arrow-relation
        (let [index (:intermediate-index frame)
              intermediates (:intermediates frame)
              rule (:rule frame)]
          (if (= index (count intermediates))
            (recur (conj (pop stack)
                         (-> frame
                             (assoc :phase :rules)
                             (update :position inc)
                             (dissoc :rule :intermediates
                                     :intermediate-index)))
                   memo active nil)
            (let [intermediate (nth intermediates index)]
              (context/consume! request-context :transitions)
              (if (indexed/direct-match!
                   request-context subject-type subject-eid
                   (:target-relation-eid rule)
                   (:intermediate-type rule) intermediate)
                (do
                  (context/consume! request-context :allocation-proxy)
                  (let [result
                        (granted
                         [(:position frame) intermediate]
                         [{:kind :arrow-relation
                           :rule-ordinal (:ordinal rule)
                           :via-relation-eid (:via-relation-eid rule)
                           :target-relation-eid (:target-relation-eid rule)
                           :intermediate-eid intermediate
                           :resource-eid (:resource-eid frame)}])]
                    (let [result (publish-completed-state!
                                  request-context plan state result)]
                      (recur (pop stack) (assoc memo state result)
                             (disj active state) result))))
                (recur (conj (pop stack)
                             (update frame :intermediate-index inc))
                       memo active nil)))))

        :arrow-permission
        (let [index (:intermediate-index frame)
              intermediates (:intermediates frame)
              rule (:rule frame)]
          (if (= index (count intermediates))
            (recur (conj (pop stack)
                         (-> frame
                             (assoc :phase :rules)
                             (update :position inc)
                             (dissoc :rule :intermediates
                                     :intermediate-index)))
                   memo active nil)
            (let [intermediate (nth intermediates index)
                  parent
                  (assoc frame :phase :await-arrow-permission
                         :intermediate intermediate)
                  child
                  (state-frame (:target-node rule) intermediate
                               subject-type subject-eid
                               (inc (:depth frame)))]
              (context/consume! request-context :transitions)
              (recur (conj (pop stack) parent child)
                     memo active nil))))

        :await-arrow-permission
        (let [rule (:rule frame)
              intermediate (:intermediate frame)]
          (if (:allowed? returned)
            (do
              (context/consume! request-context :allocation-proxy)
              (let [result
                    (granted
                     (into [(:position frame) intermediate]
                           (:coordinate returned))
                     (into [{:kind :arrow-permission
                             :rule-ordinal (:ordinal rule)
                             :via-relation-eid (:via-relation-eid rule)
                             :intermediate-eid intermediate
                             :resource-eid (:resource-eid frame)}]
                           (:witness returned)))]
                (let [result (publish-completed-state!
                              request-context plan state result)]
                  (recur (pop stack) (assoc memo state result)
                         (disj active state) result))))
            (recur (conj (pop stack)
                         (-> frame
                             (assoc :phase :arrow-permission
                                    :denial-complete?
                                    (and (:denial-complete? frame)
                                         (::complete? returned)))
                             (update :intermediate-index inc)
                             (dissoc :intermediate)))
                   memo active nil)))

          (authorization-error! :eacl.store/integrity-error
                                :unknown-machine-phase
                                {:phase (:phase frame)}))))))

(defn prepare-point!
  "Validate and prepare one point demand without running graph traversal.

  The preparation includes the complete schema and dependency proof needed for
  a safe completed-answer cache key. It deliberately validates definitions
  before object lookup, so a missing object never masks an unknown definition."
  [request-context demand]
  (context/assert-open! request-context)
  (context/record! request-context :point-kernel-entries)
  (context/cut-point! request-context :point-normalization)
  (let [{:keys [subject permission resource]}
        (normalize-point-demand demand)
        _
        (when-not
         (sealed-plan/schema-definition-defined?
          request-context (:type subject))
          (authorization-error!
           :eacl/unknown-definition :unknown-definition
           {:operation :check-permission
            :definition (:type subject)
            :position :subject}))
        _
        (when-not
         (sealed-plan/schema-definition-defined?
          request-context (:type resource))
          (authorization-error!
           :eacl/unknown-definition :unknown-definition
           {:operation :check-permission
            :definition (:type resource)
            :position :resource}))
        plan (sealed-plan/prepared-plan!
              request-context (:type resource) permission)
        proof (sealed-plan/dependency-proof! request-context plan)
        subject-eid (indexed/object-eid! request-context (:id subject))
        resource-eid (indexed/object-eid! request-context (:id resource))
        basis (:basis (context/selection request-context))
        base {:subject subject
              :permission permission
              :resource resource
              :basis basis
              :schema-generation (context/schema-generation request-context)
              :dependency-proof proof
              :plan-fingerprint (:fingerprint plan)}]
    {:demand {:subject subject :permission permission :resource resource}
     :plan plan
     :subject-eid subject-eid
     :resource-eid resource-eid
     :base base}))

(defn- evaluate-prepared-result!
  "Return the internal scalar result without rendering diagnostics."
  [request-context prepared]
  (context/assert-open! request-context)
  (when-not (and (map? prepared)
                 (= #{:demand :plan :subject-eid :resource-eid :base}
                    (set (keys prepared))))
    (authorization-error! :eacl/invalid-request
                          :invalid-prepared-point {}))
  (let [{:keys [demand plan subject-eid resource-eid base]} prepared
        {:keys [subject permission resource]} demand]
    (if-not (and subject-eid resource-eid)
      denied
      (let [decision-key
            [(:fingerprint plan) subject-eid resource-eid (:type subject)]
            local (context/memo-value request-context :decisions decision-key)
            result
            (if (:found? local)
              (:value local)
              (context/install-memo!
               request-context :decisions decision-key
               (evaluate-state!
                request-context plan (:type subject) subject-eid
                [(:type resource) permission] resource-eid)))]
        result))))

(defn evaluate-prepared-allowed!
  "Fast internal projection used by batch/discovery orchestration."
  [request-context prepared]
  (boolean (:allowed? (evaluate-prepared-result! request-context prepared))))

(defn evaluate-prepared!
  "Run one completely prepared point demand in its owning request context."
  [request-context prepared]
  (let [result (evaluate-prepared-result! request-context prepared)
        base (:base prepared)
        missing? (not (and (:subject-eid prepared) (:resource-eid prepared)))]
    (merge base (dissoc result ::complete?)
           {:decision (if (:allowed? result) :allow :deny)
            :reason (cond missing? :missing-object
                          (:allowed? result) :witness
                          :else :exhausted)
            :counters (context/counters request-context)})))

(defn point-decision!
  "Evaluate one normalized point demand inside an existing request context."
  [request-context demand]
  (evaluate-prepared! request-context
                      (prepare-point! request-context demand)))

(def check-eids! point-decision!)
