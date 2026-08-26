(ns eacl.relationships.endpoint-pair
  "Pure symmetric encoding of EACL's paired relationship endpoint values.")

(def value-arity 4)
(def ^:private maximum-portable-id 9007199254740991)

(defn- portable-id?
  [value]
  (and (integer? value) (<= 0 value maximum-portable-id)))

(defn forward-value
  [subject-type relation-eid resource-type resource-eid]
  [subject-type relation-eid resource-type resource-eid])

(defn reverse-value
  [resource-type relation-eid subject-type subject-eid]
  [resource-type relation-eid subject-type subject-eid])

(defn endpoint-value?
  [value]
  (and (vector? value)
       (= value-arity (count value))
       (keyword? (nth value 0))
       (portable-id? (nth value 1))
       (keyword? (nth value 2))
       (portable-id? (nth value 3))))

(defn value-prefix?
  [value prefix]
  (let [prefix (vec prefix)]
    (and (endpoint-value? value)
         (<= (count prefix) value-arity)
         (= prefix (subvec value 0 (count prefix))))))

(defn decode-forward
  [subject-eid value]
  (when (endpoint-value? value)
    {:subject-type (nth value 0)
     :subject-eid subject-eid
     :relation-eid (nth value 1)
     :resource-type (nth value 2)
     :resource-eid (nth value 3)}))

(defn decode-reverse
  [resource-eid value]
  (when (endpoint-value? value)
    {:resource-type (nth value 0)
     :resource-eid resource-eid
     :relation-eid (nth value 1)
     :subject-type (nth value 2)
     :subject-eid (nth value 3)}))

(defn peer-half
  [direction endpoint-eid value]
  (case direction
    :forward
    (when-let [decoded (decode-forward endpoint-eid value)]
      (assoc decoded
             :direction :reverse
             :endpoint-eid (:resource-eid decoded)
             :value (reverse-value
                     (:resource-type decoded) (:relation-eid decoded)
                     (:subject-type decoded) (:subject-eid decoded))))

    :reverse
    (when-let [decoded (decode-reverse endpoint-eid value)]
      (assoc decoded
             :direction :forward
             :endpoint-eid (:subject-eid decoded)
             :value (forward-value
                     (:subject-type decoded) (:relation-eid decoded)
                     (:resource-type decoded) (:resource-eid decoded))))
    nil))

(defn half-identity
  [direction endpoint-eid value]
  (when (and (contains? #{:forward :reverse} direction)
             (portable-id? endpoint-eid)
             (endpoint-value? value))
    [direction endpoint-eid value]))
