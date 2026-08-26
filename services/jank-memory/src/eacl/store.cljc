(ns eacl.store
  "Closed ordinary-function boundary used by pure engine namespaces.")

(def read-operation-keys
  #{:seek-datoms-chunk :rseek-datoms-chunk
    :relationship-halves-certified?})

(defn- invalid-operations!
  [reason]
  (throw
   (ex-info
    "Invalid EACL store operation table."
    {:type :eacl.store/invalid-operations
     :eacl/error :eacl.store/invalid-operations
     :reason reason})))

(defn operations?
  [value]
  (and (map? value)
       (= read-operation-keys (set (keys value)))
       (every? fn? (vals value))))

(defn- require-operations!
  [value]
  (when-not (operations? value)
    (invalid-operations! :invalid-or-open-table))
  value)

(defn relationship-halves-certified?
  [operations database]
  (boolean
   ((:relationship-halves-certified? (require-operations! operations))
    database)))

(defn seek-datoms-chunk
  [operations database index-name components chunk-size]
  ((:seek-datoms-chunk (require-operations! operations))
   database index-name components chunk-size))

(defn seek-datoms-chunk-trusted
  "Internal request-context path after the closed operation table was checked."
  [operations database index-name components chunk-size]
  ((:seek-datoms-chunk operations)
   database index-name components chunk-size))

(defn rseek-datoms-chunk
  [operations database index-name components chunk-size]
  ((:rseek-datoms-chunk (require-operations! operations))
   database index-name components chunk-size))

(defn rseek-datoms-chunk-trusted
  "Internal request-context path after the closed operation table was checked."
  [operations database index-name components chunk-size]
  ((:rseek-datoms-chunk operations)
   database index-name components chunk-size))
