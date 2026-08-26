(ns eacl.relationships.filters
  "Fail-closed anchored raw relationship filter validation.")

(def anchor-keys
  #{:subject/type :subject/id
    :resource/type :resource/id :resource/relation})

(defn- filter-error!
  [type reason data]
  (throw
   (ex-info
    "Invalid relationship read filter."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn validate!
  [filters]
  (when-not (map? filters)
    (filter-error! :eacl.filters/invalid-filter
                   :filter-must-be-map {:value filters}))
  (let [unknown (vec (remove anchor-keys (keys filters)))]
    (when (seq unknown)
      (filter-error! :eacl.filters/unknown-filter
                     :unknown-filter-keys {:unknown-keys unknown})))
  (let [nil-anchors
        (vec (filter #(and (contains? filters %)
                           (nil? (get filters %)))
                     (sort anchor-keys)))]
    (when (seq nil-anchors)
      (filter-error! :eacl.filters/missing-anchor
                     :nil-anchor {:nil-anchor-keys nil-anchors})))
  (when-not (some #(contains? filters %) anchor-keys)
    (filter-error! :eacl.filters/missing-anchor
                   :unanchored-read {}))
  (doseq [key [:subject/type :resource/type :resource/relation]]
    (when (and (contains? filters key) (not (keyword? (get filters key))))
      (filter-error! :eacl.filters/invalid-filter-value
                     :expected-keyword {:key key})))
  (doseq [key [:subject/id :resource/id]]
    (when (and (contains? filters key)
               (not (and (string? (get filters key))
                         (not (empty? (get filters key))))))
      (filter-error! :eacl.filters/invalid-filter-value
                     :expected-non-empty-string {:key key})))
  (when (and (contains? filters :subject/id)
             (not (contains? filters :subject/type)))
    (filter-error! :eacl.filters/missing-subject-type
                   :subject-id-requires-type {}))
  filters)
