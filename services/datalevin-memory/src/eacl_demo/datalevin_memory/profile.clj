(ns eacl-demo.datalevin-memory.profile
  (:require [eacl-demo.datalevin-memory.boundary :as boundary]))

(def data-manifest-sha256
  "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a")

(def closed-operations
  #{"health" "bootstrap" "list-subjects" "get-object"
    "list-relationships" "reverse-relationships" "check-permission" "get-schema"
    "lookup-resources" "lookup-subjects" "count-resources"
    "get-cache-info" "count-objects"})

(defn descriptor
  [{:keys [identity basis memory-mib admission-concurrency execution]
    :or {admission-concurrency 1 execution "lambda"}}]
  (when-not (and (= data-manifest-sha256 (:dataManifestSha256 identity))
                 (map? basis) (pos-int? memory-mib)
                 (pos-int? admission-concurrency)
                 (contains? #{"lambda" "ec2"} execution))
    (throw (ex-info "Invalid Datalevin profile descriptor input."
                    {:type :eacl-demo/invalid-profile-descriptor})))
  (boundary/descriptor
   {:identity identity
    :runtime {:execution execution :name "java25"
              :architecture (if (= "lambda" execution) "arm64" "x86_64")
              :snapStart (if (= "lambda" execution) "enabled" "disabled")}
    :dataset {:fixtureId "eacl-demo-fixture-v1"
              :logicalResourceCount 10000
              :serverCount 9922
              :manifestSha256 data-manifest-sha256}
    :basis basis
    :capabilities
    {:operations (vec (sort closed-operations))
     :consistencyModes ["minimize"]
     :snapshotBehavior "request-snapshot"
     :cacheBehavior "environment-local"
     :mutationLocality "none"
     :limitations ["read-only" "ephemeral" "no-durability"
                   "lifecycle-rebuild" "unequal-dataset-scale"
                   "unsupported-consistency"]}
    :limits [{:name "requestDeadlineMs" :value 30000}
             {:name "admissionConcurrency" :value admission-concurrency}
             {:name "responseBodyBytes" :value 1048576}
             {:name "memoryMiB" :value memory-mib}]}))
