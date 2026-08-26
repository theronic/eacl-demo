(ns eacl-demo.datalevin-memory.operations
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [datalevin.core :as d]
            [eacl-demo.contracts.response-meta :as response-meta]
            [eacl.core :as eacl]
            [eacl.datalevin.core :as datalevin-eacl]
            [eacl.datalevin.db :as datalevin-db]
            [eacl.relationships.storage :as relationship-storage]
            [eacl.secure-format :as secure]))

(def ^:private default-page-size 20)
(def ^:private default-count-ceiling 1000000)
(def ^:private cursor-ttl-ms (* 15 60 1000))
(def ^:private cursor-prefix "eacl-demo-datalevin-subjects-v1.")
(def ^:private cursor-domain "eacl-demo/datalevin-memory/list-subjects/v1")
(def ^:private cursor-payload-keys
  #{:version :operation :query :after :basis-id :expires-at-ms})

(defn- fail!
  [code]
  (throw (ex-info "Datalevin explorer operation failed." {:code code})))

(defn- guarded
  [handler]
  (fn [context]
    (try
      (handler context)
      (catch clojure.lang.ExceptionInfo error
        (if (:code (ex-data error))
          (throw error)
          (fail! "internal-error"))))))

(defn- wire-object
  [type id]
  {:type (name type) :id (str id) :displayName (str id) :attributes []})

(defn- wire-page-info
  [page]
  {:hasNextPage (true? (get-in page [:page-info :has-next-page?]))
   :endCursor (get-in page [:page-info :end-cursor])
   :pageSize (count (:data page))})

(defn- wire-relationship
  [{:keys [subject relation resource]}]
  {:resourceType (name (:type resource))
   :resourceId (str (:id resource))
   :relation (name relation)
   :subjectType (name (:type subject))
   :subjectId (str (:id subject))
   :subjectRelation (some-> (:relation subject) name)})

(defn- eacl-consistency
  [_input]
  :minimize-latency)

(defn- relationship-query
  [input anchor]
  (cond-> (assoc anchor :first (or (:pageSize input) default-page-size)
                 :cache? (not= false (:cache input))
                 :populate-cache? (not= false (:populateCache input))
                 :consistency (eacl-consistency input))
    (:relation input) (assoc :resource/relation (keyword (:relation input)))
    (:cursor input) (assoc :after (:cursor input))))

(defn- object-exists?
  [database type id required-role]
  (let [entity (d/entity database [:eacl/id id])]
    (and (= (keyword type) (:demo/type entity))
         (or (nil? required-role)
             (contains? (set (:demo/roles entity)) required-role)))))

(defn- with-snapshot-db
  [snapshot f]
  (datalevin-db/with-db (datalevin-eacl/db snapshot) f))

(defn- encode-subject-cursor
  [options query after basis-id expires-at-ms]
  (secure/encode-authenticated
   options
   {:version 1 :operation "list-subjects" :query query :after after
    :basis-id basis-id :expires-at-ms expires-at-ms}))

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
      (if (:code (ex-data error)) (throw error) (fail! "cursor-invalid")))))

(defn- bounded-scan-count
  [values ceiling check-active!]
  (loop [remaining (seq values) count 0]
    (when (zero? (bit-and count 1023)) (check-active!))
    (if (or (nil? remaining) (> count ceiling))
      count
      (recur (next remaining) (inc count)))))

(defn create-handlers
  [{:keys [descriptor cursor-key clock]
    :or {clock #(System/currentTimeMillis)}}]
  (let [wire-schema (json/read-str
                     (slurp (or (io/resource "schema-wire.v1.json")
                                (throw (ex-info "Wire schema is absent."
                                                {:type :eacl-demo/missing-wire-schema}))))
                     :key-fn keyword)
        cursor-options {:domain cursor-domain :prefix cursor-prefix
                        :current-kid :v1 :keyring {:v1 cursor-key}
                        :payload-keys cursor-payload-keys :maximum-size 4096}]
    {"health"
     (fn [{:keys [basis]}]
       {:status "ready" :ready true :identity (:identity descriptor)
        :basis basis})

     "bootstrap" (fn [{:keys [basis]}] (assoc descriptor :basis basis))

     "list-subjects"
     (guarded
      (fn [{:keys [snapshot basis input check-active!]}]
        (let [page-size (or (:pageSize input) default-page-size)
              query {:type (:type input)}
              after (when-let [token (:cursor input)]
                      (decode-subject-cursor cursor-options token query
                                             (:id basis) (clock)))
              rows
              (with-snapshot-db
                snapshot
                (fn [database]
                  (->> (d/datoms database :ave :demo/roles :subject)
                       (map (fn [datom]
                              (let [entity (d/entity database (:e datom))]
                                [(:demo/type entity) (:eacl/id entity)])))
                       (filter (fn [[type _]]
                                 (or (nil? (:type query))
                                     (= (keyword (:type query)) type))))
                       distinct
                       (sort-by (fn [[type id]] [(name type) id]))
                       (drop-while (fn [[type id]]
                                     (and after
                                          (not (pos? (compare [(name type) id]
                                                              after))))))
                       (take (inc page-size)) vec)))
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
        (let [entity (with-snapshot-db
                       snapshot
                       #(into {} (d/entity % [:eacl/id (:id input)])))]
          (check-active!)
          (if (= (keyword (:type input)) (:demo/type entity))
            {:object (wire-object (:demo/type entity) (:id input))}
            (fail! "validation-error")))))

     "list-relationships"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [page (eacl/read-relationships
                    snapshot
                    (relationship-query
                     input
                     {:resource/type (keyword (:resourceType input))
                      :resource/id (:resourceId input)}))]
          (check-active!)
          (response-meta/with-cache-status
           {:items (mapv wire-relationship (:data page))
            :pageInfo (wire-page-info page)}
           page
           (not= false (:cache input))))))

     "reverse-relationships"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [page (eacl/read-relationships
                    snapshot
                    (relationship-query
                     input
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

     "authorize"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [[subject-known? resource-known?]
              (with-snapshot-db
                snapshot
                (fn [database]
                  [(object-exists? database (:subjectType input)
                                   (:subjectId input) :subject)
                   (object-exists? database (:resourceType input)
                                   (:resourceId input) nil)]))
              decision (when (and subject-known? resource-known?)
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
                           :consistency (eacl-consistency input)}))
              allowed? (true? (:allowed? decision))]
          (check-active!)
          (response-meta/with-cache-status
           {:subjectType (:subjectType input) :subjectId (:subjectId input)
            :resourceType (:resourceType input) :resourceId (:resourceId input)
            :permission (:permission input) :allowed allowed?
            :reasonCode (cond
                          (not subject-known?) "subject-not-found"
                          (not resource-known?) "object-not-found"
                          allowed? "granted"
                          :else "denied")
            :path []}
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
       {:behavior "environment-local" :hit nil :scope "datalevin-memory"
        :entries nil
        :limitations ["read-only-public-api" "request-owned-native-snapshot"]})

     "count-objects"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [ceiling (or (:ceiling input) default-count-ceiling)
              type (some-> (:type input) keyword)
              observed
              (with-snapshot-db
                snapshot
                (fn [database]
                  (let [values
                        (case (:kind input)
                          "subjects"
                          (if type
                            (filter (fn [datom]
                                      (= type (:demo/type
                                               (d/entity database (:e datom)))))
                                    (d/datoms database :ave
                                              :demo/roles :subject))
                            (d/datoms database :ave :demo/roles :subject))
                          "objects"
                          (if type
                            (d/datoms database :ave :demo/type type)
                            (d/datoms database :ave :demo/type))
                          "relationships"
                          (let [datoms
                                (d/datoms database :ave
                                          relationship-storage/forward-attribute)]
                            (if type
                              (filter #(= type (nth (:v %) 2)) datoms)
                              datoms))
                          (fail! "validation-error"))]
                    (bounded-scan-count values ceiling check-active!))))]
          {:kind (:kind input) :value (min ceiling observed)
           :exact (<= observed ceiling) :ceiling ceiling})))}))
