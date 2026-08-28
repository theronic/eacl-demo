(ns eacl-demo.datomic-dynamodb.profile
  "Truthful descriptor for the Datomic/DynamoDB serving candidate."
  (:require [eacl-demo.datomic-dynamodb.boundary :as boundary]))

(def data-manifest-sha256
  "718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0")

(def closed-operations
  #{"health" "bootstrap" "list-subjects" "get-object"
    "list-relationships" "reverse-relationships" "check-permission" "get-schema"
    "lookup-resources" "lookup-subjects" "count-resources"
    "get-cache-info" "count-objects"})

(defn descriptor
  [{:keys [identity basis memory-mib admission-concurrency execution]
    :or {execution "lambda"}}]
  (when-not (and (= data-manifest-sha256 (:dataManifestSha256 identity))
                 (= "fixed-environment" (:behavior basis))
                 (true? (:fixedForEnvironment basis))
                 (string? (:id basis)) (not-empty (:id basis))
                 (string? (:capturedAt basis)) (not-empty (:capturedAt basis))
                 (pos-int? memory-mib)
                 (pos-int? admission-concurrency)
                 (contains? #{"lambda" "ec2"} execution))
    (throw (ex-info "Invalid Datomic/DynamoDB profile descriptor input."
                    {:type :eacl-demo/invalid-profile-descriptor})))
  (boundary/descriptor
   {:identity identity
    :runtime {:execution execution :name "java25" :architecture "x86_64"
              :snapStart (if (= "lambda" execution) "enabled" "disabled")}
    :dataset {:fixtureId "eacl-demo-fixture-v1"
              :logicalResourceCount 1000000
              :serverCount 998417
              :manifestSha256 data-manifest-sha256}
    :basis basis
    :capabilities
    {:operations (vec (sort closed-operations))
     :consistencyModes (cond-> ["minimize" "authoritative" "at-least" "exact"]
                         (= "ec2" execution) (conj "historical-date"))
     :snapshotBehavior "fixed-environment"
     :cacheBehavior "environment-local"
     :mutationLocality "none"
     :limitations (cond-> ["read-only" "fixed-current-snapshot"
                           "no-synchronization"]
                    (= "lambda" execution) (conj "no-history-api"))}
    :limits [{:name "requestDeadlineMs" :value 30000}
             {:name "admissionConcurrency" :value admission-concurrency}
             {:name "responseBodyBytes" :value 1048576}
             {:name "memoryMiB" :value memory-mib}]}))
