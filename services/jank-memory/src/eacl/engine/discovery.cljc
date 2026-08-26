(ns eacl.engine.discovery
  "Seek-driven candidate enumeration helpers for authorized discovery."
  (:require [eacl.domain :as domain]
            [eacl.engine.portable-indexed :as indexed]
            [eacl.engine.sealed-plan :as sealed-plan]
            [eacl.request.context :as context]))

(def candidate-catalog-version-attribute
  :eacl-jank.object/catalog-version)

(def candidate-catalog-version 1)

(defn candidate-type-attribute
  "Return the AVET catalog attribute for one unnamespaced object type."
  [object-type]
  (keyword "eacl-jank.object" (str "type+" (name object-type))))

(defn- fail!
  [type reason data]
  (throw
   (ex-info
    "EACL authorized discovery failed."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn validate-root!
  [request-context subject-type resource-type permission operation]
  (when-not (sealed-plan/schema-definition-defined?
             request-context subject-type)
    (fail! :eacl/unknown-definition :unknown-definition
           {:operation operation :definition subject-type
            :position :subject}))
  (when-not (sealed-plan/schema-definition-defined?
             request-context resource-type)
    (fail! :eacl/unknown-definition :unknown-definition
           {:operation operation :definition resource-type
            :position :resource}))
  (let [plan (sealed-plan/prepared-plan!
              request-context resource-type permission operation)]
    {:plan plan
     :subject-type subject-type
     :resource-type resource-type
     :permission permission}))

(defn validate-relationship-filters!
  [request-context filters]
  (doseq [[key definition]
          [[:subject/type (:subject/type filters)]
           [:resource/type (:resource/type filters)]]]
    (when (and definition
               (not (sealed-plan/schema-definition-defined?
                     request-context definition)))
      (fail! :eacl/unknown-definition :unknown-definition
             {:operation :read-relationships
              :definition definition :position key})))
  (when-let [relation (:resource/relation filters)]
    (let [rows (sealed-plan/relation-name-definitions!
                request-context relation)
          matching
          (filter
           (fn [row]
             (and
              (or (nil? (:resource/type filters))
                  (= (:resource/type filters)
                     (:eacl.relation/resource-type row)))
              (or (nil? (:subject/type filters))
                  (= (:subject/type filters)
                     (:eacl.relation/subject-type row)))))
           rows)]
      (when-not (seq matching)
        (fail! :eacl/unknown-relation-or-permission :unknown-relation
               {:operation :read-relationships
                :definition (:resource/type filters)
                :relation-or-permission relation
                :schema-kind :relation}))))
  filters)

(defn prepared-candidate
  "Build one point-kernel input from a validated, prepared discovery root."
  [request-context root operation subject resource subject-eid resource-eid]
  (let [plan (:plan root)
        proof (:proof root)
        permission (:permission root)
        basis (get-in (context/selection request-context) [:basis])]
    {:demand {:subject subject :permission permission :resource resource}
     :plan plan
     :subject-eid subject-eid
     :resource-eid resource-eid
     :base {:subject subject
            :permission permission
            :resource resource
            :basis basis
            :schema-generation (context/schema-generation request-context)
            :dependency-proof proof
            :plan-fingerprint (:fingerprint plan)}}))

(defn typed-candidate-catalog?
  [request-context]
  (let [memo-key :typed-candidate-catalog-v1
        cached (context/memo-value request-context :catalog-values memo-key)]
    (if (:found? cached)
      (:value cached)
      (context/install-memo!
       request-context :catalog-values memo-key
       (boolean
        (indexed/exact-value!
         request-context :avet
         [candidate-catalog-version-attribute candidate-catalog-version]))))))

(defn- next-catalog-object!
  [request-context object-type direction bound]
  (when-let [candidate
             (indexed/next-prefix!
              request-context :avet
              [(candidate-type-attribute object-type)] direction bound)]
    (let [value (get-in candidate [:datom :v])]
      (when-not (and (string? value) (not (empty? value)))
        (fail! :eacl.store/integrity-error
               :invalid-candidate-catalog-entry {}))
      (when-not (= value
                   (indexed/entity-value!
                    request-context (get-in candidate [:datom :e]) :eacl/id))
        (fail! :eacl.store/integrity-error
               :candidate-catalog-identity-mismatch {}))
      {:object (domain/spice-object object-type value)
       :eid (get-in candidate [:datom :e])
       :anchor (:anchor candidate)})))

(defn- next-global-object!
  [request-context object-type direction bound]
  (loop [bound bound]
    (when-let [candidate
               (indexed/next-prefix!
                request-context :avet [:eacl/id] direction bound)]
      (let [datom (:datom candidate)
            entity (:e datom)
            schema-kind
            (indexed/entity-value!
             request-context entity :eacl/schema-kind)]
        (if schema-kind
          (recur (:anchor candidate))
          {:object (domain/spice-object object-type (:v datom))
           :eid entity
           :anchor (:anchor candidate)})))))

(defn next-object!
  "Return the next stable candidate object.

  A snapshot may opt into the typed AVET catalog, which is a complete
  application-maintained candidate universe and removes unrelated object
  types before scalar authorization.  Snapshots without the version marker
  retain the frozen global `:eacl/id` stream exactly."
  [request-context object-type direction bound]
  (if (typed-candidate-catalog? request-context)
    (next-catalog-object! request-context object-type direction bound)
    (next-global-object! request-context object-type direction bound)))

(defn candidate-window!
  "Return a bounded stable typed-catalog window, or nil without certification."
  [request-context object-type direction bound limit]
  (when (typed-candidate-catalog? request-context)
    (let [window
          (indexed/ordered-prefix-window!
           request-context :avet [(candidate-type-attribute object-type)]
           direction bound limit)]
      (assoc
       window :candidates
       (mapv
        (fn [datom]
          (let [catalog-id (:v datom)
                eid (:e datom)]
            (when-not (and (string? catalog-id)
                           (not (empty? catalog-id)))
              (fail! :eacl.store/integrity-error
                     :invalid-candidate-catalog-entry {}))
            (when-not (= catalog-id
                         (indexed/entity-value!
                          request-context eid :eacl/id))
              (fail! :eacl.store/integrity-error
                     :candidate-catalog-identity-mismatch {}))
            {:object (domain/spice-object object-type catalog-id)
             :eid eid
             :anchor [(:a datom) (:v datom) (:e datom) (:tx datom)]}))
        (:datoms window))))))

(defn candidate-eid-member!
  "Whether one authorized EID belongs to the selected discovery universe.

  Denotation traversal follows authorization relationships, whereas discovery
  is also constrained by the application object catalog. Exact counts must
  preserve that intersection even when they avoid an ordered catalog scan."
  [request-context object-type eid]
  (if (typed-candidate-catalog? request-context)
    (let [catalog-id
          (indexed/entity-value!
           request-context eid (candidate-type-attribute object-type))]
      (if (nil? catalog-id)
        false
        (let [canonical-id
              (indexed/entity-value! request-context eid :eacl/id)]
          (when-not (and (string? catalog-id)
                         (not (empty? catalog-id)))
            (fail! :eacl.store/integrity-error
                   :invalid-candidate-catalog-entry {}))
          (when-not (= catalog-id canonical-id)
            (fail! :eacl.store/integrity-error
                   :candidate-catalog-identity-mismatch {}))
          true)))
    (let [canonical-id (indexed/entity-value! request-context eid :eacl/id)]
      (and (string? canonical-id)
           (not (empty? canonical-id))
           (nil? (indexed/entity-value!
                  request-context eid :eacl/schema-kind))))))

(defn count-authorized-candidate-eids!
  "Count the authorized EIDs in the selected discovery universe.

  The catalog prefix is read in physical chunks once, rather than issuing two
  point reads for every authorized EID. `examine!` is called after each actual
  candidate with the matched count so the caller retains aggregate-limit
  accounting. `target` is the optional count sentinel (normally limit + 1)."
  [request-context object-type authorized-eids target examine!]
  (let [typed? (typed-candidate-catalog? request-context)
        attribute (if typed?
                    (candidate-type-attribute object-type)
                    :eacl/id)
        datoms (indexed/scan-prefix! request-context :avet [attribute])]
    (loop [remaining (seq datoms)
           matched 0]
      (if-not remaining
        matched
        (let [datom (first remaining)
              eid (:e datom)
              catalog-id (:v datom)
              candidate?
              (if typed?
                (do
                  (when-not (and (string? catalog-id)
                                 (not (empty? catalog-id)))
                    (fail! :eacl.store/integrity-error
                           :invalid-candidate-catalog-entry {}))
                  (when-not (= catalog-id
                               (indexed/entity-value!
                                request-context eid :eacl/id))
                    (fail! :eacl.store/integrity-error
                           :candidate-catalog-identity-mismatch {}))
                  true)
                (and (string? catalog-id)
                     (not (empty? catalog-id))
                     (nil? (indexed/entity-value!
                            request-context eid :eacl/schema-kind))))]
          (if-not candidate?
            (recur (next remaining) matched)
            (let [next-matched
                  (if (contains? authorized-eids eid)
                    (inc matched) matched)]
              (examine! next-matched)
              (if (and target (>= next-matched target))
                next-matched
                (recur (next remaining) next-matched)))))))))

(defn prepare-direct-clause!
  [request-context operation result-type clause]
  (when clause
    (let [relation (:relation clause)
          anchor-key (if (= :lookup-resources operation) :subject :resource)
          anchor (domain/normalize-object (get clause anchor-key))
          _ (when (:relation anchor)
              (fail! :eacl.pagination/unsupported-filter
                     :subject-relation-unsupported
                     {:filter (keyword (name anchor-key) "relation")}))
          relation-resource-type
          (if (= :lookup-resources operation) result-type (:type anchor))
          relation-subject-type
          (if (= :lookup-resources operation) (:type anchor) result-type)
          rows
          (sealed-plan/relation-definitions!
           request-context relation-resource-type relation)
          matching
          (vec
           (filter
            #(= relation-subject-type
                (:eacl.relation/subject-type %)) rows))]
      (when (empty? matching)
        (fail! :eacl/unknown-relation-or-permission :unknown-relation
               {:operation operation :definition relation-resource-type
                :relation-or-permission relation :schema-kind :relation
                :subject/type relation-subject-type}))
      (when-not (= 1 (count matching))
        (fail! :eacl.store/integrity-error
               :ambiguous-direct-relation {}))
      {:operation operation
       :relation-eid (:db/id (first matching))
       :relation relation
       :anchor anchor
       :anchor-eid (indexed/object-eid! request-context (:id anchor))
       :result-type result-type})))

(defn direct-clause-match!
  [request-context prepared candidate-eid]
  (if-not prepared
    true
    (if-not (:anchor-eid prepared)
      false
      (cond
        (= :lookup-resources (:operation prepared))
        (indexed/direct-match!
         request-context (get-in prepared [:anchor :type])
         (:anchor-eid prepared) (:relation-eid prepared)
         (:result-type prepared) candidate-eid)

        (= :lookup-subjects (:operation prepared))
        (indexed/direct-match!
         request-context (:result-type prepared) candidate-eid
         (:relation-eid prepared) (get-in prepared [:anchor :type])
         (:anchor-eid prepared))

        :else
        (fail! :eacl.store/integrity-error
               :unknown-direct-clause-operation {})))))
