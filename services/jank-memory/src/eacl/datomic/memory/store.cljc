(ns eacl.datomic.memory.store
  "Mutable connection handle publishing immutable database snapshots atomically."
  (:require [eacl.datomic.memory.db :as memory-db]
            [eacl.datomic.memory.order :as order]
            [eacl.datomic.memory.token :as token]
            [eacl.datomic.memory.transaction :as transaction]
            [clojure.string :as str]
            [eacl.runtime.native.clock :as clock]
            [eacl.runtime.native.crypto :as crypto]
            [eacl.secure-keyring :as secure-keyring]))

(def ^:private connection-kind ::connection)
(def ^:private connection-fields #{::kind :state :config :token-cache})
(def ^:private atom-type (type (atom nil)))
(def ^:private option-keys
  #{:history-limit :reference-attributes :cardinality-many-attributes
    :unique-attributes :token-keyring :token-ttl-seconds})
(def ^:private built-in-cardinality-many-attributes
  #{:eacl.v7.relationship/subject-type+relation+resource-type+resource
    :eacl.v7.relationship/resource-type+relation+subject-type+subject})

(defn- store-error!
  [reason data]
  (throw
   (ex-info
    "Invalid EACL memory-store connection or configuration."
    (merge {:type :eacl.store/invalid-connection
            :eacl/error :eacl.store/invalid-connection
            :reason reason}
           data))))

(defn- keyword-set?
  [value]
  (and (set? value) (every? keyword? value)))

(defn- normalized-keyring
  [value]
  (cond
    (nil? value)
    (secure-keyring/keyring
     {:active-kid "default"
      :keys {"default" (crypto/secure-random-hex 32)}})

    (secure-keyring/keyring? value) value
    :else (secure-keyring/keyring value)))

(defn- normalize-config
  [options]
  (when-not (and (map? options)
                 (every? option-keys (keys options)))
    (store-error! :unknown-options {}))
  (let [history-limit (or (:history-limit options) 64)
        reference-attributes (or (:reference-attributes options) #{})
        cardinality-many-attributes
        (into built-in-cardinality-many-attributes
              (or (:cardinality-many-attributes options) #{}))
        unique-attributes (conj (or (:unique-attributes options) #{})
                                :eacl/id)
        token-ttl-seconds (or (:token-ttl-seconds options) 3600)]
    (when-not (and (integer? history-limit)
                   (<= 1 history-limit 4096))
      (store-error! :invalid-history-limit {}))
    (when-not (and (keyword-set? reference-attributes)
                   (keyword-set? cardinality-many-attributes)
                   (keyword-set? unique-attributes))
      (store-error! :invalid-attribute-schema {}))
    ;; Pinned Jank miscomputes clojure.set/intersection for this disjoint
    ;; keyword-set shape, so configuration validation uses direct membership.
    (when (some #(contains? cardinality-many-attributes %)
                unique-attributes)
      (store-error! :unique-attribute-cannot-be-many {}))
    (when-not (and (integer? token-ttl-seconds)
                   (<= 1 token-ttl-seconds 604800))
      (store-error! :invalid-token-ttl {}))
    {:history-limit history-limit
     :reference-attributes reference-attributes
     :cardinality-many-attributes cardinality-many-attributes
     :unique-attributes unique-attributes
     :token-keyring (normalized-keyring (:token-keyring options))
     :token-ttl-seconds token-ttl-seconds}))

(defn connect
  ([]
   (connect {}))
  ([options]
   ;; Randomness is deliberately outside every retryable atom transition.
   (let [config (normalize-config options)
         initial-db (memory-db/database
                     0 [] (:reference-attributes config))
         initial-state
         {:store-id (crypto/secure-random-hex 16)
          :lifecycle-id (crypto/secure-random-hex 16)
          :basis (bigint 0)
          :next-eid (bigint 1)
          :current initial-db
          :history {(bigint 0) initial-db}
          :last-transaction nil}]
     {::kind connection-kind
      :state (atom initial-state)
      ;; Causal tokens are immutable, authenticated descriptions of a source
      ;; identity and basis. Reissuing the same description for every point or
      ;; discovery request was pure allocation/HMAC churn and also defeated
      ;; the cursor-codec cache because the embedded token changed each
      ;; second. This cache retains only the current issuance bucket.
      :token-cache (atom {})
      :config config})))

(defn connection?
  [value]
  (and (map? value)
       (= connection-fields (set (keys value)))
       (= connection-kind (::kind value))
       (= atom-type (type (:state value)))
       (= atom-type (type (:token-cache value)))
       (map? (:config value))))

(defn- require-connection!
  [value]
  (when-not (connection? value)
    (store-error! :invalid-connection-value {}))
  value)

(defn db
  [connection]
  (:current @(-> connection require-connection! :state)))

(defn basis-t
  [connection]
  (:basis @(-> connection require-connection! :state)))

(defn identities
  [connection]
  (let [state @(-> connection require-connection! :state)]
    {:store-id (:store-id state)
     :lifecycle-id (:lifecycle-id state)}))

(defn config
  [connection]
  (:config (require-connection! connection)))

(defn- retain-history
  [history history-limit]
  (loop [history history]
    (if (<= (count history) history-limit)
      history
      (recur (dissoc history (first (sort (keys history))))))))

(defn- token-issued-at
  [config issued-at]
  (let [ttl (:token-ttl-seconds config)
        width (max 1 (min 60 (quot ttl 4)))]
    (* (quot issued-at width) width)))

(defn- issue-token
  [state config revision issued-at]
  (token/issue
   {:store-id (:store-id state)
    :lifecycle-id (:lifecycle-id state)
    :revision revision
    :issued-at (token-issued-at config issued-at)
    :ttl-seconds (:token-ttl-seconds config)
    :keyring (:token-keyring config)}))

(defn causal-token-for
  "Return the stable authenticated token for `revision` in the current short
  issuance bucket. This internal backend seam is public only because the
  adapter's consistency namespace is separate from the store namespace."
  [connection revision issued-at]
  (let [connection (require-connection! connection)
        config (:config connection)
        state @(:state connection)
        stable-issued-at (token-issued-at config issued-at)
        active-kid (get-in config [:token-keyring :active-kid])
        key [revision stable-issued-at active-kid]
        token-cache (:token-cache connection)]
    (when-not (and (order/non-negative-id? revision)
                   (order/non-negative-id? issued-at))
      (store-error! :invalid-token-revision-or-time {}))
    (if-let [cached (get @token-cache key)]
      cached
      (let [built (issue-token state config revision issued-at)]
        (get
         (swap! token-cache
                #(if (contains? % key) % {key built}))
         key)))))

(defn- exact-first
  [database index-name components]
  (let [candidate
        (first (memory-db/seek-datoms-chunk
                database index-name components 1))
        actual
        (when candidate
          (case index-name
            :eavt [(:e candidate) (:a candidate)
                   (:v candidate) (:tx candidate)]
            :avet [(:a candidate) (:v candidate)
                   (:e candidate) (:tx candidate)]))]
    (when (and candidate
               (= components (subvec actual 0 (count components))))
      candidate)))

(defn- existing-entity-id
  [database entity-ref]
  (cond
    (and (integer? entity-ref) (not (neg? entity-ref)))
    (when (exact-first database :eavt [entity-ref]) entity-ref)

    (and (vector? entity-ref) (= 2 (count entity-ref))
         (= :eacl/id (first entity-ref)))
    (some-> (exact-first database :avet entity-ref) :e)

    :else nil))

(defn- protected-attribute?
  [attribute]
  (and (keyword? attribute)
       (not= :eacl/id attribute)
       (let [attribute-namespace (namespace attribute)]
         (and attribute-namespace
              (or (= "eacl" attribute-namespace)
                  (str/starts-with? attribute-namespace "eacl."))))))

(defn- policy-error!
  [reason data]
  (throw
   (ex-info
    "The public memory transaction violates EACL-managed write policy."
    (merge {:type :eacl.store/write-policy-violation
            :eacl/error :eacl.store/write-policy-violation
            :reason reason} data))))

(defn- entity-protected?
  [database entity]
  (boolean
   (some #(protected-attribute? (:a %))
         (take-while
          #(= entity (:e %))
          (memory-db/seek-datoms database :eavt entity)))))

(defn- validate-id-add!
  [database entity-ref replacement]
  (when-let [entity (existing-entity-id database entity-ref)]
    (let [current (some-> (exact-first database :eavt
                                      [entity :eacl/id]) :v)]
      (when-not (= current replacement)
        (policy-error! :object-identity-mutation {})))))

(defn- validate-public-form!
  [database form]
  (cond
    (map? form)
    (do
      (doseq [attribute (keys (dissoc form :db/id))]
        (when (protected-attribute? attribute)
          (policy-error! :managed-attribute-write
                         {:attribute attribute})))
      (when (contains? form :eacl/id)
        (validate-id-add! database (:db/id form) (:eacl/id form))))

    (= :db/add (first form))
    (let [[_ entity-ref attribute replacement] form]
      (when (protected-attribute? attribute)
        (policy-error! :managed-attribute-write
                       {:attribute attribute}))
      (when (= :eacl/id attribute)
        (validate-id-add! database entity-ref replacement)))

    (contains? #{:db/retract :db/cas} (first form))
    (let [attribute (nth form 2)]
      (when (or (= :eacl/id attribute)
                (protected-attribute? attribute))
        (policy-error! :managed-attribute-write
                       {:attribute attribute})))

    (= :db/retractEntity (first form))
    (when-let [entity (existing-entity-id database (second form))]
      (when (entity-protected? database entity)
        (policy-error! :protected-entity-retraction {})))

    :else
    (policy-error! :internal-transaction-form {})))

(defn- validate-public-policy!
  [database normalized-tx-data]
  (loop [remaining (seq normalized-tx-data)]
    (when remaining
      (validate-public-form! database (first remaining))
      (recur (next remaining))))
  normalized-tx-data)

(defn- transition-state
  [state normalized-tx-data config issued-at internal?]
  (let [new-basis (inc (bigint (:basis state)))]
    (when-not (order/non-negative-id? new-basis)
      (store-error! :basis-exhausted {}))
    (let [_ (when-not internal?
              (validate-public-policy! (:current state)
                                       normalized-tx-data))
          result
          (transaction/apply-transaction
           (:current state) (:next-eid state) new-basis
           normalized-tx-data config)
          database
          (memory-db/database new-basis (:assertions result)
                              (:reference-attributes config))
          history
          (retain-history (assoc (:history state) new-basis database)
                          (:history-limit config))]
      (assoc state
             :basis new-basis
             :next-eid (:next-eid result)
             :current database
             :history history
             :last-transaction
             {:basis new-basis
              :tempids (:tempids result)
              :tx-data (:tx-data result)
              :causal-token
              (issue-token state config new-basis issued-at)}))))

(defn- transact*
  [connection tx-data internal?]
  (let [connection (require-connection! connection)
        normalized (transaction/normalize-tx-data tx-data)
        issued-at (bigint (quot (clock/unix-time-millis) 1000))
        [before after]
        (swap-vals! (:state connection)
                    #(transition-state % normalized (:config connection)
                                       issued-at internal?))
        transaction (:last-transaction after)]
    {:db-before (:current before)
     :db-after (:current after)
     :basis (:basis transaction)
     :tempids (:tempids transaction)
     :tx-data (:tx-data transaction)
     :causal-token (:causal-token transaction)}))

(defn transact!
  "Application transaction entry. EACL-managed datoms are write guarded."
  [connection tx-data]
  (transact* connection tx-data false))

(defn transact-internal!
  "Bundled schema/relationship commit seam; not re-exported by the API."
  [connection tx-data]
  (transact* connection tx-data true))

(defn causal-token
  [connection]
  (let [connection (require-connection! connection)
        state @(:state connection)
        issued-at (bigint (quot (clock/unix-time-millis) 1000))]
    (causal-token-for connection (:basis state) issued-at)))

(defn as-of
  "Return exactly one retained basis; never interpolate or fall forward."
  [connection basis]
  (let [state @(-> connection require-connection! :state)]
    (when-not (order/non-negative-id? basis)
      (store-error! :invalid-basis {}))
    (or (get (:history state) basis)
        (throw
         (ex-info
          "Exact EACL memory snapshot is no longer retained."
          {:type :eacl.snapshot/history-unavailable
           :eacl/error :eacl.snapshot/history-unavailable
           :basis basis
           :current-basis (:basis state)})))))

(defn retained-bases
  [connection]
  (vec (sort (keys (:history @(-> connection require-connection! :state))))))
