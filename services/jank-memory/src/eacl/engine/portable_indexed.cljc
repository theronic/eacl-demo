(ns eacl.engine.portable-indexed
  "Validated, bounded relationship traversal through the closed seek table."
  (:require [eacl.engine.portable-decisions :as decisions]
            [eacl.relationships.endpoint-pair :as endpoint-pair]
            [eacl.relationships.storage :as relationship-storage]
            [eacl.request.context :as context]
            [eacl.store :as store]))

;; Adapted from the indexed read descriptors and traversal seams at frozen
;; EACL commit 1cbf80c7aaf4bfcf2564d2bf30135794ff406383. There is no protocol or
;; backend dispatch: all reads use the one context's closed operation table.

(def narrow-prefix-chunk-size 2)
(def broad-prefix-chunk-size 8)
(def expanded-prefix-chunk-size 32)
(def ordered-window-chunk-size 1024)

(defn- physical-chunk-size
  [prefix]
  ;; One-component EAVT scans intentionally read a complete small entity in
  ;; fewer seeks. Attribute/value and more specific prefixes avoid dragging a
  ;; broad suffix of unrelated datoms into semantic work accounting.
  (if (<= (count prefix) 1)
    broad-prefix-chunk-size
    narrow-prefix-chunk-size))

(defn- indexed-error!
  [reason data]
  (throw
   (ex-info
    "Invalid indexed authorization traversal."
    (merge {:type :eacl.store/integrity-error
            :eacl/error :eacl.store/integrity-error
            :reason reason} data))))

(defn- index-components
  [index-name datom]
  (case index-name
    :eavt [(:e datom) (:a datom) (:v datom) (:tx datom)]
    :aevt [(:a datom) (:e datom) (:v datom) (:tx datom)]
    :avet [(:a datom) (:v datom) (:e datom) (:tx datom)]
    :vaet [(:v datom) (:a datom) (:e datom) (:tx datom)]
    (indexed-error! :unsupported-index {:index index-name})))

(defn- component-prefix?
  [expected actual]
  (if (vector? expected)
    (and (vector? actual)
         (<= (count expected) (count actual))
         (= expected (subvec actual 0 (count expected))))
    (= expected actual)))

(defn- prefix-match?
  [index-name prefix datom]
  (let [actual (index-components index-name datom)]
    (and (<= (count prefix) (count actual))
         (every? true?
                 (map component-prefix? prefix
                      (subvec actual 0 (count prefix)))))))

(defn scan-prefix!
  "Realize one finite matching prefix in ascending index order.

  Pagination resumes from the complete last index key and drops the inclusive
  boundary, so a scan never materializes the total database."
  [request-context index-name prefix]
  (let [database (context/database request-context)
        operations (context/operations request-context)
        initial-chunk-size (physical-chunk-size prefix)]
    (loop [bound (vec prefix)
           continuation? false
           request-id 0
           result []
           chunk-size initial-chunk-size]
      (context/consume! request-context :commands)
      (context/record! request-context :adapter-reads)
      (context/record! request-context :seeks)
      (let [;; One extra value is a prefix sentinel. A continuation also
            ;; includes its exact boundary. Only a response that proves more
            ;; than the narrow initial prefix widens subsequent physical reads.
            requested (+ chunk-size 1 (if continuation? 1 0))
            raw (vec (store/seek-datoms-chunk-trusted
                      operations database index-name bound requested))
            _ (context/cut-point! request-context :after-adapter-read)
            validation
            (decisions/decide
             :indexed-scan-response
             {:command {:request-id request-id
                        :chunk-size requested
                        :bound bound}
              :response {:request-id request-id
                         :values raw
                         :fetched-values (count raw)
                         :terminal? (< (count raw) requested)}})
            _ (when-not (= :accepted (:status validation))
                (indexed-error! :invalid-store-scan-response
                                {:decision validation}))
            _ (context/consume! request-context :fetched-values (count raw))
            values
            (if (and continuation? (seq raw)
                     (= bound (index-components index-name (first raw))))
              (subvec raw 1)
              raw)
            matching (vec (take-while #(prefix-match? index-name prefix %)
                                      values))
            result (into result matching)
            crossed? (< (count matching) (count values))
            exhausted? (< (count raw) requested)]
        (cond
          crossed? result
          exhausted? result
          (empty? values)
          (indexed-error! :non-progressing-store-scan
                          {:index index-name :prefix prefix})
          :else
          (recur (index-components index-name (last values))
                 true (inc request-id) result
                 (max chunk-size expanded-prefix-chunk-size)))))))

(defn ordered-prefix-window!
  "Read one bounded ordered prefix window from an optional full-key anchor.

  The store seek is inclusive, so a continuation drops its exact boundary.
  One extra matching datom is requested as a sentinel; `:exhausted?` is true
  only when the prefix actually ends inside this physical response."
  [request-context index-name prefix direction bound limit]
  (when-not (contains? #{:forward :backward} direction)
    (indexed-error! :invalid-direction {:direction direction}))
  (when-not (and (integer? limit) (pos? limit))
    (indexed-error! :invalid-window-limit {:limit limit}))
  (let [database (context/database request-context)
        operations (context/operations request-context)
        chunk-size (min limit ordered-window-chunk-size)
        requested (+ chunk-size 1 (if bound 1 0))]
    (context/consume! request-context :commands)
    (context/record! request-context :adapter-reads)
    (context/record! request-context :seeks)
    (let [raw
          (vec
           (if (= :forward direction)
             (store/seek-datoms-chunk-trusted
              operations database index-name (or bound prefix) requested)
             (store/rseek-datoms-chunk-trusted
              operations database index-name (or bound prefix) requested)))
          _ (context/cut-point! request-context :after-adapter-read)
          validation
          (decisions/decide
           :indexed-scan-response
           {:command {:request-id 0
                      :chunk-size requested
                      :bound (or bound prefix)}
            :response {:request-id 0
                       :values raw
                       :fetched-values (count raw)
                       :terminal? (< (count raw) requested)}})
          _ (when-not (= :accepted (:status validation))
              (indexed-error! :invalid-store-scan-response
                              {:decision validation}))
          _ (context/consume! request-context :fetched-values (count raw))
          values
          (if (and bound (seq raw)
                   (= bound (index-components index-name (first raw))))
            (subvec raw 1)
            raw)
          matching
          (vec (take-while #(prefix-match? index-name prefix %) values))
          selected (vec (take chunk-size matching))]
      {:datoms selected
       :anchor (when-let [last-datom (peek selected)]
                 (index-components index-name last-datom))
       :exhausted? (<= (count matching) chunk-size)})))

(defn next-prefix!
  "Return the next matching datom and opaque full index anchor.

  This one-at-a-time primitive is used by bounded authorized discovery so the
  engine never schedules candidates beyond an accepted sentinel or physical
  budget."
  [request-context index-name prefix direction bound]
  (when-not (contains? #{:forward :backward} direction)
    (indexed-error! :invalid-direction {:direction direction}))
  (let [database (context/database request-context)
        operations (context/operations request-context)
        requested (if bound 2 1)]
    (context/consume! request-context :commands)
    (context/record! request-context :adapter-reads)
    (context/record! request-context :seeks)
    (let [raw
          (vec
          (if (= :forward direction)
             (store/seek-datoms-chunk-trusted
              operations database index-name (or bound prefix) requested)
             (store/rseek-datoms-chunk-trusted
              operations database index-name (or bound prefix) requested)))
          _ (context/cut-point! request-context :after-adapter-read)
          _ (context/consume! request-context :fetched-values (count raw))
          values
          (if (and bound (seq raw)
                   (= bound (index-components index-name (first raw))))
            (subvec raw 1)
            raw)
          value (first values)]
      (when (and value (prefix-match? index-name prefix value))
        {:datom value
         :anchor (index-components index-name value)}))))

(defn exact-value!
  [request-context index-name prefix]
  (let [values (scan-prefix! request-context index-name prefix)]
    (when (> (count values) 1)
      (indexed-error! :non-unique-exact-value
                      {:index index-name :prefix prefix
                       :count (count values)}))
    (first values)))

(defn object-eid!
  [request-context external-id]
  (some-> (exact-value! request-context :avet [:eacl/id external-id]) :e))

(defn entity-value!
  [request-context entity attribute]
  (some-> (exact-value! request-context :eavt [entity attribute]) :v))

(defn entity-map!
  [request-context entity]
  (reduce
   (fn [result datom]
     (when (contains? result (:a datom))
       (indexed-error! :duplicate-cardinality-one-attribute
                       {:entity entity :attribute (:a datom)}))
     (assoc result (:a datom) (:v datom)))
   {:db/id entity}
   (scan-prefix! request-context :eavt [entity])))

(defn schema-generation!
  [request-context]
  (if-let [control (object-eid! request-context "eacl.schema/control")]
    (or (entity-value! request-context control :eacl/schema-generation) 0)
    0))

(defn- require-peer!
  [request-context direction endpoint-eid value]
  (let [memo-key [direction endpoint-eid value]
        cached (context/memo-value
                request-context :peer-validations memo-key)]
    (if (:found? cached)
      (:value cached)
      (let [peer (endpoint-pair/peer-half direction endpoint-eid value)]
        (when-not peer
          (indexed-error! :malformed-relationship-half
                          {:direction direction :endpoint-eid endpoint-eid}))
        (when-not (context/relationship-halves-certified? request-context)
          (let [attribute (case (:direction peer)
                            :forward relationship-storage/forward-attribute
                            :reverse relationship-storage/reverse-attribute)]
            (when-not (exact-value!
                       request-context :eavt
                       [(:endpoint-eid peer) attribute (:value peer)])
              (indexed-error! :dangling-relationship-half
                              {:direction direction
                               :endpoint-eid endpoint-eid}))))
        (context/install-memo!
         request-context :peer-validations memo-key peer)))))

(defn direct-match!
  [request-context subject-type subject-eid relation-eid
   resource-type resource-eid]
  (context/record! request-context :probes)
  (let [value (endpoint-pair/forward-value
               subject-type relation-eid resource-type resource-eid)
        datom (exact-value!
               request-context :eavt
               [subject-eid relationship-storage/forward-attribute value])]
    (if datom
      (do (require-peer! request-context :forward subject-eid (:v datom)) true)
      false)))

(defn subject->resources!
  [request-context subject-type subject-eid relation-eid resource-type]
  (let [tuple-prefix [subject-type relation-eid resource-type]
        prefix [subject-eid relationship-storage/forward-attribute tuple-prefix]
        datoms (scan-prefix! request-context :eavt prefix)]
    (loop [remaining (seq datoms)
           result []]
      (if-not remaining
        result
        (let [datom (first remaining)]
          (when-not (endpoint-pair/endpoint-value? (:v datom))
            (indexed-error! :malformed-forward-half {:datom datom}))
          (if (endpoint-pair/value-prefix? (:v datom) tuple-prefix)
            (do
              (require-peer! request-context :forward subject-eid (:v datom))
              (recur (next remaining) (conj result (nth (:v datom) 3))))
            (recur (next remaining) result)))))))

(defn resource->subjects!
  [request-context resource-type resource-eid relation-eid subject-type]
  (let [tuple-prefix [resource-type relation-eid subject-type]
        prefix [resource-eid relationship-storage/reverse-attribute tuple-prefix]
        datoms (scan-prefix! request-context :eavt prefix)]
    (loop [remaining (seq datoms)
           result []]
      (if-not remaining
        result
        (let [datom (first remaining)]
          (when-not (endpoint-pair/endpoint-value? (:v datom))
            (indexed-error! :malformed-reverse-half {:datom datom}))
          (if (endpoint-pair/value-prefix? (:v datom) tuple-prefix)
            (do
              (require-peer! request-context :reverse resource-eid (:v datom))
              (recur (next remaining) (conj result (nth (:v datom) 3))))
            (recur (next remaining) result)))))))
