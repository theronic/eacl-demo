(ns eacl-demo.datalevin-memory-profile-test
  (:require [clojure.test :refer [deftest is]]
            [eacl-demo.datalevin-memory.profile :as profile]))

(def profile-identity
  {:profileId "datalevin-memory"
   :demoSha (apply str (repeat 40 "a"))
   :eaclSha (apply str (repeat 40 "b"))
   :artifactSha256 (apply str (repeat 64 "c"))
   :deploymentId "candidate-1"
   :dataManifestSha256 profile/data-manifest-sha256})

(def request-basis
  {:behavior "request-snapshot"
   :id "datalevin:42"
   :capturedAt "2026-08-26T00:00:00Z"
   :fixedForEnvironment false})

(deftest descriptor-uses-the-closed-cross-backend-vocabulary-test
  (let [descriptor (profile/descriptor
                    {:identity profile-identity
                     :basis request-basis
                     :memory-mib 3072})]
    (is (= {:backend "datalevin" :storage "memory"}
           (:profile descriptor)))
    (is (= "request-snapshot"
           (get-in descriptor [:capabilities :snapshotBehavior])))
    (is (= #{"read-only" "ephemeral" "no-durability"
             "lifecycle-rebuild" "unequal-dataset-scale"
             "unsupported-consistency" "no-snapstart"}
           (set (get-in descriptor [:capabilities :limitations]))))
    (is (= "disabled" (get-in descriptor [:runtime :snapStart])))))

(deftest descriptor-rejects-an-unbound-data-manifest-test
  (is (thrown? clojure.lang.ExceptionInfo
               (profile/descriptor
                {:identity (assoc profile-identity :dataManifestSha256
                                  (apply str (repeat 64 "e")))
                 :basis request-basis
                 :memory-mib 3072}))))
