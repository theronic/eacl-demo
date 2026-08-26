(ns eacl-demo.fixture-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.fixture :as fixture])
  (:import (java.math BigInteger)
           (java.security MessageDigest)))

(defn- sha256 [lines]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (doseq [line lines]
      (.update digest (.getBytes line "UTF-8")))
    (str "sha256:" (format "%064x" (BigInteger. 1 (.digest digest))))))

(defn- object-json [{:keys [type id]}]
  (str "{\"id\":\"" id "\",\"type\":\"" type "\"}"))

(defn- record-line [record]
  (str
   (case (:kind record)
     :object
     (str "{\"kind\":\"object\",\"object\":"
          (object-json (:object record))
          ",\"role\":\"" (name (:role record)) "\"}")

     :relationship
     (str "{\"kind\":\"relationship\",\"relation\":\"" (:relation record)
          "\",\"resource\":" (object-json (:resource record))
          ",\"subject\":" (object-json (:subject record)) "}"))
   "\n"))

(defn- header-line []
  (str "{\"algorithm\":\"eacl-demo-fixture\",\"algorithmVersion\":1,"
       "\"cutPointResources\":10000,\"exemplarDigest\":\"sha256:" fixture/exemplar-sha256
       "\",\"fixtureId\":\"eacl-demo-fixture-v1\",\"kind\":\"fixture\","
       "\"schemaDigest\":\"sha256:" fixture/schema-sha256
       "\",\"seed\":\"20260813\"}\n"))

(deftest browser-generator-matches-the-accepted-small-manifest
  (let [bundles (vec (fixture/small-fixture-bundles))
        records (mapcat :records bundles)
        objects (filter #(= :object (:kind %)) records)
        relationships (filter #(= :relationship (:kind %)) records)]
    (is (= 10000 (count bundles)))
    (is (= 48693 (count records)))
    (is (= 10080 (count objects)))
    (is (= 38613 (count relationships)))
    (is (= {:type "platform" :id "platform"} (:resource (first bundles))))
    (is (= {:type "server" :id "account-10-server-1953"} (:resource (peek bundles))))
    (is (= {"account" 9988, "leader" 44, "owner" 13, "parent" 8690,
            "platform" 11, "shared_admin" 22, "super_admin" 1,
            "team" 9922, "vpc" 9922}
           (frequencies (map :relation relationships))))
    (let [record-lines (map record-line records)]
      (is (= "sha256:3bf7618d9276f6597e529cb064a46f95c97b2db7a4918b4dfde36c318aebd9cb"
             (sha256 record-lines)))
      (is (= (str "sha256:" fixture/small-fixture-sha256)
             (sha256 (cons (header-line) record-lines)))))
    (testing "the immutable accepted identities are compiled into the browser generator"
      (is (= "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a"
             fixture/small-manifest-sha256))
      (is (= "ec47ae57973bc7e9c580709410e530a7ac64acd24c01f9e3161489e8ebd58dfd"
             fixture/small-fixture-sha256)))))
