(ns eacl-demo.datalevin-memory.smoke
  (:require [clojure.java.io :as io]
            [datalevin.core :as d]
            [eacl.core :as eacl]
            [eacl.datalevin.core :as datalevin-eacl]
            [eacl.datalevin.db :as datalevin-db]
            [eacl-demo.datalevin-memory.reader :as reader])
  (:import [java.nio.file Files]))

(defn- delete-tree!
  [directory]
  (doseq [file (reverse (file-seq (.toFile directory)))]
    (io/delete-file file true)))

(defn- decision
  [snapshot subject-id resource-id]
  (:allowed?
   (eacl/check-permission
    snapshot
    {:subject (eacl/spice-object :user subject-id)
     :permission :admin
     :resource (eacl/spice-object :account resource-id)
     :consistency :minimize-latency})))

(defn -main
  [& _]
  (let [directory (Files/createTempDirectory
                   "eacl-demo-datalevin-smoke-"
                   (make-array java.nio.file.attribute.FileAttribute 0))
        opened (reader/open-reader!
                {:security-key "01234567890123456789012345678901"
                 :database-directory directory})]
    (try
      (let [owned ((:capture-snapshot opened))]
        (try
          (let [snapshot (:value owned)
                database (datalevin-eacl/db snapshot)
                resources (datalevin-db/with-db
                            database
                            #(count (d/datoms % :ave
                                              :demo/roles :resource)))]
            (when-not (and (= 10000 resources)
                           (true? (decision snapshot "user-1" "account-0"))
                           (false? (decision snapshot "user-2" "account-0")))
              (throw (ex-info "Datalevin smoke assertions failed."
                              {:resources resources})))
            (prn {:ready true
                  :storage "embedded"
                  :resources resources
                  :allow true
                  :deny false
                  :basis (:basis owned)}))
          (finally ((:release! owned)))))
      (finally
        (reader/close-reader! opened)
        (delete-tree! directory)))))
