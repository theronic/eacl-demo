(ns eacl-demo.datahike-dynamodb.context
  "Per-request cancellation and deadline context for synchronous Datahike reads.")

(def ^:dynamic *request-context* {})

(defn current [] *request-context*)
