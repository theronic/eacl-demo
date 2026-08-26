(ns eacl-demo.datahike-s3.profile
  "Truthful public claims for the adopted legacy S3 dataset."
  (:require [eacl-demo.datahike-s3.boundary :as boundary]))

(def data-manifest-sha256
  "a97c5b2ecac32012bdd37963348d840c5d405ad2858c0136eb17006ba97167b8")

(def closed-operations
  #{"health" "bootstrap" "list-subjects" "get-object"
    "list-relationships" "reverse-relationships" "authorize" "get-schema"
    "get-cache-info" "count-objects"})

(defn descriptor
  [{:keys [identity basis operations memory-mib]}]
  (when-not (and (= data-manifest-sha256 (:dataManifestSha256 identity))
                 (map? basis)
                 (set? operations)
                 (seq operations)
                 (every? closed-operations operations)
                 (pos-int? memory-mib))
    (throw (ex-info "Invalid Datahike/S3 profile descriptor input."
                    {:type :eacl-demo/invalid-profile-descriptor})))
  (boundary/descriptor
   {:identity identity
    :runtime {:execution "lambda" :name "java25" :architecture "arm64"
              :snapStart "disabled"}
    :dataset {:fixtureId "legacy-datahike-s3-20260824-basis-6a7df54b"
              :logicalResourceCount 1001584
              :manifestSha256 data-manifest-sha256}
    :basis basis
    :capabilities
    {:operations (vec (sort operations))
     :consistencyModes ["current"]
     :snapshotBehavior "request-snapshot"
     :cacheBehavior "environment-local"
     :mutationLocality "none"
     :limitations ["read-only" "no-history-api" "unequal-dataset-scale"
                   "unsupported-consistency" "snapstart-unqualified"]}
    :limits [{:name "requestDeadlineMs" :value 30000}
             {:name "admissionConcurrency" :value 1}
             {:name "responseBodyBytes" :value 1048576}
             {:name "memoryMiB" :value memory-mib}]}))
