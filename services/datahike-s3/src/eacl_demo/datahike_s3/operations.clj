(ns eacl-demo.datahike-s3.operations
  "Bounded explorer operations over one immutable Datahike/EACL snapshot."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [datahike.api :as d]
            [eacl-demo.contracts.response-meta :as response-meta]
            [eacl.core :as eacl]
            [eacl.datahike.core :as datahike-eacl]
            [eacl.relationships.storage :as relationship-storage]
            [eacl.secure-format :as secure]))

(def ^:private default-page-size 20)
(def ^:private default-count-ceiling 1000000)
(def ^:private cursor-ttl-ms (* 15 60 1000))
(def ^:private cursor-prefix "eacl-demo-subjects-v1.")
(def ^:private cursor-domain "eacl-demo/datahike-s3/list-subjects/v1")
(def ^:private legacy-type-attribute :demo/type)
(def ^:private legacy-subject-type :user)
(def ^:private legacy-object-counts
  {:user 1586 :server 1000000 :account 228 :team 903 :vpc 452 :platform 1})
(def ^:private legacy-server-count 1000000)
(def ^:private base-account-count 4)
(def ^:private base-servers-per-account 12)
(def ^:private cursor-payload-keys
  #{:version :operation :query :after :basis-id :expires-at-ms})

(declare bounded-scan-count decode-subject-cursor eacl-consistency encode-subject-cursor fail!
         guarded object-exists? relationship-datoms subject-rows
         relationship-query wire-object wire-page-info
         wire-relationship wire-relationship-page)

(defn- weighted-account-server-count
  [account-number]
  (let [random (java.util.SplittableRandom.
                (long (+ 20260813 (* 104729 account-number))))
        selection (.nextDouble random)
        [minimum maximum]
        (cond
          (< selection 0.55) [1 2000]
          (< selection 0.84) [2001 7500]
          (< selection 0.96) [7501 20000]
          :else [20001 50000])]
    (.nextLong random (long minimum) (long (inc maximum)))))

(defn- requested-account-plan
  [account-start server-count]
  (loop [account-number account-start
         remaining server-count
         plan []]
    (if (pos? remaining)
      (let [account-size (min remaining
                              (weighted-account-server-count account-number))]
        (recur (inc account-number) (- remaining account-size)
               (conj plan {:account-number account-number
                           :server-count account-size})))
      plan)))

(defn- account-user-ids
  [{:keys [account-number server-count]}]
  (let [account-id (str "account-" account-number)
        teams (if (< account-number base-account-count)
                2 (min 4 server-count))
        vpcs (if (< account-number base-account-count)
               1 (min 2 server-count))]
    (concat
     [(str account-id "-owner")]
     (map #(str account-id "-team-" % "-leader") (range teams))
     (map #(str account-id "-vpc-" % "-admin") (range vpcs)))))

(def ^:private legacy-subject-rows
  ;; The adopted immutable store was seeded by this exact deterministic plan.
  ;; Keeping its tiny principal catalog in-process avoids scanning the million-
  ;; resource S3 index for every explorer page.
  (let [base (mapv (fn [account-number]
                     {:account-number account-number
                      :server-count base-servers-per-account})
                   (range base-account-count))
        extra (requested-account-plan
               base-account-count
               (- legacy-server-count
                  (* base-account-count base-servers-per-account)))
        rows (->> (concat ["super-user" "user-1" "user-2"]
                          (mapcat account-user-ids (concat base extra)))
                  distinct
                  sort
                  (mapv (fn [id] [legacy-subject-type id])))]
    (when-not (= (legacy-object-counts legacy-subject-type) (count rows))
      (throw (ex-info "Legacy Datahike subject catalog identity mismatch."
                      {:type :eacl-demo/fixture-identity-mismatch})))
    rows))

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
                 (= "datahike-s3" (get-in descriptor [:identity :profileId]))
                 (string? cursor-key)
                 (<= 32 (count (.getBytes ^String cursor-key "UTF-8")))
                 (fn? clock))
    (throw (ex-info "Invalid Datahike/S3 operation configuration."
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

     "bootstrap" (fn [{:keys [basis]}] (assoc descriptor :basis basis))

     "list-subjects"
     (guarded
      (fn [{:keys [snapshot basis input check-active!]}]
        (let [database (datahike-eacl/db snapshot)
              page-size (or (:pageSize input) default-page-size)
              query {:type (:type input)}
              after (when-let [token (:cursor input)]
                      (decode-subject-cursor cursor-options token query
                                             (:id basis) (clock)))
              rows (->> (subject-rows database (:type query))
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
        (let [database (datahike-eacl/db snapshot)
              entity (d/entity database [:eacl/id (:id input)])]
          (check-active!)
          (if (= (keyword (:type input)) (legacy-type-attribute entity))
            {:object (wire-object (legacy-type-attribute entity) (:id input))}
            (fail! "validation-error")))))

     "list-relationships"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [page (eacl/read-relationships
                    snapshot
                    (relationship-query input
                                        {:resource/type
                                         (keyword (:resourceType input))
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
                                        {:subject/type
                                         (keyword (:subjectType input))
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
        (let [database (datahike-eacl/db snapshot)
              subject-known? (object-exists? database (:subjectType input)
                                             (:subjectId input) :subject)
              resource-known? (object-exists? database (:resourceType input)
                                              (:resourceId input) nil)
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
           {:subjectType (:subjectType input)
            :subjectId (:subjectId input)
            :resourceType (:resourceType input)
            :resourceId (:resourceId input)
            :permission (:permission input)
            :allowed allowed?
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
       {:behavior "environment-local"
        :hit nil
        :scope "datahike-s3"
        :entries nil
        :limitations ["read-only-store" "request-snapshot"]})

     "count-objects"
     (guarded
      (fn [{:keys [snapshot input check-active!]}]
        (let [database (datahike-eacl/db snapshot)
              ceiling (or (:ceiling input) default-count-ceiling)
              kind (:kind input)
              type (some-> (:type input) keyword)
              exact-total
              (case kind
                "subjects" (if (or (nil? type) (= legacy-subject-type type))
                             (legacy-object-counts legacy-subject-type) 0)
                "objects" (if type
                            (get legacy-object-counts type 0)
                            (reduce + (vals legacy-object-counts)))
                "relationships" nil
                (fail! "validation-error"))
              observed (if (some? exact-total)
                         exact-total
                         (bounded-scan-count
                          (relationship-datoms database type)
                          ceiling check-active!))]
          {:kind kind
           :value (min ceiling observed)
           :exact (<= observed ceiling)
           :ceiling ceiling})))}))

(defn- eacl-consistency
  [_input]
  ;; The boundary has already pinned the operation to an immutable snapshot.
  :minimize-latency)

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

(defn- object-exists?
  [database type id required-role]
  (let [entity (d/entity database [:eacl/id id])]
    (and (= (keyword type) (legacy-type-attribute entity))
         (or (nil? required-role)
             (and (= :subject required-role)
                  (= legacy-subject-type (legacy-type-attribute entity)))))))

(defn- subject-rows
  [database requested-type]
  (let [requested (some-> requested-type keyword)]
    (if (and requested (not= legacy-subject-type requested))
      []
      legacy-subject-rows)))

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
  (throw (ex-info "Datahike/S3 explorer operation failed." {:code code})))
