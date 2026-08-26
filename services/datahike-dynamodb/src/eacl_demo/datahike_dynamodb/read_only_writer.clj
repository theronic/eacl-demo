(ns eacl-demo.datahike-dynamodb.read-only-writer
  "Datahike writer implementation that denies every serving mutation."
  (:require [clojure.core.async :as async]
            [datahike.connector :as connector]
            [datahike.writer :as writer]))

(def backend :eacl-demo-dynamodb-read-only)
(def config {:backend backend})

(defn- denied!
  [operation]
  (throw (ex-info "The Datahike/DynamoDB serving peer cannot mutate storage."
                  {:type :eacl-demo/read-only
                   :code "route-not-found"
                   :operation operation})))

(defrecord ReadOnlyWriter []
  writer/PWriter
  (-dispatch! [_ invocation]
    (denied! (or (:op invocation) :unknown)))
  (-shutdown [_]
    (doto (async/promise-chan) async/close!))
  (-streaming? [_] false))

(defmethod writer/create-writer backend
  [_ _]
  (->ReadOnlyWriter))

(defmethod connector/-connect* backend
  [database-config opts]
  (connector/-connect-impl* database-config opts))

(defmethod writer/create-database backend
  [& _]
  (denied! :create-database))

(defmethod writer/delete-database backend
  [& _]
  (denied! :delete-database))
