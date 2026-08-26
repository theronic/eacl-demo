(ns eacl.engine.permission-tree
  "Snapshot-bound shallow permission-tree expansion with explicit work frames."
  (:require [eacl.domain :as domain]
            [eacl.engine.portable-indexed :as indexed]
            [eacl.engine.sealed-plan :as sealed-plan]
            [eacl.request.context :as context]))

(def default-limits
  {:max-depth 50
   :max-schema-components 100000
   :max-relationship-values 100000
   :max-tree-nodes 100000
   :max-leaf-subjects 100000})
(def limit-keys (set (keys default-limits)))

(defn- fail!
  [type reason data]
  (throw
   (ex-info
    "EACL permission-tree expansion failed."
    (merge {:type type :eacl/error type
            :operation :expand-permission-tree :reason reason}
           data))))

(defn normalize-limits
  [overrides]
  (let [overrides (if (nil? overrides) {} overrides)]
    (when-not (map? overrides)
      (fail! :eacl/invalid-config :invalid-permission-tree-limits
             {:value overrides}))
    (let [unknown (vec (remove limit-keys (keys overrides)))]
      (when (seq unknown)
        (fail! :eacl/invalid-config :unknown-permission-tree-limit
               {:unknown-keys unknown :known-keys limit-keys})))
    (when-not (every? (fn [[_ value]]
                        (and (integer? value) (pos? value)))
                      overrides)
      (fail! :eacl/invalid-config :invalid-permission-tree-limit
             {:value overrides}))
    (merge default-limits overrides)))

(defn- consume!
  [limits counters dimension amount]
  (let [limit-key
        (case dimension
          :schema-components :max-schema-components
          :relationship-values :max-relationship-values
          :tree-nodes :max-tree-nodes
          :leaf-subjects :max-leaf-subjects)
        actual (+ (get @counters dimension 0) amount)
        limit (get limits limit-key)]
    (when (> actual limit)
      (fail! :eacl.permission-tree/limit-exceeded
             :structural-limit-exceeded
             {:dimension limit-key :limit limit :actual actual
              :consumed-work @counters}))
    (swap! counters update dimension + amount)))

(defn- check-depth!
  [limits depth counters]
  (when (> depth (:max-depth limits))
    (fail! :eacl.permission-tree/limit-exceeded :maximum-depth-exceeded
           {:dimension :max-depth :limit (:max-depth limits)
            :actual depth :consumed-work @counters})))

(defn- render-eid!
  [request-context type entity]
  (let [external-id
        (indexed/entity-value! request-context entity :eacl/id)]
    (when-not (and (string? external-id) (not (empty? external-id)))
      (fail! :eacl.store/integrity-error
             :missing-external-object-identity {:object-type type}))
    (domain/spice-object type external-id)))

(defn- relation-descriptors
  [request-context resource-type relation-name counters limits]
  (let [rows
        (sealed-plan/relation-definitions!
         request-context resource-type relation-name)]
    (consume! limits counters :schema-components (count rows))
    (mapv
     (fn [row]
       {:relation-eid (:db/id row)
        :subject-type (:eacl.relation/subject-type row)})
     rows)))

(defn- permission-definitions
  [request-context resource-type permission-name counters limits]
  (let [rows
        (sealed-plan/permission-definitions!
         request-context resource-type permission-name)]
    (consume! limits counters :schema-components (count rows))
    rows))

(defn- scan-relation!
  [request-context resource descriptors leaf? counters limits]
  (if (nil? (:eid resource))
    []
    (loop [remaining (seq descriptors)
           result []]
      (if-not remaining
        result
        (let [descriptor (first remaining)
              entities
              (indexed/resource->subjects!
               request-context (:type resource) (:eid resource)
               (:relation-eid descriptor) (:subject-type descriptor))
              _ (consume! limits counters :relationship-values
                          (count entities))
              _ (when leaf?
                  (consume! limits counters :leaf-subjects
                            (count entities)))
              rendered
              (mapv
               (fn [entity]
                 {:type (:subject-type descriptor)
                  :eid entity
                  :identity [:internal (:subject-type descriptor) entity]
                  :public (render-eid!
                           request-context (:subject-type descriptor) entity)})
               entities)]
          (recur (next remaining) (into result rendered)))))))

(defn- schedule
  [work assembler children]
  (into (conj work assembler) (reverse children)))

(defn- assemble-children
  [values child-count]
  (let [start (- (count values) child-count)]
    [(subvec values 0 start) (subvec values start)]))

(defn expand!
  "Expand one validated resource and permission in an existing context."
  [request-context resource permission raw-limits]
  (let [limits (normalize-limits raw-limits)
        counters (atom {:schema-components 0
                        :relationship-values 0
                        :tree-nodes 0
                        :leaf-subjects 0})
        resource (domain/normalize-object resource)
        _ (when (:relation resource)
            (fail! :eacl/invalid-request
                   :resource-relation-unsupported {}))
        _ (when-not (keyword? permission)
            (fail! :eacl/invalid-request :invalid-permission
                   {:permission permission}))
        _ (when-not
           (sealed-plan/schema-definition-defined?
            request-context (:type resource))
            (fail! :eacl/unknown-definition :unknown-definition
                   {:definition (:type resource) :position :resource}))
        _ (when-not
           (sealed-plan/permission-root-defined?
            request-context (:type resource) permission)
            (fail! :eacl/unknown-relation-or-permission :unknown-permission
                   {:definition (:type resource)
                    :relation-or-permission permission
                    :schema-kind :permission}))
        root-eid (indexed/object-eid! request-context (:id resource))
        root {:type (:type resource)
              :eid root-eid
              :identity (if root-eid
                          [:internal (:type resource) root-eid]
                          [:external (:type resource) (:id resource)])
              :public resource}]
    (loop [work [{:op :expand :resource root :name permission
                  :expected :permission :depth 1 :active #{}}]
           values []]
      (context/cut-point! request-context :permission-tree-transition)
      (if (empty? work)
        (do
          (when-not (= 1 (count values))
            (fail! :eacl.store/integrity-error
                   :invalid-permission-tree-value-stack {}))
          (first values))
        (let [frame (peek work)
              work (pop work)]
          (case (:op frame)
            :expand
            (let [resource (:resource frame)
                  name (:name frame)
                  expected (:expected frame)
                  depth (:depth frame)
                  active (:active frame)
                  _ (check-depth! limits depth counters)
                  expansion-key [(:identity resource) name]
                  relations
                  (relation-descriptors
                   request-context (:type resource) name counters limits)
                  permissions
                  (permission-definitions
                   request-context (:type resource) name counters limits)
                  actual (cond
                           (and (seq relations) (empty? permissions)) :relation
                           (and (seq permissions) (empty? relations)) :permission
                           (and (empty? relations) (empty? permissions)) nil
                           :else :conflict)]
              (when (= :conflict actual)
                (fail! :eacl.store/integrity-error
                       :relation-permission-name-collision {}))
              (when-not actual
                (fail! :eacl.store/integrity-error
                       :missing-referenced-definition
                       {:definition (:type resource) :name name}))
              (when-not (= expected actual)
                (fail! :eacl.store/integrity-error
                       :wrong-referenced-definition-kind
                       {:expected expected :actual actual}))
              (if (= :relation actual)
                (do
                  (consume! limits counters :tree-nodes 1)
                  (let [subjects
                        (scan-relation!
                         request-context resource relations true
                         counters limits)]
                    (recur
                     work
                     (conj values
                           {:expanded-object (:public resource)
                            :expanded-relation name
                            :leaf {:subjects (mapv :public subjects)}}))))
                (do
                  (when (contains? active expansion-key)
                    (fail! :eacl.permission-tree/cycle-detected
                           :active-path-cycle
                           {:path-node [(:type resource) name]}))
                  (consume! limits counters :tree-nodes 1)
                  (let [next-active (conj active expansion-key)
                        components
                        (mapv
                         (fn [definition]
                           {:op :component :resource resource
                            :permission name :definition definition
                            :depth (inc depth) :active next-active})
                         permissions)]
                    (recur
                     (schedule
                      work
                      {:op :assemble :resource resource :name name
                       :child-count (count components)}
                      components)
                     values)))))

            :component
            (let [resource (:resource frame)
                  permission (:permission frame)
                  definition (:definition frame)
                  depth (:depth frame)
                  active (:active frame)
                  _ (check-depth! limits depth counters)
                  source
                  (:eacl.permission/source-relation-name definition)
                  target-kind (:eacl.permission/target-type definition)
                  target-name (:eacl.permission/target-name definition)]
              (if (= :self source)
                (recur
                 (conj work
                       {:op :expand :resource resource :name target-name
                        :expected target-kind :depth depth :active active})
                 values)
                (let [source-relations
                      (relation-descriptors
                       request-context (:type resource) source
                       counters limits)
                      _ (when (empty? source-relations)
                          (fail! :eacl.store/integrity-error
                                 :missing-arrow-source {}))
                      intermediates
                      (scan-relation!
                       request-context resource source-relations false
                       counters limits)
                      targets
                      (mapv
                       (fn [intermediate]
                         {:op :expand :resource intermediate
                          :name target-name :expected target-kind
                          :depth (inc depth) :active active})
                       intermediates)]
                  (consume! limits counters :tree-nodes 1)
                  (recur
                   (schedule
                    work
                    {:op :assemble :resource resource :name permission
                     :child-count (count targets)}
                    targets)
                   values))))

            :assemble
            (let [[remaining children]
                  (assemble-children values (:child-count frame))]
              (recur
               work
               (conj remaining
                     {:expanded-object (get-in frame [:resource :public])
                      :expanded-relation (:name frame)
                      :intermediate
                      {:operation :union :children (vec children)}})))

            (fail! :eacl.store/integrity-error
                   :unknown-permission-tree-frame {:frame (:op frame)})))))))
