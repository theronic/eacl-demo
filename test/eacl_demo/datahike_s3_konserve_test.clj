(ns eacl-demo.datahike-s3-konserve-test
  (:require [clojure.test :refer [deftest is]]
            [eacl-demo.datahike-s3.client :as read-only-client]
            [eacl-demo.datahike-s3.konserve :as s3-store]
            [konserve-s3.core :as upstream]
            [konserve.impl.storage-layout :as storage]
            [konserve.store :as store])
  (:import [java.lang.reflect InvocationHandler Proxy]
           [software.amazon.awssdk.core.sync RequestBody]
           [software.amazon.awssdk.services.s3 S3Client]
           [software.amazon.awssdk.services.s3.model
            HeadObjectRequest HeadObjectResponse PutObjectRequest]))

(def config
  {:backend s3-store/backend
   :bucket "existing-bucket"
   :region "us-east-1"
   :id (java.util.UUID/fromString "4e67bb31-557d-4f49-8b4c-699d39577310")})

(defn- recording-client
  [calls]
  (Proxy/newProxyInstance
   (.getClassLoader S3Client)
   (into-array Class [S3Client])
   (reify InvocationHandler
     (invoke [_ proxy method args]
       (let [method-name (.getName method)]
         (swap! calls conj method-name)
         (case method-name
           "headObject" (-> (HeadObjectResponse/builder) .build)
           "serviceName" "S3"
           "close" nil
           "toString" "recording-s3-client"
           "hashCode" (System/identityHashCode proxy)
           "equals" (identical? proxy (when args (aget ^objects args 0)))
           (throw (UnsupportedOperationException. method-name))))))))

(deftest sdk-membrane-allows-exact-head-and-denies-write-before-delegate-test
  (let [calls (atom [])
        ^S3Client client
        (read-only-client/read-only-client (recording-client calls))]
    (.headObject client (-> (HeadObjectRequest/builder)
                            (.bucket "existing-bucket")
                            (.key "marker")
                            .build))
    (is (= ["headObject"] @calls))
    (is (thrown-with-msg?
         clojure.lang.ExceptionInfo #"membrane denied"
         (.putObject client
                     (-> (PutObjectRequest/builder)
                         (.bucket "existing-bucket")
                         (.key "forbidden")
                         .build)
                     (RequestBody/fromBytes (byte-array 0)))))
    (is (= ["headObject"] @calls))))

(deftest existing-store-connect-preflights-marker-without-writing-test
  (let [calls (atom [])
        client (read-only-client/read-only-client (recording-client calls))
        connected (s3-store/connect-store config client)]
    (is (some? connected))
    (is (= ["headObject"] @calls))
    (is (true? (get-in connected [:config :lock-blob?])))
    (is (true? (get-in connected [:config :in-place?])))))

(deftest missing-store-is-a-typed-startup-failure-test
  (with-redefs [upstream/exists? (fn [_ _ _] false)]
    (try
      (s3-store/connect-store config nil)
      (is false "missing marker must fail")
      (catch clojure.lang.ExceptionInfo error
        (is (= :eacl-demo/missing-s3-store (:type (ex-data error))))))))

(deftest backing-and-public-mutation-surfaces-are-closed-test
  (with-redefs [upstream/exists? (fn [_ _ _] true)]
    (let [backing (s3-store/->ReadOnlyStore nil "existing-bucket"
                                            (str (:id config)) nil)
          blob (storage/-create-blob backing "key" {:sync? true})
          denied [(fn [] (storage/-sync blob {:sync? true}))
                  (fn [] (storage/-write-header blob (byte-array 0)
                                                {:sync? true}))
                  (fn [] (storage/-write-meta blob (byte-array 0)
                                              {:sync? true}))
                  (fn [] (storage/-write-value blob (byte-array 0) 0
                                               {:sync? true}))
                  (fn [] (storage/-write-binary blob 0 (byte-array 0)
                                                {:sync? true}))
                  (fn [] (storage/-delete-blob backing "key" {:sync? true}))
                  (fn [] (storage/-copy backing "a" "b" {:sync? true}))
                  (fn [] (storage/-atomic-move backing "a" "b" {:sync? true}))
                  (fn [] (storage/-delete-store backing {:sync? true}))
                  (fn [] (storage/-keys backing {:sync? true}))
                  (fn [] (storage/-migrate backing "legacy" [] nil nil nil
                                           {:sync? true}))]]
      (doseq [operation denied]
        (try
          (operation)
          (is false "operation should be denied")
          (catch clojure.lang.ExceptionInfo error
            (is (= :eacl-demo/read-only (:type (ex-data error)))))))
      (try
        (storage/-create-store backing {:sync? true})
        (is false "missing store creation must be denied")
        (catch clojure.lang.ExceptionInfo error
          (is (= :eacl-demo/missing-s3-store (:type (ex-data error))))))
      (is (not (contains? (methods store/-create-store) s3-store/backend)))
      (is (not (contains? (methods store/-delete-store) s3-store/backend)))
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Unsupported store backend"
                            (store/create-store config {:sync? true})))
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"Unsupported store backend"
                            (store/delete-store config {:sync? true}))))))

(deftest serving-config-rejects-credentials-and-endpoints-test
  (is (= config (s3-store/validate-config config)))
  (doseq [forbidden [:access-key :secret :endpoint-override :path-style-access?]]
    (is (thrown? clojure.lang.ExceptionInfo
                 (s3-store/validate-config
                  (assoc config forbidden "forbidden"))))))
