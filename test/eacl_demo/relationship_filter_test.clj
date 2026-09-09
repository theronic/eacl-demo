(ns eacl-demo.relationship-filter-test
  (:require [clojure.test :refer [is]]
            [eacl.core :as eacl]
            [eacl-demo.contracts.http :as http]))

(defn verify-handler [create-handlers profile-id]
  (let [calls (atom [])
        input {:subjectType "user" :subjectId "super-user" :resourceType "account"
               :permission "view" :relationshipSubjectType "platform"
               :relationshipSubjectId "platform" :relationshipRelation "platform"
               :pageSize 20 :cursor "next-page" :cache false :populateCache false
               :eacl-demo/snapshot ::snapshot}
        handlers (create-handlers {:descriptor {:identity {:profileId profile-id}} :cursor-key (apply str (repeat 32 "k"))})]
    (with-redefs [eacl/lookup-resources
                  (fn [target query]
                    (swap! calls conj [target query])
                    {:data [{:type :account :id "account-1"}]
                     :page-info {:has-next-page? true :end-cursor "next"}})
                  eacl/check-permission (fn [& _] (throw (ex-info "no per-item checks" {})))
                  eacl/read-relationships (fn [& _] (throw (ex-info "no candidate enumeration" {})))]
      (let [result ((get handlers "lookup-resources")
                    {:snapshot ::snapshot :input input :check-active! (fn []) :remaining-ms (constantly 30000)})]
        (is (= "account-1" (get-in result [:items 0 :id])))
        (is (= "next" (get-in result [:pageInfo :endCursor])))))
    (is (= 1 (count @calls)))
    (is (= {:relation :platform :subject (eacl/spice-object :platform "platform")}
           (get-in @calls [0 1 :resource/relationship])))
    (is (= "next-page" (get-in @calls [0 1 :after])))
    (is (false? (get-in @calls [0 1 :cache?])))
    (is (false? (get-in @calls [0 1 :populate-cache?])))))
