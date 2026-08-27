(ns eacl-demo.datahike-dynamodb.verify-main
  "Verifies the exported generation through the exact read-only serving store."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [datahike.api :as d]
            [eacl-demo.datahike-dynamodb.reader :as reader]
            [eacl-demo.datahike-dynamodb.seed :as seed])
  (:import [java.util UUID])
  (:gen-class))

(def ^:private digest-pattern #"sha256:[0-9a-f]{64}")
(def ^:private table-pattern #"eacl-demo-datahike-[a-z0-9-]{3,80}")

(declare expected-counts manifest-resource-path parse-environment resource-text)

(defn -main
  [& arguments]
  (when (seq arguments)
    (throw (ex-info "The Datahike verifier accepts no command arguments."
                    {:type :eacl-demo/invalid-verify-command})))
  (let [{:keys [region table store-id manifest-digest cut-point]}
        (parse-environment (System/getenv))
        manifest (json/read-str
                  (resource-text (manifest-resource-path cut-point))
                  :key-fn keyword)
        _ (when-not (and (= manifest-digest
                            (get-in manifest [:digests :manifest]))
                         (= cut-point
                            (get-in manifest [:cutPoint :logicalResources])))
            (throw (ex-info "Verifier manifest identity mismatch."
                            {:type :eacl-demo/manifest-identity-mismatch})))
        config (reader/database-config
                {:region region
                 :table table
                 :store-id store-id
                 :store-cache-size 4096
                 :search-cache-size 0
                 :maximum-concurrency 1
                 :security-key (apply str (repeat 32 "v"))
                 :max-attempts 8
                 :base-delay-ms 25
                 :max-delay-ms 1000
                 :attempt-timeout-ms 5000
                 :connect-timeout-ms 1000})
        connection (d/connect config)]
    (try
      (let [database (d/db connection)
            state (d/entity database
                            [:eacl.demo/seed-id (:fixtureId manifest)])
            actual (seed/verify-counts database state
                                       (expected-counts manifest))]
        (when-not (and (= :ready (:eacl.demo/seed-status state))
                       (= manifest-digest
                          (:eacl.demo/manifest-digest state))
                       (pos-int? (:eacl.demo/content-basis-t state))
                       (<= (:eacl.demo/content-basis-t state)
                           (:max-tx database)))
          (throw (ex-info "Exported seed lifecycle is invalid."
                          {:type :eacl-demo/invalid-exported-seed})))
        (println
         (json/write-str
          {:kind "verify-complete"
           :status "ready"
           :table table
           :storeId (str store-id)
           :manifestDigest manifest-digest
           :contentBasisT (:eacl.demo/content-basis-t state)
           :publicationBasisT (:max-tx database)
           :counts actual})))
      (finally
        (d/release connection)))))

(defn parse-environment
  [environment]
  (let [region (get environment "AWS_REGION")
        table (get environment "EACL_DATAHIKE_TABLE")
        store-id-text (get environment "EACL_DATAHIKE_STORE_ID")
        manifest-digest (get environment "EACL_FIXTURE_MANIFEST_DIGEST")
        cut-point-text (get environment "EACL_FIXTURE_CUT_POINT")
        cut-point (when (and (string? cut-point-text)
                             (re-matches #"[1-9][0-9]{0,6}" cut-point-text))
                    (Long/parseLong cut-point-text))
        store-id (try
                   (when (string? store-id-text)
                     (UUID/fromString store-id-text))
                   (catch IllegalArgumentException _ nil))]
    (when-not (and (= "us-east-1" region)
                   (re-matches table-pattern (or table ""))
                   store-id
                   (re-matches digest-pattern (or manifest-digest ""))
                   (contains? #{10000 1000000} cut-point))
      (throw (ex-info "Datahike verification environment is invalid."
                      {:type :eacl-demo/invalid-verify-environment})))
    {:region region
     :table table
     :store-id store-id
     :manifest-digest manifest-digest
     :cut-point cut-point}))

(defn- manifest-resource-path
  [cut-point]
  (str "manifests/fixture-" cut-point ".v1.json"))

(defn- resource-text
  [resource-name]
  (if-let [resource (io/resource resource-name)]
    (slurp resource :encoding "UTF-8")
    (throw (ex-info "Required verification resource is absent."
                    {:type :eacl-demo/missing-verify-resource
                     :resource resource-name}))))

(defn- expected-counts
  [manifest]
  {:objects (get-in manifest [:counts :objects :total])
   :subjects (get-in manifest [:counts :objects :subjects :total])
   :resources (get-in manifest [:counts :objects :resources :total])
   :relationships (get-in manifest [:counts :relationships :total])
   :records (get-in manifest [:counts :records :total])})
