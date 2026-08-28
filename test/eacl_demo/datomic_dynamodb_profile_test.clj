(ns eacl-demo.datomic-dynamodb-profile-test
  (:require [clojure.test :refer [deftest is]]
            [eacl-demo.datomic-dynamodb.profile :as profile]))

(def profile-identity
  {:profileId "datomic-dynamodb"
   :demoSha (apply str (repeat 40 "a"))
   :eaclSha (apply str (repeat 40 "b"))
   :artifactSha256 (apply str (repeat 64 "c"))
   :deploymentId "candidate-1"
   :dataManifestSha256 profile/data-manifest-sha256})

(def basis
  {:behavior "fixed-environment"
   :id "datomic:eacl-demo-datomic-generation-test:eacl-demo:424242"
   :capturedAt "2026-08-25T12:00:00Z"
   :fixedForEnvironment true})

(deftest descriptor-is-fixed-current-honest-and-contract-shaped-test
  (let [descriptor (profile/descriptor
                    {:identity profile-identity
                     :basis basis
                     :memory-mib 1024
                     :admission-concurrency 1})]
    (is (= {:backend "datomic" :storage "dynamodb"} (:profile descriptor)))
    (is (= {:execution "lambda" :name "java25" :architecture "x86_64"
            :snapStart "enabled"}
           (:runtime descriptor)))
    (is (= ["minimize" "authoritative" "at-least" "exact"]
           (get-in descriptor [:capabilities :consistencyModes])))
    (is (= "fixed-environment"
           (get-in descriptor [:capabilities :snapshotBehavior])))
    (is (= profile/closed-operations
           (set (get-in descriptor [:capabilities :operations]))))
    (is (= basis (:basis descriptor)))
    (is (= 1000000 (get-in descriptor [:dataset :logicalResourceCount])))
    (is (= 998417 (get-in descriptor [:dataset :serverCount])))
    (is (= profile/data-manifest-sha256
           (get-in descriptor [:dataset :manifestSha256])))
    (is (some #{"no-history-api"}
              (get-in descriptor [:capabilities :limitations])))
    (is (some #{"no-synchronization"}
              (get-in descriptor [:capabilities :limitations])))
    (is (not-any? #{"no-snapstart"}
                  (get-in descriptor [:capabilities :limitations])))))

(deftest descriptor-rejects-invented-history-and-unbound-data-test
  (is (thrown? clojure.lang.ExceptionInfo
               (profile/descriptor
                {:identity profile-identity
                 :basis (assoc basis :behavior "request-snapshot")
                 :memory-mib 1024
                 :admission-concurrency 1})))
  (is (thrown? clojure.lang.ExceptionInfo
               (profile/descriptor
                {:identity (assoc profile-identity :dataManifestSha256
                                  (apply str (repeat 64 "f")))
                 :basis basis
                 :memory-mib 1024
                 :admission-concurrency 1}))))

(deftest descriptor-reports-the-actual-compute-platform-test
  (is (= "ec2"
         (get-in (profile/descriptor
                  {:identity profile-identity
                   :basis basis
                   :memory-mib 1024
                   :admission-concurrency 1
                   :execution "ec2"})
                 [:runtime :execution])))
  (is (= "disabled"
         (get-in (profile/descriptor
                  {:identity profile-identity
                   :basis basis
                   :memory-mib 1024
                   :admission-concurrency 4
                   :execution "ec2"})
                 [:runtime :snapStart])))
  (is (thrown? clojure.lang.ExceptionInfo
               (profile/descriptor
                {:identity profile-identity
                 :basis basis
                 :memory-mib 1024
                 :admission-concurrency 1
                 :execution "container"}))))
