(ns eacl-demo.fixture-golden-test
  #?(:clj (:require [clojure.test :refer [deftest is testing]]
                    [eacl-demo.fixture-golden :as fixture])
     :cljs (:require [cljs.test :refer-macros [deftest is testing]]
                     [eacl-demo.fixture-golden :as fixture])))

(def golden
  (fixture/parse-golden
   (fixture/read-text "fixtures/golden/fixture-v1.tsv")))

(deftest unsigned-algorithm-and-stable-ids
  (testing "the language port matches unsigned-64-bit vectors"
    (is (= (get golden "sample.account-8.stream-0.unsigned")
           (fixture/unsigned-string (fixture/sample64 8 0))))
    (is (= (get golden "sample.account-8.stream-1.unsigned")
           (fixture/unsigned-string (fixture/sample64 8 1))))
    (is (= (get golden "sample.account-8.stream-1.signed")
           (fixture/signed-string (fixture/sample64 8 1))))
    (is (= (get golden "account-8.server-count")
           (str (fixture/account-server-count 8)))))
  (testing "stable IDs are unpadded and zero based"
    (is (= (get golden "id.account-4") (fixture/account-id 4)))
    (is (= (get golden "id.account-4.owner") (fixture/owner-id 4)))
    (is (= (get golden "id.account-4.team-3") (fixture/team-id 4 3)))
    (is (= (get golden "id.account-4.team-3.leader") (fixture/leader-id 4 3)))
    (is (= (get golden "id.account-4.vpc-1") (fixture/vpc-id 4 1)))
    (is (= (get golden "id.account-4.vpc-1.admin") (fixture/vpc-admin-id 4 1)))
    (is (= (get golden "id.account-4.server-15") (fixture/server-id 4 15)))))

(deftest schema-count-exemplar-and-digest-goldens
  (is (= (get golden "schema.digest")
         (fixture/sha256-file "fixtures/schema.v1.zed")))
  (is (= "6" (get golden "schema.definitions")))
  (is (= "13" (get golden "schema.relations")))
  (is (= "9" (get golden "schema.permissions")))
  (is (= "14" (get golden "exemplars.cases")))
  (is (= "10000" (get golden "small.resources")))
  (is (= "38613" (get golden "small.relationships")))
  (is (= "sha256:ec47ae57973bc7e9c580709410e530a7ac64acd24c01f9e3161489e8ebd58dfd"
         (get golden "small.fixture.digest")))
  (is (= "1000000" (get golden "large.resources")))
  (is (= "3872112" (get golden "large.relationships")))
  (is (= "sha256:102bb7c51779bb66ab343dabff42019af95f99bded708e214b13fd56ab3bf33c"
         (get golden "large.fixture.digest")))
  (is (= (get golden "small.semantic.digest")
         (get golden "large.prefix-10000.digest"))))
