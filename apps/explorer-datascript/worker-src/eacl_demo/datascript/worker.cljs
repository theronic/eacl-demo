(ns eacl-demo.datascript.worker
  (:require [datascript.core :as ds]
            [eacl-demo.fixture :as fixture]
            [eacl.core :as eacl]
            [eacl.datascript.core :as eacl-datascript]
            [clojure.set :as set]))

(goog-define core-sha "0000000000000000000000000000000000000000")
(def ^:private profile-id "datascript-browser-memory")
(def ^:private contract-version "explorer.v1")
(def ^:private maximum-message-bytes 65536)
(def ^:private maximum-client-epoch 2147483647)
(def ^:private maximum-cursors 4096)
(def ^:private default-page-size 25)
(def ^:private default-count-ceiling 1000)
(def ^:private operations
  #{"health" "bootstrap" "list-subjects" "get-object"
    "list-relationships" "reverse-relationships" "authorize"
    "lookup-resources" "lookup-subjects" "count-resources"
    "get-schema" "get-cache-info" "count-objects"})
(def ^:private unsupported-consistency
  #{"exact" "at-least" "authoritative" "historical-date"})
(def ^:private request-keys
  #{:type :contractVersion :profileId :requestId :clientEpoch :operation :input})
(def ^:private control-keys
  #{:type :contractVersion :profileId :requestId :clientEpoch})
(def ^:private initialize-keys
  #{:type :contractVersion :profileId :requestId :clientEpoch :identity})
(def ^:private identity-keys
  #{:profileId :demoSha :eaclSha :artifactSha256 :deploymentId :dataManifestSha256})

(defonce ^:private lifecycle
  (atom {:epoch 0
         :identity nil
         :runtime nil
         :initialization nil
         :requests {}
         :waiters {}
         :canceled #{}}))

(defn- current-epoch? [epoch]
  (= epoch (:epoch @lifecycle)))

(defn- active-request? [epoch request-id]
  (let [state @lifecycle]
    (and (= epoch (:epoch state))
         (contains? (:requests state) request-id)
         (not (contains? (:canceled state) request-id)))))

(defn- post-event! [event]
  (.postMessage js/self (clj->js event)))

(defn- event-base [type request]
  {:type type
   :contractVersion contract-version
   :profileId profile-id
   :requestId (:requestId request)
   :clientEpoch (:clientEpoch request)})

(defn- post-progress! [request phase completed message]
  (when (current-epoch? (:clientEpoch request))
    (post-event!
     (assoc (event-base "progress" request)
            :phase phase
            :completed completed
            :total fixture/small-resource-count
            :message message))))

(defn- protocol-error! [request code message]
  (post-event!
   (assoc (event-base "protocol-error" request)
          :error {:code code :message message :retryable false})))

(defn- basis [runtime epoch]
  {:behavior "worker-lifecycle"
   :id (str profile-id ":epoch-" epoch ":tx-" (:max-tx (ds/db (:connection runtime))))
   :capturedAt (:captured-at runtime)
   :fixedForEnvironment false})

(defn- deployment-identity []
  (:identity @lifecycle))

(defn- response-meta [request runtime cache-status]
  (cond->
   {:revision (if runtime
                (:id (basis runtime (:clientEpoch request)))
                (:deploymentId (deployment-identity)))
    :requestId (:requestId request)
    :elapsedMs (max 0 (- (.now js/performance) (:startedAt request)))}
   cache-status (assoc :cacheStatus cache-status)))

(defn- post-response! [request response]
  (when (current-epoch? (:clientEpoch request))
    (post-event!
     (assoc (event-base "response" request) :response response)))
  (swap! lifecycle
         (fn [state]
           (-> state
               (update :requests dissoc (:requestId request))
               (update :waiters dissoc (:requestId request))
               (update :canceled disj (:requestId request))))))

(defn- success!
  ([request runtime data]
   (success! request runtime data nil))
  ([request runtime data cache-status]
   (when (active-request? (:clientEpoch request) (:requestId request))
     (post-response!
      request
      {:data data
       :meta (response-meta request runtime cache-status)}))))

(defn- failure! [request runtime code message]
  (when (current-epoch? (:clientEpoch request))
    (post-response!
     request
     {:error {:code code :message message}
      :meta (response-meta request runtime nil)})))

(defn- bootstrap-data [runtime epoch]
  {:contract {:name contract-version :routeMajor 1 :revision 1 :minimumClientRevision 0}
   :identity (deployment-identity)
   :profile {:backend "datascript" :storage "browser-memory"}
   :runtime {:execution "browser-worker" :name "clojurescript" :architecture "javascript" :snapStart "not-applicable"}
   :capabilities
   {:operations ["health" "bootstrap" "list-subjects" "get-object"
                 "list-relationships" "reverse-relationships" "authorize"
                 "lookup-resources" "lookup-subjects" "count-resources"
                 "get-schema" "get-cache-info" "count-objects"]
    :consistencyModes ["current" "minimize"]
    :snapshotBehavior "worker-lifecycle"
    :cacheBehavior "browser-worker-local"
    :mutationLocality "browser-worker-initialization"
    :limitations ["browser-local" "ephemeral" "no-durability" "unequal-dataset-scale" "unsupported-consistency"]}
   :limits [{:name "message-bytes" :value maximum-message-bytes}
            {:name "page-size" :value 1000}
            {:name "fixture-resources" :value fixture/small-resource-count}]
   :dataset {:fixtureId fixture/fixture-id
             :logicalResourceCount fixture/small-resource-count
             :serverCount 9922
             :manifestSha256 fixture/small-manifest-sha256}
   :basis (basis runtime epoch)})

(defn- health-data [runtime epoch]
  {:status "ready"
   :ready true
   :identity (deployment-identity)
   :basis (basis runtime epoch)})

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
        (throw (ex-info "The browser-worker cursor is unknown or expired."
                        {:code "cursor-invalid"})))
      (when-not (= scope (:scope entry))
        (throw (ex-info "The browser-worker cursor belongs to another query."
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
                "relationships" (count (filter #(or (nil? type)
                                                      (= type (get-in % [:resource :type])))
                                               (:relationships runtime))))
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

(defn- cache-data []
  {:behavior "browser-worker-local"
   :hit nil
   :scope "current-worker-lifecycle"
   :entries nil
   :limitations ["Cache state is ephemeral and is discarded with this worker lifecycle."]})

(defn- dispatch! [request runtime]
  (when (active-request? (:clientEpoch request) (:requestId request))
    (try
      (case (:operation request)
        "health" (success! request runtime (health-data runtime (:clientEpoch request)))
        "bootstrap" (success! request runtime (bootstrap-data runtime (:clientEpoch request)))
        "list-subjects" (success! request runtime (list-subjects-data runtime (:input request)))
        "get-object" (if-let [data (object-data runtime (:input request))]
                       (success! request runtime data)
                       (failure! request runtime "storage-missing" "The requested fixture object does not exist."))
        "list-relationships" (success! request runtime (relationships-data runtime (:input request)))
        "reverse-relationships" (success! request runtime (reverse-data runtime (:input request)))
        "authorize" (let [{:keys [data cache-status]}
                          (authorization-data runtime (:input request))]
                      (success! request runtime data cache-status))
        "lookup-resources" (let [{:keys [data cache-status]}
                                 (lookup-resources-data runtime (:input request))]
                             (success! request runtime data cache-status))
        "lookup-subjects" (let [{:keys [data cache-status]}
                                (lookup-subjects-data runtime (:input request))]
                            (success! request runtime data cache-status))
        "count-resources" (let [{:keys [data cache-status]}
                                (count-resources-data runtime (:input request))]
                            (success! request runtime data cache-status))
        "get-schema" (success! request runtime fixture/wire-schema)
        "get-cache-info" (success! request runtime (cache-data))
        "count-objects" (success! request runtime (count-data runtime (:input request)))
        (failure! request runtime "validation-error"
                  "This operation is outside the worker dispatcher."))
      (catch :default error
        (let [code (:code (ex-data error))]
          (case code
            "cursor-invalid" (failure! request runtime code "The cursor is invalid or expired.")
            "cursor-scope-mismatch" (failure! request runtime code "The cursor belongs to another query or lifecycle.")
            (failure! request runtime "internal-error"
                      "The browser-local explorer operation failed.")))))))

(defn- relationship [record]
  (eacl/->Relationship
   (eacl/spice-object (keyword (get-in record [:subject :type]))
                      (get-in record [:subject :id]))
   (keyword (:relation record))
   (eacl/spice-object (keyword (get-in record [:resource :type]))
                      (get-in record [:resource :id]))))

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
        (= :subject (:role record)) (update :subjects conj object)))

    :relationship
    (update accumulator :relationships conj record)

    accumulator))

(defn- active-initialization-request []
  (some (fn [request]
          (when (active-request? (:clientEpoch request) (:requestId request))
            request))
        (vals (:waiters @lifecycle))))

(defn- seed-fixture! [request runtime]
  (js/setTimeout
   (fn []
     (if-let [progress-request (active-initialization-request)]
       (try
         (let [records (mapcat :records (fixture/small-fixture-bundles))
               objects (into [] (comp (filter #(= :object (:kind %)))
                                      (map (fn [record]
                                             {:eacl/id (get-in record [:object :id])})))
                             records)
               relationships (into [] (comp (filter #(= :relationship (:kind %)))
                                            (map relationship))
                                   records)
               accumulator (reduce add-record
                                   {:objects {} :subjects [] :relationships []}
                                   records)]
           (post-progress! progress-request "fixture-seed" 0
                           "Seeding the deterministic fixture into browser memory.")
           (when (seq objects)
             (ds/transact! (:connection runtime) objects))
           (when (seq relationships)
             (eacl/create-relationships! (:client runtime) relationships))
           (let [ready-runtime (assoc runtime
                                      :objects (:objects accumulator)
                                      :subjects (:subjects accumulator)
                                      :relationships (:relationships accumulator))
                 state @lifecycle
                 waiters (vals (:waiters state))]
             (when (= (:clientEpoch progress-request) (:epoch state))
               (swap! lifecycle assoc :runtime ready-runtime :initialization nil :waiters {})
               (post-progress! progress-request "ready" fixture/small-resource-count
                               "The deterministic 10,000-resource fixture is ready.")
               (doseq [waiter waiters]
                 (js/setTimeout #(dispatch! waiter ready-runtime) 0)))))
         (catch :default _
           (let [state @lifecycle
                 waiters (vals (:waiters state))]
             (swap! lifecycle assoc :runtime nil :initialization nil :waiters {})
             (doseq [waiter waiters]
               (failure! waiter nil "internal-error"
                         "The browser-local fixture could not be initialized.")))))
       (do
         (post-progress! request "canceled" 0
                         "Fixture initialization was canceled and its worker-owned state was released.")
         (swap! lifecycle assoc :initialization nil :runtime nil :waiters {}))))
   0))

(defn- start-initialization! [request]
  (try
    (let [connection (eacl-datascript/create-conn)
          client (eacl-datascript/make-client connection {})
          runtime {:connection connection
                   :client client
                   :cursors (atom {:by-token {} :order []})
                   :captured-at (.toISOString (js/Date.))}]
      (when-not (eacl/acl? client)
        (throw (js/Error. "EACL DataScript adapter did not create an authorization client.")))
      (swap! lifecycle assoc :initialization {:requestId (:requestId request)} :runtime nil)
      (post-progress! request "fixture-generation" 0 "Generating the deterministic canonical fixture inside this worker.")
      (eacl/write-schema! client fixture/schema)
      (seed-fixture! request runtime))
    (catch :default _
      (swap! lifecycle assoc :initialization nil :runtime nil :waiters {})
      (failure! request nil "internal-error"
                "The EACL DataScript adapter could not start."))))

(defn- ensure-runtime! [request]
  (let [{:keys [runtime initialization]} @lifecycle]
    (cond
      runtime (js/setTimeout #(dispatch! request runtime) 0)
      initialization (swap! lifecycle assoc-in [:waiters (:requestId request)] request)
      :else (do
              (swap! lifecycle assoc-in [:waiters (:requestId request)] request)
              (start-initialization! request)))))

(defn- message-bytes [value]
  (try
    (.-length (.encode (js/TextEncoder.) (.stringify js/JSON value)))
    (catch :default _
      (inc maximum-message-bytes))))

(defn- valid-request-id? [value]
  (and (string? value)
       (boolean (re-matches #"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}" value))))

(defn- sha1? [value]
  (and (string? value)
       (boolean (re-matches #"[0-9a-f]{40}" value))))

(defn- sha256? [value]
  (and (string? value)
       (boolean (re-matches #"[0-9a-f]{64}" value))))

(defn- valid-epoch? [value]
  (and (number? value)
       (js/Number.isSafeInteger value)
       (<= 1 value maximum-client-epoch)))

(defn- identifier? [value]
  (and (string? value)
       (<= (.-length (.encode (js/TextEncoder.) value)) 256)
       (boolean (re-matches #"[A-Za-z0-9][A-Za-z0-9._:@/-]*" value))))

(defn- consistency? [value]
  (contains? #{nil "current" "minimize"} value))

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
      "authorize"
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
                                 "authorize" "lookup-resources" "lookup-subjects"
                                 "count-resources" "get-schema" "count-objects"} operation)]
    (cond-> input
      (and paged? (nil? (:pageSize input))) (assoc :pageSize default-page-size)
      (and consistent? (nil? (:consistency input))) (assoc :consistency "current")
      (and (= "count-resources" operation) (nil? (:ceiling input)))
      (assoc :ceiling default-count-ceiling)
      (and (= "count-objects" operation) (nil? (:ceiling input))) (assoc :ceiling default-count-ceiling))))

(defn- base-valid? [message]
  (and (= contract-version (:contractVersion message))
       (= profile-id (:profileId message))
       (valid-request-id? (:requestId message))
       (valid-epoch? (:clientEpoch message))))

(defn- input-object? [value]
  (and (some? value)
       (= "object" (goog/typeOf value))
       (not (array? value))))

(defn- request-valid? [raw message]
  (and (= request-keys (set (keys message)))
       (= "request" (:type message))
       (base-valid? message)
       (contains? operations (:operation message))
       (input-object? (.-input raw))
       (<= (count (keys (:input message))) 32)))

(defn- control-valid? [message expected-type]
  (and (= control-keys (set (keys message)))
       (= expected-type (:type message))
       (base-valid? message)))

(defn- initialize-valid? [message]
  (and (= initialize-keys (set (keys message)))
       (= "initialize" (:type message))
       (base-valid? message)
       (map? (:identity message))))

(defn- deployment-identity-valid? [identity]
  (and (= identity-keys (set (keys identity)))
       (= profile-id (:profileId identity))
       (sha1? (:demoSha identity))
       (= core-sha (:eaclSha identity))
       (sha256? (:artifactSha256 identity))
       (string? (:deploymentId identity))
       (<= 1 (count (:deploymentId identity)) 256)
       (= fixture/small-manifest-sha256 (:dataManifestSha256 identity))))

(defn- cleanup-for-epoch! [epoch]
  (let [identity (:identity @lifecycle)]
    (reset! lifecycle {:epoch epoch
                       :identity identity
                       :runtime nil
                       :initialization nil
                       :requests {}
                       :waiters {}
                       :canceled #{}})))

(defn- initialize-worker! [request]
  (let [epoch (:clientEpoch request)
        current (:epoch @lifecycle)
        identity (:identity request)
        active-identity (:identity @lifecycle)]
    (cond
      (< epoch current) nil
      (not (deployment-identity-valid? identity))
      (protocol-error! request "identity-mismatch" "The worker identity does not match its compiled EACL and fixture closure.")
      (and active-identity (not= active-identity identity))
      (protocol-error! request "identity-mismatch" "The worker lifecycle is already bound to another deployment identity.")
      :else
      (do
        (cleanup-for-epoch! epoch)
        (swap! lifecycle assoc :identity identity)
        (post-event! (assoc (event-base "initialized" request) :identity identity))))))

(defn- accept-request! [request]
  (let [request (assoc request :startedAt (.now js/performance))
        epoch (:clientEpoch request)
        current (:epoch @lifecycle)]
    (cond
      (< epoch current) nil
      (> epoch current) (do (cleanup-for-epoch! epoch)
                            (accept-request! request))
      (nil? (:identity @lifecycle))
      (protocol-error! request "identity-mismatch" "The worker identity handshake must complete before operations begin.")
      (get-in @lifecycle [:requests (:requestId request)])
      (protocol-error! request "validation-error" "The request ID is already active in this client epoch.")
      (contains? unsupported-consistency (get-in request [:input :consistency]))
      (do
        (swap! lifecycle assoc-in [:requests (:requestId request)] request)
        (failure! request nil "unsupported-consistency"
                  "DataScript does not retain exact or externally synchronized historical snapshots."))
      (not (valid-operation-input? request))
      (protocol-error! request "validation-error" "The operation input failed closed validation.")
      :else
      (let [request (assoc request
                           :input (normalize-operation-input request))]
        (swap! lifecycle assoc-in [:requests (:requestId request)] request)
        (ensure-runtime! request)))))

(defn- cancel-request! [request]
  (when (= (:clientEpoch request) (:epoch @lifecycle))
    (when-let [active (get-in @lifecycle [:requests (:requestId request)])]
      (swap! lifecycle
             (fn [state]
               (-> state
                   (update :requests dissoc (:requestId request))
                   (update :waiters dissoc (:requestId request))
                   (update :canceled conj (:requestId request)))))
      (failure! active (:runtime @lifecycle) "canceled" "The browser-local request was canceled."))))

(defn- reset-worker! [request]
  (let [epoch (:clientEpoch request)]
    (when (> epoch (:epoch @lifecycle))
      (cleanup-for-epoch! epoch)
      (let [bootstrap-request (assoc request
                                     :type "request"
                                     :operation "bootstrap"
                                     :input {}
                                     :startedAt (.now js/performance))]
        (swap! lifecycle assoc-in [:requests (:requestId request)] bootstrap-request)
        (ensure-runtime! bootstrap-request)))))

(defn- handle-message [event]
  (let [raw (.-data event)
        bytes (message-bytes raw)
        message (when (and (<= bytes maximum-message-bytes)
                           (= "object" (goog/typeOf raw))
                           (not (array? raw)))
                  (js->clj raw :keywordize-keys true))
        request-id (:requestId message)
        epoch (:clientEpoch message)]
    (cond
      (nil? message) nil
      (and (valid-epoch? epoch) (< epoch (:epoch @lifecycle))) nil
      (initialize-valid? message) (initialize-worker! message)
      (request-valid? raw message) (accept-request! message)
      (control-valid? message "cancel") (cancel-request! message)
      (control-valid? message "reset") (reset-worker! message)
      (and (valid-request-id? request-id) (valid-epoch? epoch))
      (protocol-error! message "validation-error" "The worker message failed closed validation.")
      :else nil)))

(set! (.-onmessage js/self) handle-message)
