(ns eacl-demo.datalevin-inventory-test
  (:require [clojure.test :refer [deftest is]]
            [datalevin.core :as d]
            [eacl.relationships.storage :as storage]
            [eacl-demo.datalevin-memory.operations :as operations]))

(deftest inventory-uses-native-attribute-size-without-enumeration
  (let [calls (atom [])
        handlers (operations/create-handlers {:descriptor {} :cursor-key (apply str (repeat 32 "k"))})]
    (with-redefs-fn
      {#'operations/with-snapshot-db (fn [_ f] (f ::database))
       #'d/count-datoms (fn [db e a v] (swap! calls conj [db e a v]) 38613)
       #'d/datoms (fn [& _] (throw (ex-info "must not enumerate relationships" {})))}
      #(is (= {:kind "relationships" :value 38613 :exact true :ceiling 1000000}
              ((get handlers "count-objects")
               {:snapshot ::snapshot :input {:kind "relationships" :ceiling 1000000}
                :check-active! (fn [])}))))
    (is (= [[::database nil storage/forward-attribute nil]] @calls))))

(deftest nested-lookup-delegates-authorization-and-filtering-to-eacl
  ((requiring-resolve 'eacl-demo.relationship-filter-test/verify-handler)
   operations/create-handlers "datalevin-memory"))

(deftest nested-branches-use-authorized-relationship-reads
  ((requiring-resolve 'eacl-demo.relationship-filter-test/verify-read-handler)
   operations/create-handlers "datalevin-memory"))
