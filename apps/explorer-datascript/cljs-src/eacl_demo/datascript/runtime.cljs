(ns eacl-demo.datascript.runtime
  (:require [datascript.core :as ds]
            [eacl-demo.fixture :as fixture]
            [eacl.core :as eacl]
            [eacl.datascript.core :as eacl-datascript]
            [clojure.set :as set]
            [goog.object :as gobj]))

(goog-define core-sha "0000000000000000000000000000000000000000")
(def ^:private profile-id "datascript-browser-memory")
(def ^:private contract-version "explorer.v1")
(def ^:private maximum-message-bytes 65536)
(def ^:private maximum-cursors 4096)
(def ^:private default-page-size 25)
(def ^:private default-count-ceiling 1000)
(def ^:private seed-batch-size 100)
(def ^:private operations
  #{"health" "bootstrap" "list-subjects" "get-object"
    "list-relationships" "reverse-relationships" "check-permission"
    "lookup-resources" "lookup-subjects" "count-resources"
    "get-schema" "get-cache-info" "count-objects"
    "seed-start" "seed-status" "seed-retry"})
(def ^:private unsupported-consistency
  #{"exact" "at-least" "authoritative" "historical-date"})
(def ^:private identity-keys
  #{:profileId :demoSha :eaclSha :artifactSha256 :deploymentId :dataManifestSha256})

(defonce ^:private lifecycle
  (atom {:identity nil
         :runtime nil
         :initialization nil}))

(defn- basis [runtime]
  {:behavior "page-lifecycle"
   :id (str profile-id ":" (:owner @lifecycle) ":page-tx-" (:max-tx (ds/db (:connection runtime))))
   :capturedAt (:captured-at runtime)
   :fixedForEnvironment false})

(defn- deployment-identity []
  (:identity @lifecycle))

(defn- response-meta [request runtime cache-status]
  (cond->
   {:revision (if runtime
                (:id (basis runtime))
                (:deploymentId (deployment-identity)))
    :requestId (:requestId request)
    :elapsedMs (max 0 (- (.now js/performance) (:startedAt request)))}
    cache-status (assoc :cacheStatus cache-status)))

(defn- success
  ([request runtime data]
   (success request runtime data nil))
  ([request runtime data cache-status]
   {:data data
    :meta (response-meta request runtime cache-status)}))

(defn- failure [request runtime code message]
  {:error {:code code :message message}
   :meta (response-meta request runtime nil)})

(defn- bootstrap-data [runtime]
  {:contract {:name contract-version :routeMajor 1 :revision 1 :minimumClientRevision 0}
   :identity (deployment-identity)
   :profile {:backend "datascript" :storage "browser-memory"}
   :runtime {:execution "browser" :name "clojurescript" :architecture "javascript" :snapStart "not-applicable"}
   :capabilities
   {:operations ["health" "bootstrap" "list-subjects" "get-object"
                 "list-relationships" "reverse-relationships" "check-permission"
                 "lookup-resources" "lookup-subjects" "count-resources"
                 "get-schema" "get-cache-info" "count-objects"]
    :consistencyModes ["minimize"]
    :snapshotBehavior "page-lifecycle"
    :cacheBehavior "browser-page-local"
    :mutationLocality "browser-local"
    :limitations ["browser-local" "ephemeral" "no-durability" "unequal-dataset-scale" "unsupported-consistency"]}
   :limits [{:name "message-bytes" :value maximum-message-bytes}
            {:name "page-size" :value 1000}
            {:name "fixture-resources" :value fixture/small-resource-count}]
   :dataset {:fixtureId fixture/fixture-id
             :logicalResourceCount (:resource-count runtime)
             :serverCount (:server-count runtime)
             :manifestSha256 fixture/small-manifest-sha256}
   :localSeed {:modified (> (:resource-count runtime) fixture/small-resource-count)
               :progress (:seed runtime)}
   :basis (basis runtime)})

(defn- health-data [runtime]
  {:status "ready"
   :ready true
   :identity (deployment-identity)
   :basis (basis runtime)})

(defn- authorization-data [runtime input]
  (let [subject-key [(:subjectType input) (:subjectId input)]
        resource-key [(:resourceType input) (:resourceId input)]
        subject (eacl/spice-object (keyword (:subjectType input)) (:subjectId input))
        resource (eacl/spice-object (keyword (:resourceType input)) (:resourceId input))
        request (cond-> {:subject subject
                         :permission (keyword (:permission input))
                         :resource resource
                         :cache? (not (false? (:cache input)))
                         :populate-cache? (not (false? (:populateCache input)))}
                  (= "minimize" (:consistency input))
                  (assoc :consistency :minimize-latency))
        decision (when (and (contains? (:objects runtime) subject-key)
                            (contains? (:objects runtime) resource-key))
                   (eacl/check-permission (:client runtime) request))
        allowed (true? (:allowed? decision))]
    {:data {:allowed allowed}
     :cache-status
     (cond
       (false? (:cache input)) "disabled"
       (true? (:cached? decision)) "hit"
       :else "miss")}))

(defn- normalized-relationship [record]
  {:resourceType (get-in record [:resource :type])
   :resourceId (get-in record [:resource :id])
   :relation (:relation record)
   :subjectType (get-in record [:subject :type])
   :subjectId (get-in record [:subject :id])
   :subjectRelation nil})

(defn- object-role [object]
  (some (fn [{:keys [name value]}]
          (when (= "fixtureRole" name) value))
        (:attributes object)))

(defn- random-token []
  (if (fn? (.-randomUUID js/crypto))
    (.randomUUID js/crypto)
    (let [bytes (js/Uint8Array. 16)]
      (.getRandomValues js/crypto bytes)
      (apply str (map #(.padStart (.toString % 16) 2 "0") (array-seq bytes))))))

(defn- issue-cursor! [runtime scope offset]
  (let [token (str "ds-" (random-token))]
    (swap! (:cursors runtime)
           (fn [{:keys [by-token order]}]
             (let [by-token (or by-token {})
                   order (or order [])
                   evicted (when (>= (count order) maximum-cursors) (first order))
                   retained (if evicted (dissoc by-token evicted) by-token)
                   next-order (cond-> order
                                evicted (subvec 1)
                                true (conj token))]
               {:by-token (assoc retained token {:scope scope :offset offset})
                :order next-order})))
    token))

(defn- cursor-offset [runtime scope cursor]
  (if (nil? cursor)
    0
    (let [entry (get-in @(:cursors runtime) [:by-token cursor])]
      (when-not entry
        (throw (ex-info "The browser-page cursor is unknown or expired."
                        {:code "cursor-invalid"})))
      (when-not (= scope (:scope entry))
        (throw (ex-info "The browser-page cursor belongs to another query."
                        {:code "cursor-scope-mismatch"})))
      (:offset entry))))

(defn- page-data [runtime items input scope]
  (let [items (vec items)
        offset (cursor-offset runtime scope (:cursor input))
        page-size (:pageSize input)
        page (vec (take page-size (drop offset items)))
        next-offset (+ offset (count page))
        has-next (< next-offset (count items))]
    {:items page
     :pageInfo {:hasNextPage has-next
                :endCursor (when has-next (issue-cursor! runtime scope next-offset))
                :pageSize (count page)}}))

(defn- list-subjects-data [runtime input]
  (let [subjects (cond->> (:subjects runtime)
                   (:type input) (filter #(= (:type input) (:type %)))
                   true (sort-by (juxt :type :id)))
        scope ["list-subjects" (:type input) (:pageSize input)]]
    (page-data runtime subjects input scope)))

(defn- object-data [runtime input]
  (when-let [object (get (:objects runtime) [(:type input) (:id input)])]
    {:object object}))

(defn- relationship-records [runtime input]
  (->> (:relationships runtime)
       (filter #(and (= (:resourceType input) (get-in % [:resource :type]))
                     (= (:resourceId input) (get-in % [:resource :id]))
                     (or (nil? (:relation input)) (= (:relation input) (:relation %)))))
       (sort-by (juxt #(get-in % [:resource :type])
                      #(get-in % [:resource :id])
                      :relation
                      #(get-in % [:subject :type])
                      #(get-in % [:subject :id])))))

(defn- relationships-data [runtime input]
  (let [scope ["list-relationships" (:resourceType input) (:resourceId input)
               (:relation input) (:consistency input) (:pageSize input)]]
    (page-data runtime (map normalized-relationship (relationship-records runtime input)) input scope)))

(defn- reverse-records [runtime input]
  (->> (:relationships runtime)
       (filter #(and (= (:subjectType input) (get-in % [:subject :type]))
                     (= (:subjectId input) (get-in % [:subject :id]))
                     (or (nil? (:relation input)) (= (:relation input) (:relation %)))))
       (sort-by (juxt #(get-in % [:resource :type])
                      #(get-in % [:resource :id])
                      :relation))))

(defn- reverse-data [runtime input]
  (let [objects (->> (reverse-records runtime input)
                     (map #(get (:objects runtime)
                                [(get-in % [:resource :type]) (get-in % [:resource :id])]))
                     (remove nil?)
                     (reduce (fn [acc object]
                               (assoc acc [(:type object) (:id object)] object)) {})
                     vals
                     (sort-by (juxt :type :id)))
        scope ["reverse-relationships" (:subjectType input) (:subjectId input)
               (:relation input) (:consistency input) (:pageSize input)]]
    (page-data runtime objects input scope)))

(defn- count-data [runtime input]
  (let [kind (:kind input)
        type (:type input)
        total (case kind
                "subjects" (count (filter #(and (= "subject" (object-role %))
                                                 (or (nil? type) (= type (:type %))))
                                          (vals (:objects runtime))))
                "objects" (count (filter #(and (= "resource" (object-role %))
                                                (or (nil? type) (= type (:type %))))
                                         (vals (:objects runtime))))
                "relationships" (if type
                                  (get-in runtime [:relationship-counts type] 0)
                                  (count (:relationships runtime))))
        ceiling (:ceiling input)
        exact (<= total ceiling)]
    {:kind kind
     :value (if exact total ceiling)
     :exact exact
     :ceiling (when-not exact ceiling)}))

(defn- wire-object [runtime object]
  (let [type (name (:type object))
        id (:id object)]
    (or (get (:objects runtime) [type id])
        {:type type :id id :displayName id :attributes []})))

(defn- wire-page [runtime result]
  (let [page-info (:page-info result)
        items (mapv #(wire-object runtime %) (:data result))
        has-next (true? (:has-next-page? page-info))]
    (when (and has-next (:end-cursor page-info))
      (swap! (:eacl-cursors runtime) conj (:end-cursor page-info)))
    {:items items
     :pageInfo {:hasNextPage has-next
                :endCursor (when has-next (:end-cursor page-info))
                :pageSize (count items)}}))

(defn- cached-status [result input]
  (cond
    (false? (:cache input)) "disabled"
    (true? (:cached? result)) "hit"
    :else "miss"))

(defn- common-query [input]
  (cond-> {:cache? (not (false? (:cache input)))
           :populate-cache? (not (false? (:populateCache input)))}
    (= "minimize" (:consistency input))
    (assoc :consistency :minimize-latency)))

(defn- lookup-resources-data [runtime input]
  (let [query (cond->
               (merge
                (common-query input)
                {:subject (eacl/spice-object (keyword (:subjectType input))
                                             (:subjectId input))
                 :resource/type (keyword (:resourceType input))
                 :permission (keyword (:permission input))
                 :first (:pageSize input)})
                (:cursor input) (assoc :after (:cursor input)))
        result (eacl/lookup-resources (:client runtime) query)]
    {:data (wire-page runtime result)
     :cache-status (cached-status result input)}))

(defn- lookup-subjects-data [runtime input]
  (let [query (cond->
               (merge
                (common-query input)
                {:resource (eacl/spice-object (keyword (:resourceType input))
                                              (:resourceId input))
                 :subject/type (keyword (:subjectType input))
                 :permission (keyword (:permission input))
                 :first (:pageSize input)})
                (:cursor input) (assoc :after (:cursor input)))
        result (eacl/lookup-subjects (:client runtime) query)]
    {:data (wire-page runtime result)
     :cache-status (cached-status result input)}))

(defn- count-resources-data [runtime input]
  (let [query (merge
               (common-query input)
               {:subject (eacl/spice-object (keyword (:subjectType input))
                                            (:subjectId input))
                :resource/type (keyword (:resourceType input))
                :permission (keyword (:permission input))
                :count-limit (:ceiling input)})
        result (eacl/count-resources (:client runtime) query)]
    {:data {:kind "objects"
            :value (:count result)
            :exact (not (true? (:truncated? result)))
            :ceiling (:ceiling input)}
     :cache-status (cached-status result input)}))

(defn- operation-metrics-snapshot [runtime]
  (into
   (sorted-map)
   (map
    (fn [[operation {:keys [count totalMs] :as metric}]]
      [operation
       (assoc metric :averageMs
              (if (pos? (or count 0)) (/ totalMs count) 0.0))]))
   @(:operation-metrics runtime)))

(defn- record-operation! [runtime request response]
  (let [operation (:operation request)
        elapsed-ms (max 0 (- (.now js/performance) (:startedAt request)))
        encoded (.encode (js/TextEncoder.)
                         (js/JSON.stringify (clj->js response)))
        response-bytes (.-length encoded)
        cache-status (get-in response [:meta :cacheStatus])
        success? (and (contains? response :data)
                      (not (contains? response :error)))]
    (swap! (:operation-metrics runtime)
           (fn [snapshot]
             (-> snapshot
                 (update-in [operation :count] (fnil inc 0))
                 (update-in [operation :totalMs] (fnil + 0.0) elapsed-ms)
                 (update-in [operation :maxMs] (fnil max 0.0) elapsed-ms)
                 (update-in [operation :responseBytes] (fnil + 0) response-bytes)
                 (cond-> cache-status
                   (update-in [operation :cacheStatus cache-status]
                              (fnil inc 0)))
                 (cond-> (not success?)
                   (update-in [operation :errors] (fnil inc 0)))))))
  nil)

(defn- cache-data [runtime]
  {:provider (eacl-datascript/cache-stats (:client runtime))
   :operations (operation-metrics-snapshot runtime)
   :capturedAt (.toISOString (js/Date.))})

(declare start-seed! retry-seed!)

(defn- dispatch [request runtime]
  (try
    (when (and (contains? #{"lookup-resources" "lookup-subjects"} (:operation request))
               (get-in request [:input :cursor])
               (not (contains? @(:eacl-cursors runtime) (get-in request [:input :cursor]))))
      (throw (ex-info "Stale cursor" {:code "cursor-invalid"})))
    (case (:operation request)
      "seed-start" (success request runtime (start-seed! runtime (:input request)))
      "seed-retry" (success request runtime (retry-seed! runtime))
      "seed-status" (success request runtime (:seed runtime))
      "health" (success request runtime (health-data runtime))
      "bootstrap" (success request runtime (bootstrap-data runtime))
      "list-subjects" (success request runtime (list-subjects-data runtime (:input request)))
      "get-object" (if-let [data (object-data runtime (:input request))]
                     (success request runtime data)
                     (failure request runtime "storage-missing" "The requested fixture object does not exist."))
      "list-relationships" (success request runtime (relationships-data runtime (:input request)))
      "reverse-relationships" (success request runtime (reverse-data runtime (:input request)))
      "check-permission" (let [{:keys [data cache-status]}
                               (authorization-data runtime (:input request))]
                           (success request runtime data cache-status))
      "lookup-resources" (let [{:keys [data cache-status]}
                               (lookup-resources-data runtime (:input request))]
                           (success request runtime data cache-status))
      "lookup-subjects" (let [{:keys [data cache-status]}
                              (lookup-subjects-data runtime (:input request))]
                          (success request runtime data cache-status))
      "count-resources" (let [{:keys [data cache-status]}
                              (count-resources-data runtime (:input request))]
                          (success request runtime data cache-status))
      "get-schema" (success request runtime fixture/wire-schema)
      "get-cache-info" (success request runtime (cache-data runtime))
      "count-objects" (success request runtime (count-data runtime (:input request)))
      (failure request runtime "validation-error"
               "This operation is outside the browser dispatcher."))
    (catch :default error
      (let [code (:code (ex-data error))]
        (case code
          "validation-error" (failure request runtime code (ex-message error))
          "cursor-invalid" (failure request runtime code "The cursor is invalid or expired.")
          "cursor-scope-mismatch" (failure request runtime code "The cursor belongs to another query or lifecycle.")
          (failure request runtime "internal-error"
                   "The browser-local explorer operation failed."))))))

(defn- normalized-object [record]
  (let [{:keys [type id]} (:object record)]
    {:type type
     :id id
     :displayName id
     :attributes [{:name "fixtureRole" :value (name (:role record))}]}))

(defn- add-record [accumulator record]
  (case (:kind record)
    :object
    (let [object (normalized-object record)
          key [(:type object) (:id object)]]
      (cond-> (assoc-in accumulator [:objects key] object)
        (and (= :subject (:role record))
             (not (contains? (:objects accumulator) key))) (update :subjects conj object)))

    :relationship
    (-> accumulator
        (update :relationships conj record)
        (update-in [:relationship-counts (name (get-in record [:resource :type]))] (fnil inc 0)))

    accumulator))

(defn- build-runtime []
  (let [snapshot (gobj/get js/window "__EACL_DATASCRIPT_SNAPSHOT__")
        connection (ds/conn-from-db (ds/from-serializable snapshot))
        client (eacl-datascript/make-client
                connection
                {:security-key (random-token)})
        records (mapcat :records (fixture/small-fixture-bundles))
        accumulator (reduce add-record
                            {:objects {} :subjects [] :relationships []}
                            records)
        runtime {:connection connection
                 :client client
                 :resource-count fixture/small-resource-count
                 :server-count 9922
                 :seed {:status "ready" :resourcesAdded 0 :resourcesCompleted 0
                        :resourcesTarget 0 :totalResources fixture/small-resource-count
                        :totalServers 9922}
                 :eacl-cursors (atom #{})
                 :cursors (atom {:by-token {} :order []})
                 :operation-metrics (atom {})
                 :captured-at (.toISOString (js/Date.))
                 :objects (:objects accumulator)
                 :subjects (:subjects accumulator)
                 :relationships (:relationships accumulator)
                 :relationship-counts (:relationship-counts accumulator)}]
    (when-not (eacl/acl? client)
      (throw (js/Error. "EACL DataScript adapter did not restore an authorization client.")))
    runtime))

(defn- ensure-runtime! []
  (let [{:keys [runtime initialization owner]} @lifecycle]
    (cond
      runtime (js/Promise.resolve runtime)
      initialization initialization
      :else
      (let [promise
            (js/Promise.
             (fn [resolve reject]
               (js/setTimeout
                (fn []
                  (try
                    (when (not= owner (:owner @lifecycle))
                      (throw (js/Error. "DataScript session was released.")))
                    (let [runtime (build-runtime)]
                      (swap! lifecycle assoc :runtime runtime :initialization nil)
                      (resolve runtime))
                    (catch :default error
                      (when (= owner (:owner @lifecycle))
                        (swap! lifecycle assoc :runtime nil :initialization nil))
                      (reject error))))
                0)))]
        (swap! lifecycle assoc :initialization promise)
        promise))))

(defn- relationship [record]
  (eacl/->Relationship
   (eacl/spice-object (keyword (get-in record [:subject :type]))
                      (get-in record [:subject :id]))
   (keyword (:relation record))
   (eacl/spice-object (keyword (get-in record [:resource :type]))
                      (get-in record [:resource :id]))))

(defn- commit-seed-batch [runtime bundles]
  ;; Build against a private connection. Only publish after both the database
  ;; and the auxiliary indexes succeed, so a failed batch has no partial commit.
  (let [records (mapcat :records bundles)
        connection (ds/conn-from-db (ds/db (:connection runtime)))
        client (eacl-datascript/make-client connection {:security-key (random-token)})
        objects (into [] (comp (filter #(= :object (:kind %))))
                      records)
        relationships (into [] (comp (filter #(= :relationship (:kind %))))
                            records)
        accumulator (reduce add-record runtime records)
        added (count bundles)
        servers (count (filter #(= "server" (get-in % [:resource :type])) bundles))
        completed (+ (get-in runtime [:seed :resourcesCompleted]) added)
        total (+ (:resource-count runtime) added)
        total-servers (+ (:server-count runtime) servers)]
    (ds/transact! connection (mapv (fn [record] {:eacl/id (get-in record [:object :id])}) objects))
    (eacl/create-relationships! client (mapv relationship relationships))
    (assoc accumulator
           :connection connection :client client
           :resource-count total :server-count total-servers
           :captured-at (.toISOString (js/Date.))
           :cursors (atom {:by-token {} :order []}) :eacl-cursors (atom #{})
           :seed (assoc (:seed runtime)
                        :resourcesAdded completed :resourcesCompleted completed
                        :totalResources total :totalServers total-servers))))

(defn- run-seed-batches! [owner remaining]
  (js/setTimeout
   (fn []
     (when (= owner (:owner @lifecycle))
       (let [runtime (:runtime @lifecycle)]
         (when (= "seeding" (get-in runtime [:seed :status]))
           (try
             (let [bundles (vec (take seed-batch-size remaining))
                   next-runtime (commit-seed-batch runtime bundles)
                   more (drop (count bundles) remaining)
                   done? (= (get-in next-runtime [:seed :resourcesCompleted])
                            (get-in next-runtime [:seed :resourcesTarget]))
                   next-runtime (cond-> next-runtime done?
                                        (assoc-in [:seed :status] "ready"))]
               (swap! lifecycle assoc :runtime next-runtime)
               (when-not done? (run-seed-batches! owner more)))
             (catch :default _
               (swap! lifecycle update :runtime
                      #(-> %
                           (assoc-in [:seed :status] "error")
                           (assoc-in [:seed :error] "Local seeding failed. Retry the remaining resources.")))))))))
   0))

(defn- local-resource-bundle [ordinal]
  ;; Bound endpoint fan-out: the current writer guards entire endpoint records.
  ;; Extending the canonical fixture's large account makes those guards grow on
  ;; every write. Local additions instead use one account per 100 new servers.
  (let [group (quot ordinal 101)
        account-id (str "local-account-" group)]
    (if (zero? (mod ordinal 101))
      {:resource (fixture/object "account" account-id)
       :records [(fixture/object-record :resource "account" account-id)
                 (fixture/relationship-record "platform" "platform" "platform" "account" account-id)
                 (fixture/relationship-record "user" "user-1" "owner" "account" account-id)]}
      (let [server-id (str "local-server-" ordinal)]
        {:resource (fixture/object "server" server-id)
         :records [(fixture/object-record :resource "server" server-id)
                   (fixture/relationship-record "account" account-id "account" "server" server-id)]}))))

(defn- schedule-seed! [runtime]
  (let [completed (:resource-count runtime)
        remaining (- (get-in runtime [:seed :resourcesTarget])
                     (get-in runtime [:seed :resourcesCompleted]))]
    (run-seed-batches! (:owner @lifecycle)
                       (map local-resource-bundle
                            (range (- completed fixture/small-resource-count)
                                   (+ (- completed fixture/small-resource-count) remaining))))
    (:seed runtime)))

(defn- start-seed! [runtime input]
  (let [amount (:resourceCount input)]
    (when (= "seeding" (get-in runtime [:seed :status]))
      (throw (ex-info "A seed job is already active."
                      {:code "validation-error"})))
    (let [next-runtime (assoc runtime :seed
                              {:status "seeding" :resourcesAdded 0 :resourcesCompleted 0
                               :resourcesTarget amount :totalResources (:resource-count runtime)
                               :totalServers (:server-count runtime)})]
      (swap! lifecycle assoc :runtime next-runtime)
      (schedule-seed! next-runtime))))

(defn- retry-seed! [runtime]
  (when-not (= "error" (get-in runtime [:seed :status]))
    (throw (ex-info "There is no failed seed job to resume." {:code "validation-error"})))
  (let [next-runtime (-> runtime (assoc-in [:seed :status] "seeding")
                         (update :seed dissoc :error))]
    (swap! lifecycle assoc :runtime next-runtime)
    (schedule-seed! next-runtime)))

(defn- valid-request-id? [value]
  (and (string? value)
       (boolean (re-matches #"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}" value))))

(defn- sha1? [value]
  (and (string? value)
       (boolean (re-matches #"[0-9a-f]{40}" value))))

(defn- sha256? [value]
  (and (string? value)
       (boolean (re-matches #"[0-9a-f]{64}" value))))

(defn- identifier? [value]
  (and (string? value)
       (<= (.-length (.encode (js/TextEncoder.) value)) 256)
       (boolean (re-matches #"[A-Za-z0-9][A-Za-z0-9._:@/-]*" value))))

(defn- consistency? [value]
  (contains? #{nil "minimize"} value))

(defn- page-size? [value]
  (and (integer? value) (<= 1 value 1000)))

(defn- cursor? [value]
  (and (string? value)
       (<= 1 (.-length (.encode (js/TextEncoder.) value)) 4096)))

(defn- exact-or-optional-keys? [keys required allowed]
  (and (set/subset? required keys)
       (set/subset? keys allowed)))

(defn- valid-operation-input? [request]
  (let [input (:input request)
        keys (set (keys input))]
    (case (:operation request)
      "seed-status" (empty? keys)
      "seed-retry" (empty? keys)
      "seed-start" (and (= keys #{:resourceCount})
                        (js/Number.isSafeInteger (:resourceCount input))
                        (<= 1 (:resourceCount input)))
      "health" (empty? keys)
      "bootstrap" (empty? keys)
      "list-subjects"
      (and (exact-or-optional-keys? keys #{} #{:type :pageSize :cursor})
           (or (nil? (:pageSize input)) (page-size? (:pageSize input)))
           (or (nil? (:type input)) (identifier? (:type input)))
           (or (nil? (:cursor input)) (cursor? (:cursor input))))
      "get-object"
      (and (exact-or-optional-keys? keys #{:type :id} #{:type :id :consistency})
           (identifier? (:type input))
           (identifier? (:id input))
           (consistency? (:consistency input)))
      "list-relationships"
      (and (exact-or-optional-keys?
            keys
            #{:resourceType :resourceId}
            #{:resourceType :resourceId :relation :consistency :pageSize :cursor})
           (every? identifier? ((juxt :resourceType :resourceId) input))
           (or (nil? (:relation input)) (identifier? (:relation input)))
           (consistency? (:consistency input))
           (or (nil? (:pageSize input)) (page-size? (:pageSize input)))
           (or (nil? (:cursor input)) (cursor? (:cursor input))))
      "reverse-relationships"
      (and (exact-or-optional-keys?
            keys
            #{:subjectType :subjectId}
            #{:subjectType :subjectId :relation :consistency :pageSize :cursor
              :cache :populateCache})
           (every? identifier? ((juxt :subjectType :subjectId) input))
           (or (nil? (:relation input)) (identifier? (:relation input)))
           (consistency? (:consistency input))
           (or (nil? (:cache input)) (boolean? (:cache input)))
           (or (nil? (:populateCache input)) (boolean? (:populateCache input)))
           (or (nil? (:pageSize input)) (page-size? (:pageSize input)))
           (or (nil? (:cursor input)) (cursor? (:cursor input))))
      "check-permission"
      (and (set/subset? #{:subjectType :subjectId :resourceType :resourceId :permission} keys)
           (set/subset? keys #{:subjectType :subjectId :resourceType :resourceId
                               :permission :consistency :cache :populateCache})
           (every? identifier? ((juxt :subjectType :subjectId :resourceType :resourceId :permission) input))
           (consistency? (:consistency input))
           (or (nil? (:cache input)) (boolean? (:cache input)))
           (or (nil? (:populateCache input)) (boolean? (:populateCache input))))
      "lookup-resources"
      (and (exact-or-optional-keys?
            keys
            #{:subjectType :subjectId :resourceType :permission}
            #{:subjectType :subjectId :resourceType :permission :pageSize
              :cursor :cache :populateCache :consistency})
           (every? identifier? ((juxt :subjectType :subjectId :resourceType :permission) input))
           (or (nil? (:pageSize input)) (page-size? (:pageSize input)))
           (or (nil? (:cursor input)) (cursor? (:cursor input)))
           (or (nil? (:cache input)) (boolean? (:cache input)))
           (or (nil? (:populateCache input)) (boolean? (:populateCache input)))
           (consistency? (:consistency input)))
      "lookup-subjects"
      (and (exact-or-optional-keys?
            keys
            #{:resourceType :resourceId :subjectType :permission}
            #{:resourceType :resourceId :subjectType :permission :pageSize
              :cursor :cache :populateCache :consistency})
           (every? identifier? ((juxt :resourceType :resourceId :subjectType :permission) input))
           (or (nil? (:pageSize input)) (page-size? (:pageSize input)))
           (or (nil? (:cursor input)) (cursor? (:cursor input)))
           (or (nil? (:cache input)) (boolean? (:cache input)))
           (or (nil? (:populateCache input)) (boolean? (:populateCache input)))
           (consistency? (:consistency input)))
      "count-resources"
      (and (exact-or-optional-keys?
            keys
            #{:subjectType :subjectId :resourceType :permission}
            #{:subjectType :subjectId :resourceType :permission :ceiling
              :cache :populateCache :consistency})
           (every? identifier? ((juxt :subjectType :subjectId :resourceType :permission) input))
           (or (nil? (:ceiling input))
               (and (integer? (:ceiling input))
                    (<= 1 (:ceiling input) 1000000)))
           (or (nil? (:cache input)) (boolean? (:cache input)))
           (or (nil? (:populateCache input)) (boolean? (:populateCache input)))
           (consistency? (:consistency input)))
      "get-schema"
      (and (exact-or-optional-keys? keys #{} #{:consistency})
           (consistency? (:consistency input)))
      "get-cache-info" (empty? keys)
      "count-objects"
      (and (exact-or-optional-keys? keys #{:kind}
                                    #{:kind :type :ceiling :consistency})
           (contains? #{"subjects" "objects" "relationships"} (:kind input))
           (or (nil? (:type input)) (identifier? (:type input)))
           (or (nil? (:ceiling input))
               (and (integer? (:ceiling input))
                    (<= 1 (:ceiling input) 1000000)))
           (consistency? (:consistency input)))
      false)))

(defn- normalize-operation-input [request]
  (let [operation (:operation request)
        input (:input request)
        paged? (contains? #{"list-subjects" "list-relationships" "reverse-relationships"
                            "lookup-resources" "lookup-subjects"} operation)
        consistent? (contains? #{"get-object" "list-relationships" "reverse-relationships"
                                 "check-permission" "lookup-resources" "lookup-subjects"
                                 "count-resources" "get-schema" "count-objects"} operation)]
    (cond-> input
      (and paged? (nil? (:pageSize input))) (assoc :pageSize default-page-size)
      (and consistent? (nil? (:consistency input))) (assoc :consistency "minimize")
      (and (= "count-resources" operation) (nil? (:ceiling input)))
      (assoc :ceiling default-count-ceiling)
      (and (= "count-objects" operation) (nil? (:ceiling input))) (assoc :ceiling default-count-ceiling))))

(defn- deployment-identity-valid? [identity]
  (and (= identity-keys (set (keys identity)))
       (= profile-id (:profileId identity))
       (sha1? (:demoSha identity))
       (= core-sha (:eaclSha identity))
       (sha256? (:artifactSha256 identity))
       (string? (:deploymentId identity))
       (<= 1 (count (:deploymentId identity)) 256)
       (= fixture/small-manifest-sha256 (:dataManifestSha256 identity))))

(defn- initialize! [raw-identity owner]
  (let [identity (js->clj raw-identity :keywordize-keys true)]
    (if-not (deployment-identity-valid? identity)
      (js/Promise.reject
       (js/Error. "The DataScript runtime identity does not match its compiled EACL and fixture closure."))
      (do
        (reset! lifecycle {:identity identity :runtime nil :initialization nil
                           :owner (or owner (random-token))})
        (js/Promise.resolve true)))))

(defn- request! [operation raw-input request-id owner]
  (let [generation (:owner @lifecycle)
        request {:operation operation
                 :input (js->clj raw-input :keywordize-keys true)
                 :requestId request-id
                 :startedAt (.now js/performance)}]
    (cond
      (or (nil? (:identity @lifecycle))
          (and owner (not= owner generation)))
      (js/Promise.reject (js/Error. "The DataScript runtime has not been initialized."))

      (contains? unsupported-consistency (get-in request [:input :consistency]))
      (js/Promise.resolve
       (clj->js (failure request (:runtime @lifecycle) "unsupported-consistency"
                         "DataScript does not retain exact or externally synchronized historical snapshots.")))

      (or (not (contains? operations operation))
          (not (valid-request-id? request-id))
          (> (count (keys (:input request))) 32)
          (not (valid-operation-input? request)))
      (js/Promise.resolve
       (clj->js (failure request (:runtime @lifecycle) "validation-error"
                         "The operation input failed closed validation.")))

      :else
      (let [request (update request :input #(normalize-operation-input (assoc request :input %)))]
        (-> (ensure-runtime!)
            (.then (fn [runtime]
                     (when (not= generation (:owner @lifecycle))
                       (throw (js/Error. "DataScript session was released.")))
                     (let [response (dispatch request runtime)]
                       (record-operation! runtime request response)
                       (clj->js response))))
            (.catch (fn [_]
                      (clj->js
                       (failure request nil "internal-error"
                                "The browser-local fixture could not be initialized.")))))))))

(defn- release! [owner]
  (if (and owner (not= owner (:owner @lifecycle)))
    false
    (do (reset! lifecycle {:identity nil :runtime nil :initialization nil :owner nil})
        true)))

(gobj/set js/window "EaclDataScriptRuntime"
          #js {:initialize initialize!
               :request request!
               :release release!})
