(ns eacl-demo.contracts-response-meta-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.contracts.response-meta :as response-meta]))

(deftest canonical-cache-status-test
  (testing "cache controls and EACL result provenance map to the original UI terms"
    (is (= "disabled"
           (response-meta/cache-status
            (response-meta/with-cache-status {} {:cached? true} false))))
    (is (= "hit"
           (response-meta/cache-status
            (response-meta/with-cache-status {} {:cached? true} true))))
    (is (= "miss"
           (response-meta/cache-status
            (response-meta/with-cache-status {} {:cached? false} true))))))

(deftest elapsed-time-is-nonnegative-test
  (is (<= 0.0 (response-meta/elapsed-ms (System/nanoTime)))))
