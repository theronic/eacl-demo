(ns eacl.domain
  "Validated plain-map EACL domain values shared by the engine and public API.")

(def object-fields #{:type :id :relation})
(def relationship-fields #{:subject :relation :resource})
(def relationship-update-fields #{:operation :relationship})
(def relationship-operations #{:create :touch :delete})

(defn- invalid!
  [reason data]
  (throw
   (ex-info
    "Invalid EACL domain value."
    (merge {:type :eacl/invalid-request
            :eacl/error :eacl/invalid-request
            :reason reason}
           data))))

(defn spice-object
  ([type id]
   (spice-object type id nil))
  ([type id relation]
   (when-not (and (keyword? type)
                  (string? id) (not (empty? id))
                  (or (nil? relation) (keyword? relation)))
     (invalid! :invalid-spice-object
               {:object {:type type :id id :relation relation}}))
   {:type type :id id :relation relation}))

(def Subject spice-object)
(def Resource spice-object)

(defn normalize-object
  [value]
  (when-not (and (map? value)
                 (every? object-fields (keys value))
                 (contains? value :type)
                 (contains? value :id))
    (invalid! :invalid-object-shape {:value value}))
  (spice-object (:type value) (:id value) (:relation value)))

(defn relationship
  [subject relation resource]
  (when-not (keyword? relation)
    (invalid! :invalid-relationship-name {:relation relation}))
  (let [subject (normalize-object subject)
        resource (normalize-object resource)]
    (when (:relation subject)
      (invalid! :subject-relations-unsupported {:subject subject}))
    (when (:relation resource)
      (invalid! :resource-relation-unsupported {:resource resource}))
    {:subject subject :relation relation :resource resource}))

(def Relationship relationship)

(defn normalize-relationship
  [value]
  (when-not (and (map? value)
                 (= relationship-fields (set (keys value))))
    (invalid! :invalid-relationship-shape {:value value}))
  (relationship (:subject value) (:relation value) (:resource value)))

(defn relationship-update
  [operation value]
  (when-not (contains? relationship-operations operation)
    (invalid! :unsupported-relationship-operation
              {:operation operation}))
  {:operation operation :relationship (normalize-relationship value)})

(def RelationshipUpdate relationship-update)

(defn normalize-relationship-update
  [value]
  (when-not (and (map? value)
                 (= relationship-update-fields (set (keys value))))
    (invalid! :invalid-relationship-update-shape {:value value}))
  (relationship-update (:operation value) (:relationship value)))
