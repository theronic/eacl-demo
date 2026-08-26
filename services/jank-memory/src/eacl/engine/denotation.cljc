(ns eacl.engine.denotation
  "Seek-only least-fixpoint authorization for fixed-subject discovery."
  (:require [eacl.engine.portable-indexed :as indexed]
            [eacl.execution :as execution]
            [eacl.request.context :as context]))

;; The frozen parser accepts positive unions of direct, self-permission,
;; arrow-relation, and arrow-permission rules. For that monotone subset, the
;; complete set of resources authorized for one fixed subject is the least
;; fixpoint below. Point checks retain the witness-producing V8 DFS machine.

(defn- acyclic-plan?
  [plan]
  (let [nodes (set (:nodes plan))
        edges
        (reduce
         (fn [result rule]
           (if (contains? #{:self-permission :arrow-permission} (:rule rule))
             (update result (:target-node rule) (fnil conj #{}) (:node rule))
             result))
         {} (:rules plan))
        indegrees
        (reduce
         (fn [result [_ successors]]
           (reduce #(update %1 %2 (fnil inc 0)) result successors))
         (zipmap nodes (repeat 0)) edges)
        ready (vec (filter #(zero? (get indegrees %)) nodes))]
    (loop [position 0
           queue ready
           remaining indegrees]
      (if (= position (count queue))
        (= (count queue) (count nodes))
        (let [node (nth queue position)
              [next-queue next-remaining]
              (reduce
               (fn [[queued degrees] successor]
                 (let [degree (dec (get degrees successor))]
                   [(if (zero? degree) (conj queued successor) queued)
                    (assoc degrees successor degree)]))
               [queue remaining] (get edges node #{}))]
          (recur (inc position) next-queue next-remaining))))))

(defn eligible?
  "Whether vectorized discovery preserves the configured scalar-limit scope.

  Cyclic permission graphs retain the scalar evaluator because its active-path
  cycle cuts and depth budget are observable semantics."
  [request-context plan]
  (and (= execution/default-scalar-limits
          (get-in (context/contract request-context) [:limits]))
       (<= (count (:nodes plan))
           (:max-depth execution/default-scalar-limits))
       (not (:recursive? plan))))

(defn empty-proof-eligible?
  "Whether a speculative positive least-fixpoint may certify only emptiness.

  Cyclic positive graphs can safely prove that no root state is reachable, but
  a non-empty result still falls back to the scalar machine so active-path and
  depth-limit behavior remain unchanged. Custom scalar limits always retain
  their exact scalar work boundary."
  [request-context plan]
  (and (= execution/default-scalar-limits
          (get-in (context/contract request-context) [:limits]))
       (<= (count (:nodes plan))
           (:max-depth execution/default-scalar-limits))))

(defn- dependencies
  [rules]
  (reduce
   (fn [result rule]
     (if (contains? #{:self-permission :arrow-permission} (:rule rule))
       (update result (:target-node rule) (fnil conj []) rule)
       result))
   {} rules))

(defn authorized-resource-eids!
  "Return the complete authorized EID set at the sealed plan root."
  [request-context plan subject-type subject-eid]
  (context/assert-open! request-context)
  (when-not (and (map? plan) (vector? (:rules plan))
                 (vector? (:nodes plan)) (vector? (:root plan)))
    (throw
     (ex-info "Invalid sealed plan for denotation evaluation."
              {:type :eacl.store/integrity-error
               :eacl/error :eacl.store/integrity-error
               :reason :invalid-sealed-plan})))
  (if-not subject-eid
    #{}
    (let [dependents (get-in plan [:indexes :denotation-dependents])
          root (:root plan)
          seen (volatile! (transient #{}))
          queue (volatile! (transient []))
          root-eids (volatile! (transient #{}))
          expansions (volatile! (transient {}))]
      (letfn
       [(add-eids! [node eids]
          (loop [remaining (seq eids)]
            (when remaining
              (let [pair [node (first remaining)]]
                (when-not (contains? @seen pair)
                  (context/consume! request-context :allocation-proxy)
                  (vreset! seen (conj! @seen pair))
                  (vreset! queue (conj! @queue pair))
                  (when (= node root)
                    (vreset! root-eids
                             (conj! @root-eids (first remaining)))))
                (recur (next remaining))))))

        (follow! [from-type from-eid relation-eid to-type]
          (let [key [from-type from-eid relation-eid to-type]]
            (if (contains? @expansions key)
              (get @expansions key)
              (let [resources
                    (indexed/subject->resources!
                     request-context from-type from-eid relation-eid to-type)]
                (vreset! expansions (assoc! @expansions key resources))
                resources))))

        (seed! [rule]
          (let [node (:node rule)
                resource-type (first node)]
            (context/cut-point! request-context :denotation-seed-rule)
            (context/consume! request-context :transitions)
            (case (:rule rule)
              :relation
              (when (= subject-type (:subject-type rule))
                (add-eids!
                 node
                 (follow! subject-type subject-eid (:relation-eid rule)
                          resource-type)))

              :arrow-relation
              (when (= subject-type (:target-subject-type rule))
                (let [intermediates
                      (follow!
                       subject-type subject-eid (:target-relation-eid rule)
                       (:intermediate-type rule))]
                  (loop [remaining (seq intermediates)]
                    (when remaining
                      (let [intermediate (first remaining)]
                        (add-eids!
                         node
                         (follow!
                          (:intermediate-type rule) intermediate
                          (:via-relation-eid rule) resource-type))
                        (recur (next remaining)))))))

              (:self-permission :arrow-permission) nil

              (throw
               (ex-info "Unsupported sealed rule in denotation engine."
                        {:type :eacl.store/integrity-error
                         :eacl/error :eacl.store/integrity-error
                         :reason :unknown-sealed-rule
                         :rule (:rule rule)})))))

        (propagate! [source-eid rule]
          (let [node (:node rule)]
            (context/consume! request-context :transitions)
            (case (:rule rule)
              :self-permission
              (add-eids! node [source-eid])

              :arrow-permission
              (add-eids!
               node
               (follow!
                (:intermediate-type rule) source-eid
                (:via-relation-eid rule) (first node)))

              (throw
               (ex-info "Invalid denotation dependency."
                        {:type :eacl.store/integrity-error
                         :eacl/error :eacl.store/integrity-error
                         :reason :invalid-denotation-dependency})))))]
        (doseq [rule (:rules plan)]
          (seed! rule))
        (loop [position 0]
          (when (< position (count @queue))
            (let [[node eid] (nth @queue position)]
              (context/cut-point!
               request-context :denotation-fixpoint-state)
              (doseq [rule (get dependents node [])]
                (propagate! eid rule))
              (recur (inc position)))))
        (persistent! @root-eids)))))
