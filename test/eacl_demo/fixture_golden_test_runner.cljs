(ns eacl-demo.fixture-golden-test-runner
  (:require [cljs.test :as test]
            [eacl-demo.fixture-golden-test]))

(defmethod test/report [:cljs.test/default :end-run-tests] [result]
  (when-not (test/successful? result)
    (set! (.-exitCode js/process) 1)))

(defn -main []
  (test/run-tests 'eacl-demo.fixture-golden-test))

(set! *main-cli-fn* -main)
