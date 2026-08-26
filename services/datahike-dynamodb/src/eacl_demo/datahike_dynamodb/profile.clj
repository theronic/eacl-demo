(ns eacl-demo.datahike-dynamodb.profile
  "Truthful public claims for the qualified-only DynamoDB generation."
  (:require [eacl-demo.datahike-dynamodb.boundary :as boundary]))

(def data-manifest-sha256
  "718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0")

(def closed-operations
  #{"health" "bootstrap" "list-subjects" "get-object"
    "list-relationships" "reverse-relationships" "authorize" "get-schema"
    "lookup-resources" "lookup-subjects" "count-resources"
    "get-cache-info" "count-objects"})

(defn descriptor
  [{:keys [identity basis operations memory-mib]}]
  (when-not (and (= data-manifest-sha256 (:dataManifestSha256 identity))
                 (map? basis)
                 (set? operations)
                 (seq operations)
                 (every? closed-operations operations)
                 (pos-int? memory-mib))
    (throw (ex-info "Invalid Datahike/DynamoDB profile descriptor input."
                    {:type :eacl-demo/invalid-profile-descriptor})))
  (boundary/descriptor
   {:identity identity
    :runtime {:execution "lambda" :name "java25" :architecture "arm64"
              :snapStart "disabled"}
    :dataset {:fixtureId "eacl-demo-fixture-v1"
              :logicalResourceCount 1000000
              :manifestSha256 data-manifest-sha256}
    :basis basis
    :capabilities
    {:operations (vec (sort operations))
     :consistencyModes ["current"]
     :snapshotBehavior "request-snapshot"
     :cacheBehavior "environment-local"
     :mutationLocality "none"
     :limitations ["read-only" "no-history-api" "unsupported-consistency"
                   "no-snapstart"]}
    :limits [{:name "requestDeadlineMs" :value 30000}
             {:name "admissionConcurrency" :value 1}
             {:name "responseBodyBytes" :value 1048576}
             {:name "memoryMiB" :value memory-mib}]}))
