(ns eacl-demo.cache-metrics-test
  (:require [clojure.test :refer [deftest is]]
            [eacl-demo.contracts.cache-metrics :as cache-metrics]))

(deftest records-complete-per-operation-response-metrics-test
  (let [metrics (cache-metrics/create-operation-metrics)
        started (System/nanoTime)]
    (cache-metrics/record-response!
     metrics "lookup-resources" started
     {:statusCode 200 :body "{\"data\":\"é\"}"}
     {:data {} :meta {:cacheStatus "hit"}})
    (cache-metrics/record-response!
     metrics "lookup-resources" (System/nanoTime)
     {:statusCode 500 :body "{}"}
     {:error {} :meta {:cacheStatus "miss"}})
    (let [metric (get (cache-metrics/operation-snapshot metrics)
                      "lookup-resources")]
      (is (= 2 (:count metric)))
      (is (= 1 (:errors metric)))
      (is (= {"hit" 1 "miss" 1} (:cacheStatus metric)))
      (is (= 15 (:responseBytes metric)))
      (is (<= 0.0 (:averageMs metric) (:maxMs metric))))))

(deftest returns-the-complete-provider-value-with-operation-snapshot-test
  (let [metrics (cache-metrics/create-operation-metrics)
        provider {:exact-hits 7
                  :misses 3
                  :tiers {:answer {:entries 12 :weight 41}}}
        result (cache-metrics/snapshot provider metrics)]
    (is (= provider (:provider result)))
    (is (= {} (:operations result)))
    (is (string? (:capturedAt result)))))
