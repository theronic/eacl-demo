(ns eacl-demo.datomic-dynamodb.seed-main
  "Bounded stdin batch consumer for the explicit Datomic stateful workflow."
  (:require [clojure.data.json :as json]
            [clojure.edn :as edn]
            [clojure.java.io :as io]
            [datomic.api :as d]
            [eacl-demo.datomic-dynamodb.seed :as seed])
  (:gen-class))

(def ^:private maximum-line-chars 1500000)
(def ^:private maximum-batches 10000)
(def ^:private seed-batch-delay-millis 500)
(def ^:private sha256-pattern #"sha256:[0-9a-f]{64}")
(def ^:private region-pattern #"[a-z]{2}(?:-[a-z0-9]+)+-[0-9]")
(def ^:private table-pattern #"eacl-demo-datomic-[a-z0-9-]{3,80}")
(def ^:private database-pattern #"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")

(declare expected-counts manifest-resource-path parse-environment resource-text)

(defn -main
  [& arguments]
  (when (seq arguments)
    (throw (ex-info "The Datomic seeder accepts no command arguments."
                    {:type :eacl-demo/invalid-seed-command})))
  (let [{:keys [region table database cut-point manifest-digest]}
        (parse-environment (System/getenv))
        manifest (json/read-str (resource-text (manifest-resource-path cut-point))
                                :key-fn keyword)
        _ (when-not (= manifest-digest (get-in manifest [:digests :manifest]))
            (throw (ex-info "Fixture manifest identity mismatch."
                            {:type :eacl-demo/manifest-identity-mismatch})))
        uri (str "datomic:ddb://" region "/" table "/" database)
        database-created (d/create-database uri)
        connection (d/connect uri)]
    (try
      (let [state
            (seed/initialize-seed!
             connection
             {:seed-id (:fixtureId manifest)
              :manifest-digest manifest-digest
              :schema-source (resource-text "schema.v1.zed")
              :metadata-schema
              (edn/read-string
               (resource-text
                "datomic-demo-metadata-schema.edn"))})
            completed
            (with-open [reader (io/reader System/in :encoding "UTF-8")]
              (reduce
               (fn [count line]
                 (when (or (>= count maximum-batches)
                           (zero? (count line))
                           (> (alength (.getBytes ^String line "UTF-8"))
                              maximum-line-chars))
                   (throw (ex-info "Fixture batch stream is invalid or exceeds limits."
                                   {:type :eacl-demo/invalid-batch-stream})))
                 (let [result
                       (seed/apply-batch!
                        state (json/read-str line :key-fn keyword))]
                   (println
                    (json/write-str
                     {:kind "seed-progress"
                      :status (name (:status result))
                      :nextResourceOrdinal (:next-resource-ordinal result)}))
                   ;; Pace the one-time seed below the reviewed request cap.
                   ;; The storage cap and throttle alarms remain authoritative.
                   (when (= :committed (:status result))
                     (Thread/sleep seed-batch-delay-millis))
                   (inc count)))
               0 (line-seq reader)))
            result
            (seed/finalize-seed!
             state
             {:cutPointResources cut-point
              :counts (expected-counts manifest)
              :indexTimeoutSeconds 600})
            history
            (seed/history-evidence
             state {:cutPointResources cut-point} result)]
        (println
         (json/write-str
          {:kind "seed-complete"
           :status (name (:status result))
           :replayed (:replayed result)
           :databaseCreated database-created
           :batches completed
           :manifestDigest (:manifest-digest result)
           :contentBasisT (:content-basis-t result)
           :publicationBasisT (:publication-basis-t result)
           :history history})))
      (finally
        (d/release connection)))))

(defn parse-environment
  [environment]
  (let [region (get environment "AWS_REGION")
        table (get environment "EACL_DATOMIC_TABLE")
        database (get environment "EACL_DATOMIC_DATABASE")
        digest (get environment "EACL_FIXTURE_MANIFEST_DIGEST")
        cut-point-text (get environment "EACL_FIXTURE_CUT_POINT")
        cut-point (when (and (string? cut-point-text)
                             (re-matches #"[1-9][0-9]{0,6}" cut-point-text))
                    (Long/parseLong cut-point-text))]
    (when-not (and (re-matches region-pattern (or region ""))
                   (re-matches table-pattern (or table ""))
                   (re-matches database-pattern (or database ""))
                   (re-matches sha256-pattern (or digest ""))
                   (contains? #{10000 1000000} cut-point))
      (throw (ex-info "Datomic seed environment is incomplete or invalid."
                      {:type :eacl-demo/invalid-seed-environment})))
    {:region region :table table :database database
     :manifest-digest digest :cut-point cut-point}))

(defn manifest-resource-path
  [cut-point]
  (str "manifests/fixture-"
       cut-point ".v1.json"))

(defn resource-text
  [resource-name]
  (if-let [resource (io/resource resource-name)]
    (slurp resource :encoding "UTF-8")
    (throw (ex-info "Required seed resource is absent."
                    {:type :eacl-demo/missing-seed-resource
                     :resource resource-name}))))

(defn- expected-counts
  [manifest]
  {:objects (get-in manifest [:counts :objects :total])
   :subjects (get-in manifest [:counts :objects :subjects :total])
   :resources (get-in manifest [:counts :objects :resources :total])
   :relationships (get-in manifest [:counts :relationships :total])
   :records (get-in manifest [:counts :records :total])})
