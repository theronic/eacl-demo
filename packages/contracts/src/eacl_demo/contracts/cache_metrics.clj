(ns eacl-demo.contracts.cache-metrics
  "Process-local operation counters and the public cache-metrics payload."
  (:require [eacl-demo.contracts.response-meta :as response-meta])
  (:import [java.nio.charset StandardCharsets]
           [java.time Instant]))

(defn create-operation-metrics
  []
  (atom {}))

(defn record-response!
  "Records one fully encoded service response. Metrics deliberately describe
  this process/environment only; no distributed aggregation is implied."
  [metrics operation started-nanos response envelope]
  (when (and metrics (string? operation) (not-empty operation))
    (let [elapsed-ms (response-meta/elapsed-ms started-nanos)
          response-bytes (if (string? (:body response))
                           (alength (.getBytes ^String (:body response)
                                              StandardCharsets/UTF_8))
                           0)
          cache-status (get-in envelope [:meta :cacheStatus])
          success? (<= 200 (long (or (:statusCode response) 500)) 399)]
      (swap! metrics
             (fn [snapshot]
               (-> snapshot
                   (update-in [operation :count] (fnil inc 0))
                   (update-in [operation :totalMs] (fnil + 0.0) elapsed-ms)
                   (update-in [operation :maxMs] (fnil max 0.0) elapsed-ms)
                   (update-in [operation :responseBytes]
                              (fnil + 0) response-bytes)
                   (cond-> cache-status
                     (update-in [operation :cacheStatus cache-status]
                                (fnil inc 0)))
                   (cond-> (not success?)
                     (update-in [operation :errors] (fnil inc 0))))))))
  nil)

(defn operation-snapshot
  [metrics]
  (into
   (sorted-map)
   (map
    (fn [[operation {:keys [count totalMs] :as metric}]]
      [operation
       (assoc metric :averageMs
              (if (pos? (long (or count 0)))
                (/ (double totalMs) count)
                0.0))]))
   @metrics))

(defn snapshot
  "Returns the legacy-compatible detailed cache metrics envelope. Provider is
  the complete adapter `cache-stats` value, not a synthetic summary."
  [provider operation-metrics]
  {:provider provider
   :operations (operation-snapshot operation-metrics)
   :capturedAt (str (Instant/now))})
