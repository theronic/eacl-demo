(ns eacl-demo.datahike-s3-profile-test
  (:require [clojure.test :refer [deftest is]]
            [eacl-demo.datahike-s3.profile :as profile]))

(def profile-identity
  {:profileId "datahike-s3"
   :demoSha (apply str (repeat 40 "a"))
   :eaclSha (apply str (repeat 40 "b"))
   :artifactSha256 (apply str (repeat 64 "c"))
   :deploymentId "candidate-1"
   :dataManifestSha256 profile/data-manifest-sha256})

(def request-basis
  {:behavior "request-snapshot"
   :id "datahike:536872941:6a7df54b-1cb0-5529-9aff-504a79627f73"
   :capturedAt "2026-08-25T12:00:00Z"
   :fixedForEnvironment false})

(deftest s3-claims-are-current-only-environment-local-and-read-only-test
  (let [descriptor
        (profile/descriptor
         {:identity profile-identity
          :basis request-basis
          :operations #{"health" "bootstrap"}
          :memory-mib 1024})]
    (is (= ["current"] (get-in descriptor [:capabilities :consistencyModes])))
    (is (= "request-snapshot"
           (get-in descriptor [:capabilities :snapshotBehavior])))
    (is (= "environment-local"
           (get-in descriptor [:capabilities :cacheBehavior])))
    (is (= "none" (get-in descriptor [:capabilities :mutationLocality])))
    (is (= #{"read-only" "no-history-api" "unequal-dataset-scale"
             "unsupported-consistency" "no-snapstart"}
           (set (get-in descriptor [:capabilities :limitations]))))
    (is (= "disabled" (get-in descriptor [:runtime :snapStart])))
    (is (= 1001584 (get-in descriptor [:dataset :logicalResourceCount])))
    (is (= 1000000 (get-in descriptor [:dataset :serverCount])))
    (is (= profile/data-manifest-sha256
           (get-in descriptor [:dataset :manifestSha256])))))

(deftest descriptor-rejects-unbound-data-or-unknown-operation-test
  (is (thrown? clojure.lang.ExceptionInfo
               (profile/descriptor
                {:identity (assoc profile-identity :dataManifestSha256
                                  (apply str (repeat 64 "e")))
                 :basis request-basis
                 :operations #{"health"}
                 :memory-mib 1024})))
  (is (thrown? clojure.lang.ExceptionInfo
               (profile/descriptor
                {:identity profile-identity
                 :basis request-basis
                 :operations #{"health" "seed"}
                 :memory-mib 1024}))))
