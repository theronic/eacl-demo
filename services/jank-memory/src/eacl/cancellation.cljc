(ns eacl.cancellation
  "Plain-map cooperative cancellation for bounded request checkpoints.")

;; Adapted from eacl.execution at frozen commit
;; 1cbf80c7aaf4bfcf2564d2bf30135794ff406383. Protocol and nominal token types
;; are replaced by a closed tagged map containing one atom.

(def ^:private token-kind ::token)
(def ^:private token-keys #{::kind ::state})
(def ^:private atom-type (type (atom nil)))

(defn cancellation-token
  []
  {::kind token-kind
   ::state (atom false)})

(defn cancellation-token?
  [value]
  (and (map? value)
       (= token-keys (set (keys value)))
       (= token-kind (::kind value))
       (= atom-type (type (::state value)))
       (boolean? @(::state value))))

(defn- invalid-token!
  [token]
  (throw
   (ex-info
    ":cancellation-token must be an EACL cancellation token."
    {:type :eacl.execution/invalid-contract
     :eacl/error :eacl.execution/invalid-contract
     :key :cancellation-token
     :value token})))

(defn cancel!
  [token]
  (when-not (cancellation-token? token)
    (invalid-token! token))
  (reset! (::state token) true)
  true)

(defn cancelled?
  [token]
  (cond
    (nil? token) false
    (not (cancellation-token? token)) (invalid-token! token)
    :else (true? @(::state token))))

(defn check!
  "Throw a typed cancellation failure at one modeled cooperative boundary."
  [token phase]
  (when (cancelled? token)
    (throw
     (ex-info
      "Authorization request was cancelled."
      {:type :eacl.execution/cancelled
       :eacl/error :eacl.execution/cancelled
       :phase phase})))
  nil)
