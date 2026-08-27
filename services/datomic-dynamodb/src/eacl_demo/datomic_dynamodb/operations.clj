(ns eacl-demo.datomic-dynamodb.operations
  "Bounded explorer operations over one retained Datomic/EACL snapshot."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [datomic.api :as d]
            [eacl-demo.contracts.response-meta :as response-meta]
            [eacl.core :as eacl]
            [eacl.datomic.core :as datomic-eacl]
            [eacl.relationships.storage :as relationship-storage]
            [eacl.secure-format :as secure]
            [eacl.spicedb.consistency :as consistency]))

(def ^:private default-page-size 20)
(def ^:private default-count-ceiling 1000000)
(def ^:private cursor-ttl-ms (* 15 60 1000))
(def ^:private cursor-prefix "eacl-demo-subjects-v1.")
(def ^:private cursor-domain "eacl-demo/datomic-dynamodb/list-subjects/v1")
(def ^:private cursor-payload-keys
  #{:version :operation :query :after :basis-id :expires-at-ms})

(declare bounded-scan-count decode-subject-cursor eacl-consistency encode-subject-cursor fail! guarded
         object-entities relationship-datoms relationship-query
         subject-entities wire-object wire-page-info wire-relationship
         wire-relationship-page)

(defn load-wire-schema
  []
  (if-let [resource (io/resource "schema-wire.v1.json")]
    (json/read-str (slurp resource) :key-fn keyword)
    (throw (ex-info "The fixed fixture wire schema is absent."
                    {:type :eacl-demo/missing-wire-schema}))))

(defn create-handlers
  [{:keys [descriptor cursor-key clock]
    :or {clock #(System/currentTimeMillis)}}]
  (when-not (and (map? descriptor)
                 (string? cursor-key)
                 (<= 32 (count (.getBytes ^String cursor-key "UTF-8")))
                 (fn? clock))
    (throw (ex-info "Invalid Datomic operation configuration."
                    {:type :eacl-demo/invalid-operation-config})))
  (let [wire-schema (load-wire-schema)
        cursor-options {:domain cursor-domain
                        :prefix cursor-prefix
                        :current-kid :v1
                        :keyring {:v1 cursor-key}
                        :payload-keys cursor-payload-keys
                        :maximum-size 4096}]
    {"health"
     (fn [{:keys [basis]}]
       {:status "ready"
        :ready true
        :identity (:identity descriptor)
        :basis basis})

     ;; The boundary returns the descriptor directly for bootstrap, but an
     ;; exact handler map prevents accidental capability drift.
     "bootstrap" (fn [_] descriptor)

     "list-subjects"
     (guarded
      (fn [{:keys [snapshot basis input check-active!]}]
        (let [database (datomic-eacl/db snapshot)
              page-size (or (:pageSize input) default-page-size)
              query {:type (:type input)}
              after (when-let [token (:cursor input)]
                      (decode-subject-cursor cursor-options token query
                                             (:id basis) (clock)))
              rows (->> (d/q '[:find ?type ?id
                               :where
                               [?entity :eacl.demo/roles :subject]
                               [?entity :eacl.demo/type ?type]
                               [?entity :eacl/id ?id]]
                             database)
                        (filter (fn [[type _]]
                                  (or (nil? (:type query))
                                      (= (keyword (:type query)) type))))
                        (sort-by (fn [[type id]] [(name type) id]))
                        (drop-while (fn [[type id]]
                                      (and after
                                           (not (pos? (compare [(name type) id]
                                                               after))))))
                        (take (inc page-size))
                        vec)
              has-next? (> (count rows) page-size)
              page (subvec rows 0 (min page-size (count rows)))
              last-row (peek page)]
          (check-active!)
          {:items (mapv (fn [[type id]] (wire-object type id)) page)
           :pageInfo
           {:hasNextPage has-next?
            :endCursor (when has-next?
                         (encode-subject-cursor
                          cursor-options query [(name (first last-row))
                                                (second last-row)]
                          (:id basis) (+ (clock) cursor-ttl-ms)))
            :pageSize (count page)}})))

     "get-object"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [database (datomic-eacl/db snapshot)
              entity (d/entity database [:eacl/id (:id input)])]
          (check-active!)
          (if (= (keyword (:type input)) (:eacl.demo/type entity))
            {:object (wire-object (:eacl.demo/type entity) (:id input))}
            (fail! "validation-error")))))

     "list-relationships"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [page (eacl/read-relationships
                    snapshot
                    (relationship-query input
                                        {:resource/type (keyword (:resourceType input))
                                         :resource/id (:resourceId input)}))]
          (check-active!)
          (response-meta/with-cache-status
           (wire-relationship-page page) page (not= false (:cache input))))))

     "reverse-relationships"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [page (eacl/read-relationships
                    snapshot
                    (relationship-query input
                                        {:subject/type (keyword (:subjectType input))
                                         :subject/id (:subjectId input)}))]
          (check-active!)
          (response-meta/with-cache-status
           {:items (mapv (fn [{:keys [resource]}]
                           (wire-object (:type resource) (:id resource)))
                         (:data page))
            :pageInfo (wire-page-info page)}
           page
           (not= false (:cache input))))))

     "check-permission"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [decision
              (eacl/check-permission
               snapshot
               {:subject (eacl/spice-object
                          (keyword (:subjectType input))
                          (:subjectId input))
                :permission (keyword (:permission input))
                :resource (eacl/spice-object
                           (keyword (:resourceType input))
                           (:resourceId input))
                :cache? (not= false (:cache input))
                :populate-cache? (not= false (:populateCache input))
                :consistency (eacl-consistency input)})
              allowed? (true? (:allowed? decision))]
          (check-active!)
          (response-meta/with-cache-status
           {:allowed allowed?}
           decision
           (not= false (:cache input))))))

     "lookup-resources"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [result
              (eacl/lookup-resources
               snapshot
               (cond->
                {:subject (eacl/spice-object (keyword (:subjectType input))
                                             (:subjectId input))
                 :permission (keyword (:permission input))
                 :resource/type (keyword (:resourceType input))
                 :first (or (:pageSize input) default-page-size)
                 :cache? (not= false (:cache input))
                 :populate-cache? (not= false (:populateCache input))
                 :consistency (eacl-consistency input)}
                 (:cursor input) (assoc :after (:cursor input))))]
          (check-active!)
          (response-meta/with-cache-status
           {:items (mapv (fn [resource]
                           (wire-object (:type resource) (:id resource)))
                         (:data result))
            :pageInfo (wire-page-info result)}
           result
           (not= false (:cache input))))))

     "lookup-subjects"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [result
              (eacl/lookup-subjects
               snapshot
               (cond->
                {:resource (eacl/spice-object (keyword (:resourceType input))
                                              (:resourceId input))
                 :permission (keyword (:permission input))
                 :subject/type (keyword (:subjectType input))
                 :first (or (:pageSize input) default-page-size)
                 :cache? (not= false (:cache input))
                 :populate-cache? (not= false (:populateCache input))
                 :consistency (eacl-consistency input)}
                 (:cursor input) (assoc :after (:cursor input))))]
          (check-active!)
          (response-meta/with-cache-status
           {:items (mapv (fn [subject]
                           (wire-object (:type subject) (:id subject)))
                         (:data result))
            :pageInfo (wire-page-info result)}
           result
           (not= false (:cache input))))))

     "count-resources"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [ceiling (or (:ceiling input) default-count-ceiling)
              result
              (eacl/count-resources
               snapshot
               {:subject (eacl/spice-object (keyword (:subjectType input))
                                            (:subjectId input))
                :permission (keyword (:permission input))
                :resource/type (keyword (:resourceType input))
                :count-limit ceiling
                :cache? (not= false (:cache input))
                :populate-cache? (not= false (:populateCache input))
                :consistency (eacl-consistency input)})]
          (check-active!)
          (response-meta/with-cache-status
           {:kind "objects"
            :value (:count result)
            :exact (not (true? (:truncated? result)))
            :ceiling (:limit result)}
           result
           (not= false (:cache input))))))

     "get-schema" (fn [_] wire-schema)

     "get-cache-info"
     (fn [_]
       {:behavior "environment-local"
        :hit nil
        :scope "datomic-dynamodb"
        :entries nil
        :limitations ["fixed-current-snapshot" "no-history-api"
                      "no-synchronization"]})

     "count-objects"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [database (datomic-eacl/db snapshot)
              ceiling (or (:ceiling input) default-count-ceiling)
              kind (:kind input)
              type (some-> (:type input) keyword)
              values (case kind
                       "subjects" (subject-entities database type)
                       "objects" (object-entities database type)
                       "relationships" (relationship-datoms database type)
                       (fail! "validation-error"))
              observed (bounded-scan-count values ceiling check-active!)]
          {:kind kind
           :value (min ceiling observed)
           :exact (<= observed ceiling)
           :ceiling ceiling})))}))

(defn- eacl-consistency
  [input]
  (let [snapshot (:eacl-demo/snapshot input)
        public-basis (:eacl-demo/public-basis input)
        token (when snapshot (eacl/basis-token snapshot))
        requested-at (some-> (:atLeastAsFreshAs input) java.time.Instant/parse)
        captured-at (some-> (:capturedAt public-basis) java.time.Instant/parse)]
    (when-not token (fail! "internal-error"))
    (when (and requested-at captured-at (.isAfter requested-at captured-at))
      (fail! "freshness-unavailable"))
    (case (:consistency input)
      ;; The read-only Peer exposes one immutable deployment value and cannot
      ;; synchronize. That value is the authoritative head of this deployment,
      ;; so this selection deliberately validates it as the retained snapshot
      ;; instead of asking EACL's live-source path to synchronize.
      "authoritative" consistency/minimize-latency
      "at-least" (consistency/at-least-as-fresh token)
      "exact" (consistency/at-exact-snapshot token)
      consistency/minimize-latency)))

(defn- relationship-query
  [input anchor]
  (cond-> (assoc anchor :first (or (:pageSize input) default-page-size)
                 :cache? (not= false (:cache input))
                 :populate-cache? (not= false (:populateCache input))
                 :consistency (eacl-consistency input))
    (:relation input) (assoc :resource/relation (keyword (:relation input)))
    (:cursor input) (assoc :after (:cursor input))))

(defn- wire-relationship-page
  [page]
  {:items (mapv wire-relationship (:data page))
   :pageInfo (wire-page-info page)})

(defn- wire-page-info
  [page]
  (let [has-next-page? (true? (get-in page [:page-info :has-next-page?]))]
    {:hasNextPage has-next-page?
     :endCursor (when has-next-page?
                  (get-in page [:page-info :end-cursor]))
     :pageSize (count (:data page))}))

(defn- wire-relationship
  [{:keys [subject relation resource]}]
  {:resourceType (name (:type resource))
   :resourceId (str (:id resource))
   :relation (name relation)
   :subjectType (name (:type subject))
   :subjectId (str (:id subject))
   :subjectRelation (some-> (:relation subject) name)})

(defn- wire-object
  [type id]
  {:type (name type)
   :id (str id)
   :displayName (str id)
   :attributes []})

(defn- subject-entities
  [database type]
  (eduction
   (comp
    (map (fn [datom] (:e datom)))
    (filter (fn [entity-id]
              (or (nil? type)
                  (= type (:eacl.demo/type (d/entity database entity-id)))))))
   (d/datoms database :avet :eacl.demo/roles :subject)))

(defn- object-entities
  [database type]
  (if type
    (d/datoms database :avet :eacl.demo/type type)
    (d/datoms database :avet :eacl.demo/type)))

(defn- relationship-datoms
  [database resource-type]
  (let [datoms (d/datoms database :avet relationship-storage/forward-attribute)]
    (if resource-type
      (eduction (filter #(= resource-type (nth (:v %) 2))) datoms)
      datoms)))

(defn- bounded-scan-count
  [values ceiling check-active!]
  (loop [remaining (seq values)
         count 0]
    (when (zero? (bit-and count 1023)) (check-active!))
    (if (or (nil? remaining) (> count ceiling))
      count
      (recur (next remaining) (inc count)))))

(defn- encode-subject-cursor
  [options query after basis-id expires-at-ms]
  (secure/encode-authenticated
   options
   {:version 1
    :operation "list-subjects"
    :query query
    :after after
    :basis-id basis-id
    :expires-at-ms expires-at-ms}))

(defn- decode-subject-cursor
  [options token query basis-id now-ms]
  (try
    (let [payload (secure/decode-authenticated options token)]
      (cond
        (or (not= 1 (:version payload))
            (not= "list-subjects" (:operation payload))
            (not (and (vector? (:after payload))
                      (= 2 (count (:after payload)))
                      (every? string? (:after payload)))))
        (fail! "cursor-invalid")

        (or (not= query (:query payload))
            (not= basis-id (:basis-id payload)))
        (fail! "cursor-scope-mismatch")

        (or (not (integer? (:expires-at-ms payload)))
            (<= (:expires-at-ms payload) now-ms))
        (fail! "cursor-expired")

        :else (:after payload)))
    (catch clojure.lang.ExceptionInfo error
      (if (:code (ex-data error))
        (throw error)
        (fail! "cursor-invalid")))))

(defn- guarded
  [handler]
  (fn [context]
    (try
      (handler context)
      (catch clojure.lang.ExceptionInfo error
        (if (:code (ex-data error))
          (throw error)
          (let [type (:type (ex-data error))]
            (fail!
             (cond
               (contains? #{:eacl.pagination/invalid-cursor
                            :eacl.cursor/invalid
                            :eacl.format/invalid} type)
               "cursor-invalid"

               (= :eacl.pagination/cursor-expired type) "cursor-expired"
               (= :eacl.pagination/cursor-scope-mismatch type)
               "cursor-scope-mismatch"
               :else "internal-error"))))))))

(defn- fail!
  [code]
  (throw (ex-info "Datomic explorer operation failed." {:code code})))
