(ns eacl-demo.datahike-dynamodb.retry
  "Deadline- and cancellation-aware bounded full-jitter retry."
  (:require [eacl-demo.datahike-dynamodb.errors :as errors]))

(def default-policy
  {:max-attempts 4
   :base-delay-ms 25
   :max-delay-ms 250
   :clock #(System/currentTimeMillis)
   :sleep! #(Thread/sleep ^long %)
   :random #(rand)})

(defn policy
  [options]
  (let [value (merge default-policy options)]
    (when-not (and (<= 1 (:max-attempts value) 8)
                   (<= 1 (:base-delay-ms value) 1000)
                   (<= 1 (:max-delay-ms value) 1000)
                   (<= (:base-delay-ms value) (:max-delay-ms value))
                   (fn? (:clock value))
                   (fn? (:sleep! value))
                   (fn? (:random value))
                   (or (nil? (:deadline-ms value))
                       (integer? (:deadline-ms value)))
                   (or (nil? (:cancelled? value))
                       (fn? (:cancelled? value))))
      (throw (ex-info "Invalid DynamoDB retry policy."
                      {:type :eacl-demo/invalid-retry-policy})))
    value))

(defn check-active!
  [{:keys [clock deadline-ms cancelled?]}]
  (cond
    (and cancelled? (cancelled?))
    (throw (ex-info "DynamoDB read cancelled." {:code "cancelled"}))

    (and deadline-ms (>= (clock) deadline-ms))
    (throw (ex-info "DynamoDB read deadline exceeded."
                    {:code "deadline-exceeded"}))))

(defn full-jitter-delay-ms
  [{:keys [base-delay-ms max-delay-ms random]} attempt]
  (let [cap (min max-delay-ms
                 (* base-delay-ms (bit-shift-left 1 (max 0 (dec attempt)))))
        sample (double (random))]
    (when-not (<= 0.0 sample 1.0)
      (throw (ex-info "Retry random source returned a value outside [0,1]."
                      {:type :eacl-demo/invalid-retry-random})))
    (min cap (long (Math/floor (* sample (inc cap)))))))

(defn wait-before-retry!
  [configured attempt classified-error]
  (let [{:keys [max-attempts clock deadline-ms sleep!] :as configured}
        (policy configured)]
    (if (and (:retryable (ex-data classified-error))
             (< attempt max-attempts))
      (let [delay-ms (full-jitter-delay-ms configured attempt)]
        (check-active! configured)
        (when (and deadline-ms (> (+ (clock) delay-ms) deadline-ms))
          (throw (ex-info "DynamoDB retry would exceed the request deadline."
                          {:code "deadline-exceeded"})))
        (when (pos? delay-ms) (sleep! delay-ms))
        (check-active! configured)
        true)
      (throw classified-error))))

(defn invoke!
  [operation configured f]
  (let [configured (policy configured)]
    (loop [attempt 1]
      (check-active! configured)
      (let [outcome (try
                      {:ok true :value (f attempt)}
                      (catch Exception throwable
                        {:ok false
                         :error (errors/classify operation throwable)}))]
        (if (:ok outcome)
          (do (check-active! configured) (:value outcome))
          (do
            (wait-before-retry! configured attempt (:error outcome))
            (recur (inc attempt))))))))
