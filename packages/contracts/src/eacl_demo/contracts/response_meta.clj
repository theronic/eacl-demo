(ns eacl-demo.contracts.response-meta
  "Canonical Explorer timing and EACL cache metadata.")

(def ^:private cache-status-key ::cache-status)

(defn elapsed-ms
  [started-nanos]
  (/ (double (- (System/nanoTime) started-nanos)) 1000000.0))

(defn with-cache-status
  "Attaches response-only cache metadata without changing the closed wire data.
  The EACL result is inspected before an operation maps it into Explorer data."
  [data result cache?]
  (with-meta data
    (assoc (meta data)
           cache-status-key
           (cond
             (false? cache?) "disabled"
             (:cached? result) "hit"
             :else "miss"))))

(defn cache-status
  [data]
  (get (meta data) cache-status-key))
