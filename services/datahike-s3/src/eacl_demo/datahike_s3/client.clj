(ns eacl-demo.datahike-s3.client
  "S3 SDK membrane exposing only the serving reader's exact operations."
  (:import [java.lang.reflect InvocationHandler InvocationTargetException Method Proxy]
           [software.amazon.awssdk.services.s3 S3Client]))

(def ^:private allowed-signatures
  #{["getObject"
     ["software.amazon.awssdk.services.s3.model.GetObjectRequest"]]
    ["headObject"
     ["software.amazon.awssdk.services.s3.model.HeadObjectRequest"]]
    ["close" []]
    ["serviceName" []]})

(defn- signature
  [^Method method]
  [(.getName method)
   (mapv #(.getName ^Class %) (.getParameterTypes method))])

(defn- denied!
  [^Method method]
  (throw
   (ex-info
    "The Datahike/S3 serving SDK membrane denied an operation."
    {:type :eacl-demo/read-only
     :code "route-not-found"
     :operation (.getName method)})))

(defn- invoke-delegate
  [^Method method delegate args]
  (try
    (.invoke method delegate args)
    (catch InvocationTargetException error
      ;; Preserve SDK exception types so the backing can distinguish an absent
      ;; object from an access, timeout, or transport failure.
      (throw (.getCause error)))))

(defn read-only-client
  "Wraps one SDK client in an exact get/head/close allowlist.

  IAM remains the outer control. This membrane makes every write, list, copy,
  delete, and bucket-administration overload fail before reaching the SDK
  delegate, even if later project code accidentally calls one."
  [^S3Client delegate]
  (when-not (instance? S3Client delegate)
    (throw (ex-info "An S3Client delegate is required."
                    {:type :eacl-demo/invalid-s3-client})))
  (Proxy/newProxyInstance
   (.getClassLoader S3Client)
   (into-array Class [S3Client])
   (reify InvocationHandler
     (invoke [_ proxy method args]
       (case (.getName ^Method method)
         "toString" "eacl-demo-read-only-s3-client"
         "hashCode" (System/identityHashCode proxy)
         "equals" (identical? proxy (when args (aget ^objects args 0)))
         (if (contains? allowed-signatures (signature method))
           (invoke-delegate method delegate args)
           (denied! method)))))))
