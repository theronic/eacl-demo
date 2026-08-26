(ns eacl.engine.sealed-plan
  "Canonical schema plans and relation-stamp dependency descriptions."
  (:require [eacl.engine.portable-indexed :as indexed]
            [eacl.request.context :as context]
            [eacl.secure-format :as secure-format]
            #?(:jank [eacl.runtime.native.crypto :as crypto])))

;; Adapted from modules/eacl/src/eacl/engine/sealed_plan.cljc at frozen EACL
;; commit 1cbf80c7aaf4bfcf2564d2bf30135794ff406383. Adapter protocols and records
;; are replaced by context-bound seeks and immutable maps.

(def plan-version 1)
(def fingerprint-domain "eacl-jank.sealed-plan.v1")
(def ^:private relation-kind :eacl.schema/relation)
(def ^:private permission-kind :eacl.schema/permission)
(def ^:private relation-fields
  #{:db/id :eacl/id :eacl/schema-kind :eacl/schema-generation
    :eacl/relation-version
    :eacl.relation/resource-type+relation-name
    :eacl.relation/resource-type :eacl.relation/relation-name
    :eacl.relation/subject-type})
(def ^:private permission-fields
  #{:db/id :eacl/id :eacl/schema-kind :eacl/schema-generation
    :eacl.permission/resource-type+permission-name
    :eacl.permission/resource-type :eacl.permission/permission-name
    :eacl.permission/source-relation-name
    :eacl.permission/target-type :eacl.permission/target-name})

(defn- plan-error!
  [type reason data]
  (throw
   (ex-info
    "EACL permission plan compilation failed."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn- require-row!
  [row fields kind]
  (when-not (= fields (set (keys row)))
    (plan-error! :eacl.store/integrity-error :invalid-schema-row
                 {:schema-kind kind
                  :missing-keys (vec (remove #(contains? row %) fields))
                  :unknown-keys (vec (remove fields (keys row)))}))
  row)

(defn- matching-entities!
  [request-context attribute value]
  (mapv :e (indexed/scan-prefix! request-context :avet [attribute value])))

(defn relation-definitions!
  "Return zero or more validated relation rows from the selected snapshot."
  [request-context resource-type relation-name]
  (let [entities
        (matching-entities!
         request-context :eacl.relation/resource-type+relation-name
         [resource-type relation-name])
        rows
        (mapv
         (fn [entity]
           (context/record! request-context :definition-reads)
           (require-row! (indexed/entity-map! request-context entity)
                         relation-fields relation-kind))
         entities)]
    (doseq [row rows]
      (when-not (and (= relation-kind (:eacl/schema-kind row))
                     (= resource-type (:eacl.relation/resource-type row))
                     (= relation-name (:eacl.relation/relation-name row)))
        (plan-error! :eacl.store/integrity-error :misindexed-relation-row
                     {:entity (:db/id row)})))
    rows))

(defn relation-name-definitions!
  "Return every validated relation row carrying `relation-name`."
  [request-context relation-name]
  (let [entities
        (matching-entities!
         request-context :eacl.relation/relation-name relation-name)
        rows
        (mapv
         (fn [entity]
           (context/record! request-context :definition-reads)
           (require-row! (indexed/entity-map! request-context entity)
                         relation-fields relation-kind))
         entities)]
    (doseq [row rows]
      (when-not (and (= relation-kind (:eacl/schema-kind row))
                     (= relation-name
                        (:eacl.relation/relation-name row)))
        (plan-error! :eacl.store/integrity-error
                     :misindexed-relation-row
                     {:entity (:db/id row)})))
    rows))

(defn- relation-defs!
  [request-context resource-type relation-name]
  (let [rows (relation-definitions!
              request-context resource-type relation-name)]
    (when (empty? rows)
      (plan-error! :eacl/unknown-relation-or-permission :unknown-relation
                   {:definition resource-type
                    :relation-or-permission relation-name
                    :schema-kind :relation}))
    rows))

(defn permission-definitions!
  "Return zero or more validated permission rows from the selected snapshot."
  [request-context resource-type permission-name]
  (let [entities
        (matching-entities!
         request-context :eacl.permission/resource-type+permission-name
         [resource-type permission-name])
        rows
        (mapv
         (fn [entity]
           (context/record! request-context :definition-reads)
           (require-row! (indexed/entity-map! request-context entity)
                         permission-fields permission-kind))
         entities)]
    (doseq [row rows]
      (when-not (and (= permission-kind (:eacl/schema-kind row))
                     (= resource-type
                        (:eacl.permission/resource-type row))
                     (= permission-name
                        (:eacl.permission/permission-name row)))
        (plan-error! :eacl.store/integrity-error :misindexed-permission-row
                     {:entity (:db/id row)})))
    rows))

(defn- permission-defs!
  [request-context resource-type permission-name operation]
  (let [rows (permission-definitions!
              request-context resource-type permission-name)]
    (when (empty? rows)
      (plan-error!
       :eacl/unknown-relation-or-permission :unknown-permission
       {:operation operation
        :definition resource-type
        :relation-or-permission permission-name
        :schema-kind :permission}))
    rows))

(defn permission-root-defined?
  [request-context resource-type permission-name]
  (let [key [:permission-root resource-type permission-name]
        local (context/memo-value request-context :catalog-values key)]
    (if (:found? local)
      (:value local)
      (context/install-memo!
       request-context :catalog-values key
       (boolean
        (seq
         (matching-entities!
          request-context
          :eacl.permission/resource-type+permission-name
          [resource-type permission-name])))))))

(defn schema-definition-defined?
  "Whether the selected logical schema declares `definition`.

  Empty definitions have no relation or permission rows, so this must read the
  certified control entity rather than infer existence from derived catalogs."
  [request-context definition]
  (let [key :schema-definition-catalog
        local (context/memo-value request-context :catalog-values key)
        definitions
        (if (:found? local)
          (:value local)
          (let [control (indexed/object-eid!
                         request-context "eacl.schema/control")
                stored
                (when control
                  (indexed/entity-value!
                   request-context control :eacl/schema-definitions))
                valid?
                (or (and (zero? (context/schema-generation request-context))
                         (nil? stored))
                    (and (vector? stored)
                         (every? string? stored)))]
            (when-not valid?
              (plan-error! :eacl.store/integrity-error
                           :invalid-schema-definitions {}))
            (context/install-memo!
             request-context :catalog-values key (set (or stored [])))))]
    (contains? definitions (name definition))))

(defn- node-rules!
  [request-context [resource-type permission-name :as node] operation]
  (let [definitions
        (permission-defs!
         request-context resource-type permission-name operation)]
    (loop [remaining (seq definitions)
           rules []]
      (if-not remaining
        rules
        (let [definition (first remaining)
              source (:eacl.permission/source-relation-name definition)
              target-kind (:eacl.permission/target-type definition)
              target-name (:eacl.permission/target-name definition)
              compiled
              (cond
                (and (= :self source) (= :relation target-kind))
                (mapv
                 (fn [relation]
                   {:rule :relation
                    :node node
                    :relation-eid (:db/id relation)
                    :subject-type
                    (:eacl.relation/subject-type relation)})
                 (relation-defs! request-context resource-type target-name))

                (and (= :self source) (= :permission target-kind))
                [{:rule :self-permission
                  :node node
                  :target-node [resource-type target-name]}]

                (= :permission target-kind)
                (mapv
                 (fn [relation]
                   (let [intermediate
                         (:eacl.relation/subject-type relation)]
                     {:rule :arrow-permission
                      :node node
                      :via-relation-eid (:db/id relation)
                      :intermediate-type intermediate
                      :target-node [intermediate target-name]}))
                 (relation-defs! request-context resource-type source))

                (= :relation target-kind)
                (let [via (relation-defs! request-context resource-type source)]
                  (loop [via-rows (seq via)
                         result []]
                    (if-not via-rows
                      result
                      (let [via-row (first via-rows)
                            intermediate
                            (:eacl.relation/subject-type via-row)
                            targets
                            (relation-defs!
                             request-context intermediate target-name)
                            additions
                            (mapv
                             (fn [target]
                               {:rule :arrow-relation
                                :node node
                                :via-relation-eid (:db/id via-row)
                                :intermediate-type intermediate
                                :target-relation-eid (:db/id target)
                                :target-subject-type
                                (:eacl.relation/subject-type target)})
                             targets)]
                        (recur (next via-rows) (into result additions))))))

                :else
                (plan-error! :eacl.store/integrity-error
                             :unknown-permission-form
                             {:definition definition}))]
          (recur (next remaining) (into rules compiled)))))))

(defn- reachable-rules!
  [request-context root operation]
  (loop [frontier [root]
         visited #{}
         rules []]
    (if (empty? frontier)
      rules
      (let [node (first frontier)]
        (if (contains? visited node)
          (recur (subvec frontier 1) visited rules)
          (let [compiled (node-rules! request-context node operation)
                targets (vec (keep :target-node compiled))]
            (recur (into (subvec frontier 1) targets)
                   (conj visited node)
                   (into rules compiled))))))))

(defn- dependency-step!
  "Derive one permission node's relation scope without constructing rules.

  This intentionally traverses validated schema rows independently from the
  executable-rule compiler. The resulting closure can therefore certify that
  no storage descriptor projected from the sealed rules escaped the
  permission's schema dependency closure."
  [request-context [resource-type permission-name] operation]
  (let [definitions
        (permission-defs!
         request-context resource-type permission-name operation)]
    (loop [remaining (seq definitions)
           relation-eids []
           target-nodes []]
      (if-not remaining
        {:relation-eids relation-eids :target-nodes target-nodes}
        (let [definition (first remaining)
              source (:eacl.permission/source-relation-name definition)
              target-kind (:eacl.permission/target-type definition)
              target-name (:eacl.permission/target-name definition)]
          (cond
            (and (= :self source) (= :relation target-kind))
            (let [rows
                  (relation-defs!
                   request-context resource-type target-name)]
              (recur (next remaining)
                     (into relation-eids (map :db/id rows))
                     target-nodes))

            (and (= :self source) (= :permission target-kind))
            (recur (next remaining) relation-eids
                   (conj target-nodes [resource-type target-name]))

            (= :permission target-kind)
            (let [rows (relation-defs! request-context resource-type source)]
              (recur
               (next remaining)
               (into relation-eids (map :db/id rows))
               (into target-nodes
                     (map
                      (fn [row]
                        [(:eacl.relation/subject-type row) target-name])
                      rows))))

            (= :relation target-kind)
            (let [via-rows
                  (relation-defs! request-context resource-type source)
                  resolved
                  (loop [rows (seq via-rows)
                         ids []]
                    (if-not rows
                      ids
                      (let [via (first rows)
                            targets
                            (relation-defs!
                             request-context
                             (:eacl.relation/subject-type via)
                             target-name)]
                        (recur (next rows)
                               (into (conj ids (:db/id via))
                                     (map :db/id targets))))))]
              (recur (next remaining)
                     (into relation-eids resolved)
                     target-nodes))

            :else
            (plan-error! :eacl.store/integrity-error
                         :unknown-permission-form
                         {:definition definition})))))))

(defn- permission-dependency-closure!
  [request-context root operation]
  (loop [frontier [root]
         visited #{}
         relation-eids #{}]
    (if (empty? frontier)
      (vec (sort relation-eids))
      (let [node (first frontier)]
        (if (contains? visited node)
          (recur (subvec frontier 1) visited relation-eids)
          (let [step (dependency-step! request-context node operation)]
            (recur (into (subvec frontier 1) (:target-nodes step))
                   (conj visited node)
                   (into relation-eids (:relation-eids step)))))))))

(defn relation-ids
  "Return the canonical relation-definition ids named by a sealed plan."
  [plan]
  (->> (:rules plan)
       (mapcat
        (fn [rule]
          (keep rule [:relation-eid
                      :via-relation-eid
                      :target-relation-eid])))
       distinct
       sort
       vec))

(defn certify-plan-read-scope!
  "Reject a compiled plan that can read outside its independent closure."
  [plan dependency-relation-eids]
  (let [closure (set dependency-relation-eids)
        plan-relation-eids (relation-ids plan)
        outside (vec (remove closure plan-relation-eids))]
    (when (seq outside)
      (plan-error!
       :eacl.plan/compile-error
       :relation-outside-dependency-closure
       {:outside-relation-ids outside
        :plan-relation-ids plan-relation-eids
        :dependency-relation-ids (vec dependency-relation-eids)}))
    plan))

(defn- canonical-pairs
  [values]
  (sort-by first compare
           (mapv (fn [value]
                   [(secure-format/encode-canonical value) value])
                 values)))

(defn- assign-ordinals
  [rules]
  (let [pairs (vec (canonical-pairs rules))]
    (when-not (= (count pairs) (count (distinct (map first pairs))))
      (plan-error! :eacl.store/integrity-error :duplicate-sealed-rule {}))
    (mapv (fn [ordinal pair]
            (assoc (second pair) :ordinal ordinal))
          (range (count pairs)) pairs)))

(defn- plan-nodes
  [root rules]
  (mapv second
        (canonical-pairs (into #{root} (keep :target-node rules)))))

(defn- permission-edges
  [node->index rules]
  (vec
   (keep
    (fn [rule]
      (when (contains? #{:self-permission :arrow-permission} (:rule rule))
        {:from (get node->index (:target-node rule))
         :to (get node->index (:node rule))
         :cost (if (= :self-permission (:rule rule)) 0 1)}))
    rules)))

(defn- distances
  [node-count root-index edges]
  (loop [distance (assoc (vec (repeat node-count nil)) root-index 0)
         iterations 0]
    (when (> iterations node-count)
      (plan-error! :eacl.store/integrity-error
                   :uncertified-rank-fixpoint {}))
    (let [next-distance
          (reduce
           (fn [current edge]
             (let [head (nth current (:to edge))
                   old (nth current (:from edge))
                   candidate (when (some? head) (+ head (:cost edge)))]
               (if (and (some? candidate)
                        (or (nil? old) (< candidate old)))
                 (assoc current (:from edge) candidate)
                 current)))
           distance edges)]
      (if (= distance next-distance)
        distance
        (recur next-distance (inc iterations))))))

(def ^:private local-read-cost
  {:relation 1 :self-permission 0
   :arrow-relation 2 :arrow-permission 1})

(defn- rank-rules
  [rules node->index distance]
  (mapv
   (fn [rule]
     (let [remaining (nth distance (get node->index (:node rule)))]
       (when (nil? remaining)
         (plan-error! :eacl.store/integrity-error
                      :unreachable-plan-node {:node (:node rule)}))
       (assoc rule :rank (+ remaining (get local-read-cost (:rule rule))))))
   rules))

(defn- cyclic?
  [node-count edges]
  (let [outgoing (group-by :from edges)
        degrees
        (reduce (fn [result edge]
                  (update result (:to edge) (fnil inc 0)))
                {} edges)]
    (loop [degrees degrees
           stack (vec (remove #(pos? (get degrees % 0))
                              (range node-count)))
           sorted 0]
      (if (empty? stack)
        (< sorted node-count)
        (let [node (peek stack)
              next-state
              (reduce
               (fn [state edge]
                 (let [next-degrees (first state)
                       next-stack (second state)
                       degree (dec (get next-degrees (:to edge)))]
                   [(assoc next-degrees (:to edge) degree)
                    (if (zero? degree)
                      (conj next-stack (:to edge)) next-stack)]))
               [degrees (pop stack)]
               (get outgoing node []))]
          (recur (first next-state) (second next-state) (inc sorted)))))))

(defn- plan-indexes
  [rules]
  {:by-node
   (reduce
    (fn [result [node bucket]]
      (assoc result node (vec (sort-by (juxt :rank :ordinal) bucket))))
    {}
    (group-by :node rules))
   :denotation-dependents
   (reduce
    (fn [result rule]
      (if (contains? #{:self-permission :arrow-permission} (:rule rule))
        (update result (:target-node rule) (fnil conj []) rule)
        result))
    {} rules)})

(def ^:private fingerprint-rule-fields
  {:relation
   #{:rule :node :relation-eid :subject-type :ordinal :rank}
   :self-permission
   #{:rule :node :target-node :ordinal :rank}
   :arrow-permission
   #{:rule :node :via-relation-eid :intermediate-type :target-node
     :ordinal :rank}
   :arrow-relation
   #{:rule :node :via-relation-eid :intermediate-type
     :target-relation-eid :target-subject-type :ordinal :rank}})

(defn- fingerprint-rule
  "Return the closed, fixed-order wire record for one executable rule.

  The execution indexes are a deterministic projection of these records, so
  serializing the indexes again added no identity information.  The old
  generic whole-plan map encoding duplicated every rule through `:indexes`
  and dominated cold-plan allocation in Jank."
  [rule]
  (let [kind (:rule rule)]
    (when-not (= (get fingerprint-rule-fields kind) (set (keys rule)))
      (plan-error! :eacl.store/integrity-error
                   :invalid-sealed-rule-fingerprint-shape
                   {:rule-kind kind}))
    (case kind
      :relation
      [:relation (:ordinal rule) (:rank rule) (:node rule)
       (:relation-eid rule) (:subject-type rule)]

      :self-permission
      [:self-permission (:ordinal rule) (:rank rule) (:node rule)
       (:target-node rule)]

      :arrow-permission
      [:arrow-permission (:ordinal rule) (:rank rule) (:node rule)
       (:via-relation-eid rule) (:intermediate-type rule)
       (:target-node rule)]

      :arrow-relation
      [:arrow-relation (:ordinal rule) (:rank rule) (:node rule)
       (:via-relation-eid rule) (:intermediate-type rule)
       (:target-relation-eid rule) (:target-subject-type rule)]

      (plan-error! :eacl.store/integrity-error
                   :unknown-sealed-rule-fingerprint-shape
                   {:rule-kind kind}))))

(defn- fingerprint-records
  [plan]
  (vec
   (concat
    [[:header (:version plan) (:root plan)
      (count (:nodes plan)) (count (:rules plan))
      (:recursive? plan) (:dependency-relation-eids plan)]]
    (map-indexed (fn [ordinal node] [:node ordinal node]) (:nodes plan))
    (map fingerprint-rule (:rules plan)))))

(defn- fingerprint
  [plan]
  (let [encoded
        (secure-format/encode-canonical
         [fingerprint-domain (fingerprint-records plan)]
         {:maximum-size 16777216
          :maximum-depth 64
          :maximum-entries 1000000})]
    #?(:jank (crypto/sha-256 encoded)
       :clj encoded)))

(defn seal-plan!
  ([request-context root]
   (seal-plan! request-context root :check-permission))
  ([request-context root operation]
   (when-not (and (vector? root) (= 2 (count root))
                  (every? keyword? root))
     (plan-error! :eacl/invalid-request :invalid-permission-root
                  {:root root}))
   (context/cut-point! request-context :before-plan-seal)
   (let [certified-dependencies
         (permission-dependency-closure! request-context root operation)
         rules
         (assign-ordinals
          (reachable-rules! request-context root operation))
        nodes (plan-nodes root rules)
        node->index (into {} (map vector nodes (range (count nodes))))
        root-index (get node->index root)
        edges (permission-edges node->index rules)
        distance (distances (count nodes) root-index edges)
        ranked (rank-rules rules node->index distance)
        dependencies
        (vec
         (sort
          (into #{}
                (mapcat
                 (fn [rule]
                   (vec
                    (remove nil?
                            [(:relation-eid rule)
                             (:via-relation-eid rule)
                             (:target-relation-eid rule)])))
                 ranked))))
        base {:version plan-version
              :root root
              :rules ranked
              :nodes nodes
              :recursive? (cyclic? (count nodes) edges)
              :indexes (plan-indexes ranked)
              :dependency-relation-eids dependencies}
        sealed (assoc base :fingerprint (fingerprint base))
        sealed (certify-plan-read-scope!
                sealed certified-dependencies)]
     (context/record! request-context :seals)
     sealed)))

(def ^:private cache-kind ::plan-cache)
(def ^:private cache-fields #{::kind ::state ::maximum-entries})
(def ^:private atom-type (type (atom nil)))

(defn plan-cache
  ([] (plan-cache 256))
  ([maximum-entries]
   (when-not (and (integer? maximum-entries) (pos? maximum-entries))
     (plan-error! :eacl/invalid-config :invalid-plan-cache-limit {}))
   {::kind cache-kind
    ::state (atom {})
    ::maximum-entries maximum-entries}))

(defn plan-cache?
  [value]
  (and (map? value)
       (= cache-fields (set (keys value)))
       (= cache-kind (::kind value))
       (= atom-type (type (::state value)))
       (integer? (::maximum-entries value))
       (pos? (::maximum-entries value))))

(defn plan-cache-size
  [cache]
  (when-not (plan-cache? cache)
    (plan-error! :eacl/invalid-request :invalid-plan-cache {}))
  (count @(::state cache)))

(defn clear-plan-cache!
  [cache]
  (when-not (plan-cache? cache)
    (plan-error! :eacl/invalid-request :invalid-plan-cache {}))
  (let [before (count @(::state cache))]
    (reset! (::state cache) {})
    before))

(defn plan-cache-stats
  [cache]
  (when-not (plan-cache? cache)
    (plan-error! :eacl/invalid-request :invalid-plan-cache {}))
  {:size (count @(::state cache))
   :maximum-entries (::maximum-entries cache)})

(defn- trim-cache
  [cache entries]
  (if (<= (count entries) (::maximum-entries cache))
    entries
    (let [oldest (first (sort-by secure-format/encode-canonical
                                 (keys entries)))]
      (dissoc entries oldest))))

(defn prepared-plan!
  ([request-context resource-type permission]
   (prepared-plan!
    request-context resource-type permission :check-permission))
  ([request-context resource-type permission operation]
  (let [root [resource-type permission]
        local (context/memo-value request-context :prepared-roots root)]
    (if (:found? local)
      (do
        (context/record! request-context :prepared-root-hits)
        (:value local))
      (let [generation (context/schema-generation request-context)
            scope (context/source-scope request-context)
            cache (context/plan-cache request-context)
            key [(:store-id scope) (:lifecycle-id scope) generation root]
            candidate
            (if (and (pos? generation) (plan-cache? cache))
              (if-let [cached (get @(::state cache) key)]
                cached
                ;; Plan construction happens before entering any atom callback.
                ;; This is both retry-safe and avoids a pinned-Jank unwinder
                ;; defect when an exception crosses an indirect callback frame.
                (let [built (seal-plan! request-context root operation)]
                  (get
                   (swap! (::state cache)
                          #(if (contains? % key)
                             %
                             (trim-cache cache (assoc % key built))))
                   key)))
              ;; An unavailable certified generation can never authorize shared
              ;; reuse. The outer request memo still prevents amplification.
              (seal-plan! request-context root operation))]
        (context/install-memo!
         request-context :prepared-roots root candidate))))))

(defn dependency-proof!
  [request-context plan]
  (let [key (:fingerprint plan)
        local (context/memo-value request-context :dependency-proofs key)]
    (if (:found? local)
      (:value local)
      (let [basis (get-in (context/selection request-context) [:basis])
            stamps
            (mapv
             (fn [relation-eid]
               (context/record! request-context :generation-reads)
               (let [stamp
                     (indexed/entity-value!
                      request-context relation-eid :eacl/relation-version)]
                 (when-not (and (integer? stamp)
                                (not (neg? stamp))
                                (<= stamp basis))
                   (plan-error!
                    :eacl.cache/generation-unprepared
                    :invalid-relation-version
                    {:relation-eid relation-eid
                     :relation-version stamp
                     :native-revision basis}))
                 [relation-eid stamp]))
             (:dependency-relation-eids plan))
            proof
            {:schema-generation (context/schema-generation request-context)
             :relation-stamps stamps}]
        (context/install-memo!
         request-context :dependency-proofs key proof)))))
