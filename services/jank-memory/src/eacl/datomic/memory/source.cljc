(ns eacl.datomic.memory.source
  "Closed selected-basis identity for the bundled memory source."
  (:require [eacl.datomic.memory.db :as memory-db]
            [eacl.datomic.memory.store :as store]))

(def backend-id :datomic-memory)
(def semantic-identity-keys
  #{:backend :source-id :branch :source-lifecycle :basis-kind :revision
    :exact-locator :backend-snapshot-id})
(def selection-keys
  #{:db :basis :mode :causal-token :semantic-identity :ownership
    :execution-constraints :release-state})
(def execution-constraints
  {:virtual-threads :supported
   :snapshot-thread :any
   :release-thread :any})
(def basis-kinds #{:ordinary :as-of})
(def ^:private release-states #{:open :releasing :released})
(def ^:private atom-type (type (atom nil)))

(defn- invalid!
  [reason data]
  (throw
   (ex-info
    "Invalid EACL memory selected basis."
    (merge {:type :eacl/invalid-selected-basis
            :eacl/error :eacl/invalid-selected-basis
            :reason reason}
           data))))

(defn semantic-identity?
  [value]
  (and (map? value)
       (= semantic-identity-keys (set (keys value)))
       (= backend-id (:backend value))
       (string? (:source-id value))
       (not (empty? (:source-id value)))
       (nil? (:branch value))
       (string? (:source-lifecycle value))
       (not (empty? (:source-lifecycle value)))
       (contains? basis-kinds (:basis-kind value))
       (integer? (:revision value))
       (not (neg? (:revision value)))
       (= (:revision value) (:exact-locator value))
       (= {:basis (:revision value)} (:backend-snapshot-id value))))

(defn semantic-identity
  "Build the immutable target-shaped equality identity for one selected DB."
  [connection database basis-kind]
  (when-not (and (store/connection? connection)
                 (memory-db/database? database)
                 (contains? basis-kinds basis-kind))
    (invalid! :invalid-semantic-identity-input {}))
  (let [{:keys [store-id lifecycle-id]} (store/identities connection)
        basis (:basis database)
        result
        {:backend backend-id
         :source-id store-id
         :branch nil
         :source-lifecycle lifecycle-id
         :basis-kind basis-kind
         :revision basis
         :exact-locator basis
         :backend-snapshot-id {:basis basis}}]
    (when-not (semantic-identity? result)
      (invalid! :invalid-semantic-identity {}))
    result))

(defn selection
  "Construct one closed borrowed selection over an immutable memory DB."
  [connection database mode causal-token basis-kind]
  (let [result
        {:db database
         :basis (:basis database)
         :mode mode
         :causal-token causal-token
         :semantic-identity
         (semantic-identity connection database basis-kind)
         :ownership :borrowed
         :execution-constraints execution-constraints
         :release-state (atom :open)}]
    (when-not (and (= selection-keys (set (keys result)))
                   (memory-db/database? (:db result))
                   (= (:basis result) (get-in result [:db :basis]))
                   (keyword? (:mode result))
                   (string? (:causal-token result))
                   (semantic-identity? (:semantic-identity result))
                   (= :borrowed (:ownership result))
                   (= execution-constraints (:execution-constraints result))
                   (= atom-type (type (:release-state result)))
                   (= :open @(:release-state result)))
      (invalid! :invalid-selection {}))
    result))

(defn selection?
  [value]
  (and (map? value)
       (= selection-keys (set (keys value)))
       (memory-db/database? (:db value))
       (= (:basis value) (get-in value [:db :basis]))
       (= (:basis value) (get-in value [:semantic-identity :revision]))
       (keyword? (:mode value))
       (string? (:causal-token value))
       (semantic-identity? (:semantic-identity value))
       (= :borrowed (:ownership value))
       (= execution-constraints (:execution-constraints value))
       (= atom-type (type (:release-state value)))
       (contains? release-states @(:release-state value))))

(defn released?
  [selected]
  (when-not (selection? selected)
    (invalid! :invalid-selection {}))
  (= :released @(:release-state selected)))

(defn assert-open!
  [selected]
  (when-not (selection? selected)
    (invalid! :invalid-selection {}))
  (case @(:release-state selected)
    :open selected
    :releasing
    (throw
     (ex-info
      "Selected memory basis release is already in progress."
      {:type :eacl/snapshot-release-in-progress
       :eacl/error :eacl/snapshot-release-in-progress
       :backend backend-id}))
    :released
    (throw
     (ex-info
      "Selected memory basis has already been released."
      {:type :eacl/snapshot-released
       :eacl/error :eacl/snapshot-released
       :backend backend-id}))))

(defn database
  [selected]
  (:db (assert-open! selected)))

(defn release!
  "Close the borrowed selected-basis boundary at most once.

  The immutable memory DB has no native handle to release, but the lifecycle
  state prevents use after request ownership has ended and matches Core's
  uniform selected-basis contract."
  [selected]
  (when-not (selection? selected)
    (invalid! :invalid-selection {}))
  (let [release-state (:release-state selected)]
    (loop []
      (case @release-state
        :released false
        :releasing
        (throw
         (ex-info
          "Selected memory basis release is already in progress."
          {:type :eacl/snapshot-release-in-progress
           :eacl/error :eacl/snapshot-release-in-progress
           :backend backend-id}))
        :open
        (if (compare-and-set! release-state :open :releasing)
          (do
            (reset! release-state :released)
            true)
          (recur))))))

(defn lineage-for-basis
  [basis-identity]
  (when-not (semantic-identity? basis-identity)
    (invalid! :invalid-lineage-basis {}))
  {:source-scope
   (select-keys basis-identity [:backend :source-id :branch])
   :source-lifecycle (:source-lifecycle basis-identity)})
