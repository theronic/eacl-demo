(ns eacl-demo.datahike-v8-reader-integration-test
  (:require [clojure.java.io :as io]
            [clojure.test :refer [deftest is]]
            [datahike.api :as d]
            [eacl.core :as eacl]
            [eacl.datahike.core :as dh]
            [eacl-demo.datahike-s3.reader :as reader]
            [konserve-s3.core :as s3])
  (:import [java.io ByteArrayInputStream]
           [java.lang.reflect InvocationHandler Proxy]
           [java.nio.file Files]
           [software.amazon.awssdk.core ResponseInputStream]
           [software.amazon.awssdk.services.s3 S3Client]
           [software.amazon.awssdk.services.s3.model GetObjectResponse HeadObjectResponse NoSuchKeyException]))

(defn- fixture-client [objects calls]
  (Proxy/newProxyInstance
   (.getClassLoader S3Client) (into-array Class [S3Client])
   (reify InvocationHandler
     (invoke [_ proxy method args]
       (let [method-name (.getName method)]
         (swap! calls conj method-name)
         (case method-name
           ("headObject" "getObject")
           (let [key (.key (aget ^objects args 0))
                 bytes (or (get objects key)
                           (throw (-> (NoSuchKeyException/builder) (.statusCode 404) .build)))]
             (if (= "headObject" method-name)
               (-> (HeadObjectResponse/builder) (.contentLength (long (alength ^bytes bytes))) .build)
               (ResponseInputStream.
                (-> (GetObjectResponse/builder) (.eTag "fixture") .build)
                (ByteArrayInputStream. bytes))))
           "serviceName" "S3"
           "close" nil
           "toString" "immutable-fixture-s3"
           "hashCode" (System/identityHashCode proxy)
           "equals" (identical? proxy (when args (aget ^objects args 0)))
           (throw (UnsupportedOperationException. method-name))))))))

(deftest native-v8-reader-authorizes-and-preserves-read-only-storage
  (let [directory (Files/createTempDirectory "demo-v8-reader-" (make-array java.nio.file.attribute.FileAttribute 0))
        store-id (random-uuid)
        source-config {:store {:backend :file :path (str directory "/db") :id store-id}
                       :writer {:backend :self :writer-ownership :exclusive}
                       :attribute-refs? true :keep-history? false
                       :fuse-index-roots? true :commit-graph? false :index-config {:diff-buf-size 256}}
        conn (dh/create-conn [{:db/ident :demo/title :db/valueType :db.type/string
                              :db/cardinality :db.cardinality/one}] source-config)
        native-config (:config (d/db conn))
        client (dh/make-client conn {:source-lifecycle (random-uuid) :security-key (str (random-uuid))})
        calls (atom [])]
    (try
      (eacl/write-schema! client "definition user {}\ndefinition document {\n relation viewer: user\n permission view = viewer\n}\n")
      (d/transact conn [{:eacl/id "alice"} {:eacl/id "document" :demo/title "Original"}])
      (eacl/create-relationship!
       client (assoc (eacl/->Relationship (eacl/spice-object :user "alice") :viewer
                                          (eacl/spice-object :document "document"))
                     :valid-until-ms (+ (System/currentTimeMillis) 60000)))
      (d/release conn)
      (let [objects (into {(str store-id "_.konserve-metadata") (.getBytes "konserve" "UTF-8")}
                          (for [file (file-seq (io/file (str directory "/db")))
                                :when (.endsWith (.getName file) ".ksv")]
                            [(str store-id "_" (.getName file)) (Files/readAllBytes (.toPath file))]))
            sdk (fixture-client objects calls)]
        (with-redefs [s3/s3-client (constantly sdk)]
          (let [opened (reader/open-reader! {:bucket "immutable-fixture" :region "us-east-1" :store-id store-id
                                             :store-cache-size 128 :search-cache-size 0 :maximum-concurrency 1
                                             :security-key (str (random-uuid))})
                connection (:connection opened)
                acl (:client opened)
                subject (eacl/spice-object :user "alice")
                resource (eacl/spice-object :document "document")]
            (try
              (is (true? (eacl/can? acl subject :view resource)))
              (is (= {:type :eacl/unsupported-capability :capability :write}
                     (try (eacl/create-relationship! acl (eacl/->Relationship subject :viewer resource))
                          :unexpected-write
                          (catch clojure.lang.ExceptionInfo error
                            (select-keys (ex-data error) [:type :capability])))))
              (let [before (:max-tx (d/db connection))
                    result (deref (future (try (d/transact connection [{:db/id [:eacl/id "document"] :demo/title "Changed"}])
                                               :unexpected-write
                                               (catch Throwable error
                                                 (if (some #(= :eacl-demo/read-only (:type (ex-data %)))
                                                           (take-while some? (iterate #(.getCause %) error)))
                                                   :rejected :unexpected-error))))
                                  5000 :timeout)]
                (is (= :rejected result))
                (is (= before (:max-tx (d/db connection))))
                (is (= "Original" (:demo/title (d/entity (d/db connection) [:eacl/id "document"])))))
              (is (every? #{"headObject" "getObject" "close" "serviceName" "toString" "hashCode" "equals"} @calls))
              (finally (reader/close-reader! opened))))))
      (finally (d/release conn) (d/delete-database native-config)))))
