(ns eacl-demo.foundation-test
  (:require [clojure.test :refer [deftest is testing]]))

(deftest foundation-toolchain-is-loaded-through-nrepl
  (testing "the persistent test namespace is reloadable"
    (is (= 4 (+ 2 2)))))
