(ns eacl.schema.model
  "Portable logical schema values and reference validation.

  Adapted from EACL PR #145 at commit
  1cbf80c7aaf4bfcf2564d2bf30135794ff406383."
  (:require [clojure.string :as str]))

(defn- invalid-model!
  [reason data]
  (throw
   (ex-info
    "Invalid EACL logical schema value."
    (merge {:type :eacl.schema/invalid-model
            :eacl/error :eacl.schema/invalid-model
            :reason reason}
           data))))

(defn ->relation-id
  [resource-type relation-name subject-type]
  (str "eacl.relation:" resource-type ":" relation-name ":" subject-type))

(defn Relation
  ([resource-type relation-name subject-type]
   (when-not (and (keyword? resource-type)
                  (keyword? relation-name)
                  (keyword? subject-type)
                  (not= resource-type :self)
                  (not= relation-name :self))
     (invalid-model! :invalid-relation
                     {:resource-type resource-type
                      :relation-name relation-name
                      :subject-type subject-type}))
   {:eacl/id (->relation-id resource-type relation-name subject-type)
    :eacl.relation/resource-type resource-type
    :eacl.relation/relation-name relation-name
    :eacl.relation/subject-type subject-type})
  ([resource-type+relation-name subject-type]
   (when-not (and (keyword? resource-type+relation-name)
                  (namespace resource-type+relation-name)
                  (keyword? subject-type))
     (invalid-model! :invalid-qualified-relation {}))
   (Relation (keyword (namespace resource-type+relation-name))
             (keyword (name resource-type+relation-name))
             subject-type)))

(defn ->permission-id
  [resource-type permission-name arrow target-type target-name]
  (str "eacl:permission:" resource-type ":" permission-name ":" arrow
       ":" target-type ":" target-name))

(defn Permission
  [resource-type permission-name spec]
  (let [arrow (or (:arrow spec) :self)
        relation (:relation spec)
        permission (:permission spec)]
    (when-not (and (keyword? resource-type)
                   (keyword? permission-name)
                   (map? spec)
                   (or relation permission)
                   (not (and relation permission))
                   (keyword? arrow)
                   (or (nil? relation) (keyword? relation))
                   (or (nil? permission) (keyword? permission)))
      (invalid-model! :invalid-permission-spec {:spec spec}))
    (let [target-type (if relation :relation :permission)
          target-name (or relation permission)]
      {:eacl/id
       (->permission-id resource-type permission-name arrow
                        target-type target-name)
       :eacl.permission/resource-type resource-type
       :eacl.permission/permission-name permission-name
       :eacl.permission/source-relation-name arrow
       :eacl.permission/target-type target-type
       :eacl.permission/target-name target-name})))

(defn- names-by-type
  [values type-key name-key]
  (reduce (fn [result value]
            (update result (get value type-key)
                    (fn [current]
                      (conj (or current #{}) (get value name-key)))))
          {} values))

(defn- relation-subject-types
  [relations]
  (reduce (fn [result relation]
            (update result
                    [(:eacl.relation/resource-type relation)
                     (:eacl.relation/relation-name relation)]
                    (fn [current]
                      (conj (or current #{})
                            (:eacl.relation/subject-type relation)))))
          {} relations))

(defn validate-schema-references
  [{:keys [relations permissions definitions]}]
  (let [relations (or relations [])
        permissions (or permissions [])
        relation-names
        (names-by-type relations :eacl.relation/resource-type
                       :eacl.relation/relation-name)
        permission-names
        (names-by-type permissions :eacl.permission/resource-type
                       :eacl.permission/permission-name)
        subject-types (relation-subject-types relations)
        errors (atom [])]
    (doseq [permission permissions]
      (let [resource-type (:eacl.permission/resource-type permission)
            permission-name (:eacl.permission/permission-name permission)
            source (:eacl.permission/source-relation-name permission)
            target-type (:eacl.permission/target-type permission)
            target (:eacl.permission/target-name permission)]
        (if (= :self source)
          (let [catalog (if (= :relation target-type)
                          relation-names permission-names)]
            (when-not (contains? (get catalog resource-type #{}) target)
              (swap! errors conj
                     {:type (if (= :relation target-type)
                              :invalid-self-relation
                              :invalid-self-permission)
                      :permission (str (name resource-type) "/"
                                       (name permission-name))
                      :target target})))
          (if-not (contains? (get relation-names resource-type #{}) source)
            (swap! errors conj
                   {:type :missing-source-relation
                    :permission (str (name resource-type) "/"
                                     (name permission-name))
                    :relation source})
            (doseq [subject-type (get subject-types
                                      [resource-type source] #{})]
              (let [catalog (if (= :relation target-type)
                              relation-names permission-names)]
                (when-not (contains? (get catalog subject-type #{}) target)
                  (swap! errors conj
                         {:type (if (= :relation target-type)
                                  :invalid-arrow-target-relation
                                  :invalid-arrow-target-permission)
                          :permission (str (name resource-type) "/"
                                           (name permission-name))
                          :arrow-via source
                          :target-type subject-type
                          :target target}))))))))
    (when (seq definitions)
      (let [defined (into #{} (map keyword) definitions)]
        (doseq [relation relations]
          (when-not (contains? defined
                               (:eacl.relation/subject-type relation))
            (swap! errors conj
                   {:type :undefined-subject-type
                    :resource-type (:eacl.relation/resource-type relation)
                    :relation (:eacl.relation/relation-name relation)
                    :subject-type (:eacl.relation/subject-type relation)})))))
    (when (seq @errors)
      (throw
       (ex-info
        "Invalid schema: reference validation failed."
        {:type :eacl.schema/invalid-reference
         :eacl/error :eacl.schema/invalid-reference
         :errors @errors
         :error-count (count @errors)})))
    nil))

(defn- set-difference
  [left right]
  (into #{} (remove #(contains? right %)) left))

(defn- set-intersection
  [left right]
  (into #{} (filter #(contains? right %)) left))

(defn calc-set-deltas
  [before after]
  {:additions (set-difference after before)
   :unchanged (set-intersection before after)
   :retractions (set-difference before after)})

(defn compare-schema
  [before after]
  {:relations (calc-set-deltas (set (:relations before))
                               (set (:relations after)))
   :permissions (calc-set-deltas (set (:permissions before))
                                 (set (:permissions after)))})
