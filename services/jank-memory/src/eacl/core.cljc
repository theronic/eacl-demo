(ns eacl.core
  "Public Jank EACL API implemented as ordinary functions over tagged maps."
  (:require [eacl.cancellation :as cancellation]
            [eacl.client.orchestration :as client]
            [eacl.domain :as domain]))

(def spice-object domain/spice-object)
(def Subject domain/Subject)
(def Resource domain/Resource)
(def normalize-object domain/normalize-object)
(def relationship domain/relationship)
(def Relationship domain/Relationship)
(def normalize-relationship domain/normalize-relationship)
(def relationship-update domain/relationship-update)
(def RelationshipUpdate domain/RelationshipUpdate)
(def normalize-relationship-update domain/normalize-relationship-update)

(def cancellation-token cancellation/cancellation-token)
(def cancellation-token? cancellation/cancellation-token?)
(def cancel! cancellation/cancel!)
(def cancelled? cancellation/cancelled?)

(defn check-permission
  [authorization & arguments]
  (case (count arguments)
    1 (client/check-permission authorization (first arguments))
    3 (client/check-permission
       authorization
       {:subject (nth arguments 0)
        :permission (nth arguments 1)
        :resource (nth arguments 2)})
    4 (client/check-permission
       authorization
       {:subject (nth arguments 0)
        :permission (nth arguments 1)
        :resource (nth arguments 2)
        :consistency (nth arguments 3)})
    (throw
     (ex-info "check-permission received an unsupported arity."
              {:type :eacl/invalid-request
               :eacl/error :eacl/invalid-request
               :reason :invalid-check-permission-arity
               :argument-count (count arguments)}))))

(defn can?
  [authorization & arguments]
  (case (count arguments)
    1 (client/can? authorization (first arguments))
    3 (client/can?
       authorization
       {:subject (nth arguments 0)
        :permission (nth arguments 1)
        :resource (nth arguments 2)})
    4 (client/can?
       authorization
       {:subject (nth arguments 0)
        :permission (nth arguments 1)
        :resource (nth arguments 2)
        :consistency (nth arguments 3)})
    (throw
     (ex-info "can? received an unsupported arity."
              {:type :eacl/invalid-request
               :eacl/error :eacl/invalid-request
               :reason :invalid-can-arity
               :argument-count (count arguments)}))))

(def read-schema client/read-schema)
(def check-permissions client/check-permissions)
(def expand-permission-tree client/expand-permission-tree)
(def write-schema! client/write-schema!)
(def read-relationships client/read-relationships)
(def lookup-resources client/lookup-resources)
(def count-resources client/count-resources)
(def lookup-subjects client/lookup-subjects)
(def count-subjects client/count-subjects)
(def write-relationships! client/write-relationships!)
(def delete-object! client/delete-object!)

(defn write-relationship!
  [authorization & arguments]
  (when-let [data (client/snapshot-view-write-error-data authorization)]
    (throw (ex-info "A composed snapshot view is read-only." data)))
  (let [update
        (case (count arguments)
          1
          (let [demand (first arguments)]
            (when-not (and (map? demand)
                           (= #{:operation :subject :relation :resource}
                              (set (keys demand))))
              (throw
               (ex-info "Invalid single relationship update."
                        {:type :eacl/invalid-request
                         :eacl/error :eacl/invalid-request
                         :reason :invalid-single-relationship-update})))
            (domain/relationship-update
             (:operation demand)
             (domain/relationship (:subject demand) (:relation demand)
                                  (:resource demand))))

          4
          (domain/relationship-update
           (nth arguments 0)
           (domain/relationship (nth arguments 1) (nth arguments 2)
                                (nth arguments 3)))

          (throw
           (ex-info "write-relationship! received an unsupported arity."
                    {:type :eacl/invalid-request
                     :eacl/error :eacl/invalid-request
                     :reason :invalid-write-relationship-arity
                     :argument-count (count arguments)})))]
    (write-relationships! authorization [update])))

(defn create-relationships!
  [authorization relationships]
  (when-let [data (client/snapshot-view-write-error-data authorization)]
    (throw (ex-info "A composed snapshot view is read-only." data)))
  (when-not (vector? relationships)
    (throw
     (ex-info "Relationships must be a vector."
              {:type :eacl/invalid-request
               :eacl/error :eacl/invalid-request
               :reason :relationships-must-be-vector})))
  (write-relationships!
   authorization
   (mapv #(domain/relationship-update :create %) relationships)))

(defn create-relationship!
  [authorization & arguments]
  (when-let [data (client/snapshot-view-write-error-data authorization)]
    (throw (ex-info "A composed snapshot view is read-only." data)))
  (let [value
        (case (count arguments)
          1 (domain/normalize-relationship (first arguments))
          3 (domain/relationship (nth arguments 0) (nth arguments 1)
                                 (nth arguments 2))
          (throw
           (ex-info "create-relationship! received an unsupported arity."
                    {:type :eacl/invalid-request
                     :eacl/error :eacl/invalid-request
                     :reason :invalid-create-relationship-arity
                     :argument-count (count arguments)})))]
    (create-relationships! authorization [value])))

(defn- relationship-seq
  [values]
  (if (map? values) (:data values) values))

(defn delete-relationships!
  [authorization relationships]
  (when-let [data (client/snapshot-view-write-error-data authorization)]
    (throw (ex-info "A composed snapshot view is read-only." data)))
  (let [relationships (relationship-seq relationships)]
    (when-not (vector? relationships)
      (throw
       (ex-info "Relationships must be a vector."
                {:type :eacl/invalid-request
                 :eacl/error :eacl/invalid-request
                 :reason :relationships-must-be-vector})))
    (write-relationships!
     authorization
     (mapv #(domain/relationship-update :delete %) relationships))))

(defn delete-relationship!
  [authorization & arguments]
  ;; A single variadic entry avoids a pinned-Jank multi-arity unwind defect
  ;; when a read-only error is caught inside a with-snapshot callback.
  (when-let [data (client/snapshot-view-write-error-data authorization)]
    (throw (ex-info "A composed snapshot view is read-only." data)))
  (case (count arguments)
    1
    (delete-relationships!
     authorization
     [(domain/normalize-relationship (first arguments))])

    3
    (delete-relationships!
     authorization
     [(domain/relationship (nth arguments 0)
                           (nth arguments 1)
                           (nth arguments 2))])

    (throw
     (ex-info "delete-relationship! received an unsupported arity."
              {:type :eacl/invalid-request
               :eacl/error :eacl/invalid-request
               :reason :invalid-delete-relationship-arity
               :argument-count (count arguments)}))))

(defn with-snapshot
  [authorization & arguments]
  (let [[consistency request-options callback]
        (case (count arguments)
          1 [nil {} (first arguments)]
          2 [(nth arguments 0) {} (nth arguments 1)]
          3 [(nth arguments 0) (nth arguments 1) (nth arguments 2)]
          (throw
           (ex-info "with-snapshot received an unsupported arity."
                    {:type :eacl/invalid-snapshot-request-options
                     :eacl/error :eacl/invalid-snapshot-request-options
                     :reason :invalid-with-snapshot-arity
                     :argument-count (count arguments)})))]
    (when-not (map? request-options)
      (throw
       (ex-info
        "with-snapshot request options must be a map."
        {:type :eacl/invalid-snapshot-request-options
         :eacl/error :eacl/invalid-snapshot-request-options
         :value request-options})))
    (when-not (fn? callback)
      (throw
       (ex-info
        "with-snapshot requires a synchronous callback."
        {:type :eacl/invalid-snapshot-callback
         :eacl/error :eacl/invalid-snapshot-callback})))
    (client/with-snapshot authorization consistency request-options callback)))
