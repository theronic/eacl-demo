(ns eacl.authorization.filters
  "Closed request validation for authorization-aware discovery routes."
  (:require [eacl.authorization.batch :as batch]
            [eacl.domain :as domain]))

(def endpoint-keys #{:type :id :relation})
(def page-control-keys
  #{:first :last :after :before :consistency :cache? :populate-cache?
    :evaluation
    :timeout-ms :cancellation-token :aggregate-limits})
(def lookup-resource-keys
  (into page-control-keys
        #{:subject :permission :resource/type :resource/relationship}))
(def lookup-subject-keys
  (into page-control-keys
        #{:resource :permission :subject/type :subject/relationship}))
(def count-control-keys
  #{:count-limit :consistency :cache? :populate-cache? :evaluation :timeout-ms
    :cancellation-token :aggregate-limits})

(defn- fail!
  [type reason data]
  (throw
   (ex-info
    "Invalid EACL authorized discovery request."
    (merge {:type type :eacl/error type :reason reason} data))))

(defn- validate-endpoint!
  [endpoint position]
  (when-not (map? endpoint)
    (fail! :eacl.filters/invalid-authorization-clause
           :invalid-endpoint {:position position :value endpoint}))
  (let [unknown (vec (remove endpoint-keys (keys endpoint)))]
    (when (seq unknown)
      (fail! :eacl.filters/invalid-authorization-clause
             :unknown-endpoint-key
             {:position position :unknown-keys unknown
              :known-keys endpoint-keys})))
  (domain/normalize-object endpoint))

(defn- validate-relationship-clause!
  [clause clause-key anchor-key]
  (when-not (map? clause)
    (fail! :eacl.filters/invalid-authorization-clause
           :invalid-relationship-clause
           {:position clause-key :value clause}))
  (let [known #{:relation anchor-key}
        unknown (vec (remove known (keys clause)))
        missing (vec (remove #(contains? clause %) known))]
    (when (seq unknown)
      (fail! :eacl.filters/invalid-authorization-clause
             :unknown-relationship-clause-key
             {:position clause-key :unknown-keys unknown
              :known-keys known}))
    (when (seq missing)
      (fail! :eacl.filters/invalid-authorization-clause
             :missing-relationship-clause-key
             {:position clause-key :missing-keys missing})))
  (when-not (keyword? (:relation clause))
    (fail! :eacl.filters/invalid-authorization-clause
           :invalid-relationship-name {:position clause-key}))
  (let [anchor (validate-endpoint! (get clause anchor-key)
                                   (keyword (name clause-key)
                                            (name anchor-key)))]
    (when (:relation anchor)
      (fail! :eacl.pagination/unsupported-filter
             :subject-relation-unsupported
             {:filter (keyword (name anchor-key) "relation")}))
    {:relation (:relation clause) anchor-key anchor}))

(defn- known-for
  [operation count?]
  (let [base
        (if (= :lookup-resources operation)
          lookup-resource-keys
          lookup-subject-keys)]
    (if count?
      (into (set (remove page-control-keys base)) count-control-keys)
      base)))

(defn normalize!
  [operation query configured-limits count?]
  (when-not (contains? #{:lookup-resources :lookup-subjects} operation)
    (fail! :eacl/invalid-request :unknown-discovery-operation
           {:operation operation}))
  (when-not (map? query)
    (fail! :eacl.filters/invalid-authorization-clause
           :query-must-be-map {:operation operation :value query}))
  (when (and (= :lookup-subjects operation)
             (contains? query :subject/relation))
    (fail! :eacl.pagination/unsupported-filter
           :subject-relation-unsupported {:filter :subject/relation}))
  (let [known (known-for operation count?)
        unknown (vec (remove known (keys query)))]
    (when (seq unknown)
      (fail! :eacl.filters/invalid-authorization-clause
             :unknown-query-key
             {:operation operation :unknown-keys unknown
              :known-keys known})))
  (let [subject-key (if (= :lookup-resources operation) :subject nil)
        resource-key (if (= :lookup-subjects operation) :resource nil)
        type-key (if (= :lookup-resources operation)
                   :resource/type :subject/type)
        clause-key (if (= :lookup-resources operation)
                     :resource/relationship :subject/relationship)
        anchor-key (if (= :lookup-resources operation) :subject :resource)]
    (when subject-key
      (when-not (contains? query subject-key)
        (fail! :eacl.filters/invalid-authorization-clause
               :missing-query-key {:key subject-key})))
    (when resource-key
      (when-not (contains? query resource-key)
        (fail! :eacl.filters/invalid-authorization-clause
               :missing-query-key {:key resource-key})))
    (when-not (and (contains? query :permission)
                   (keyword? (:permission query)))
      (fail! :eacl.filters/invalid-authorization-clause
             :invalid-permission {:value (:permission query)}))
    (when-not (and (contains? query type-key)
                   (keyword? (get query type-key)))
      (fail! :eacl.filters/invalid-authorization-clause
             :invalid-result-type {:key type-key :value (get query type-key)}))
    (let [subject (when subject-key
                    (validate-endpoint! (:subject query) :subject))
          resource (when resource-key
                     (validate-endpoint! (:resource query) :resource))
          relationship-clause
          (when (contains? query clause-key)
            (validate-relationship-clause!
             (get query clause-key) clause-key anchor-key))]
    (when (or (:relation subject) (:relation resource))
      (fail! :eacl.pagination/unsupported-filter
             :subject-relation-unsupported
             {:filter (if (:relation subject)
                        :subject/relation :resource/relation)}))
    (when (and (contains? query :cache?)
               (not (boolean? (:cache? query))))
      (fail! :eacl.filters/invalid-authorization-clause
             :invalid-cache-control
             {:key :cache? :value (:cache? query)}))
    (when (and (contains? query :populate-cache?)
               (not (boolean? (:populate-cache? query))))
      (fail! :eacl.filters/invalid-authorization-clause
             :invalid-cache-control
             {:key :populate-cache? :value (:populate-cache? query)}))
    (when-not (contains? #{nil :demand} (:evaluation query))
      (fail! :eacl/unsupported-feature :unsupported-evaluation-mode
             {:evaluation (:evaluation query)}))
      (let [limits
            (batch/normalize-request-limits
             configured-limits (:aggregate-limits query))]
        (if count?
          (let [supplied? (contains? query :count-limit)
                value (:count-limit query)]
            (when (and supplied?
                       (not (and (integer? value) (not (neg? value)))))
              (fail! :eacl/invalid-request :invalid-count-limit
                     {:key :count-limit :value value}))
            {:operation operation :request query
             :subject subject :resource resource
             :permission (:permission query)
             :result-type (get query type-key)
             :relationship-clause relationship-clause
             :aggregate-limits limits
             :direction :forward
             :count-limit (if supplied? value -1)
             :count-limit-supplied? supplied?})
          (do
            (when (and (:first query) (:last query))
              (fail! :eacl.pagination/invalid-page-request
                     :both-page-directions {}))
            (let [direction (if (:last query) :backward :forward)
                  page-size (or (:first query) (:last query) 100)
                  encoded (if (= :forward direction)
                            (:after query) (:before query))]
              (when-not (and (integer? page-size) (<= 1 page-size 1000))
                (fail! :eacl.pagination/invalid-page-request
                       :invalid-page-size {:value page-size :maximum 1000}))
              (when (and (:after query) (not= :forward direction))
                (fail! :eacl.pagination/invalid-page-request
                       :after-requires-first {}))
              (when (and (:before query) (not= :backward direction))
                (fail! :eacl.pagination/invalid-page-request
                       :before-requires-last {}))
              (when (and encoded (not (string? encoded)))
                (fail! :eacl.pagination/invalid-cursor
                       :malformed-cursor {}))
              {:operation operation :request query
               :subject subject :resource resource
               :permission (:permission query)
               :result-type (get query type-key)
               :relationship-clause relationship-clause
               :aggregate-limits limits :direction direction
               :page-size page-size :cursor encoded})))))))
