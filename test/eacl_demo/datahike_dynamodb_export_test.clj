(ns eacl-demo.datahike-dynamodb-export-test
  (:require [clojure.test :refer [deftest is testing]]
            [eacl-demo.datahike-dynamodb.export :as export]
            [eacl-demo.datahike-dynamodb.export-main :as export-main])
  (:import [java.nio ByteBuffer]
           [java.nio.file Files Path]
           [software.amazon.awssdk.services.dynamodb.model
            BatchWriteItemResponse]))

(def ^:private key-one "00000000-0000-0000-0000-000000000001.ksv")
(def ^:private key-two "00000000-0000-0000-0000-000000000002.ksv")

(defn- fixture-bytes
  [meta value]
  (let [header (byte-array 20)
        _ (aset header 0 (byte 1))
        _ (.putInt (ByteBuffer/wrap header) 4 (alength ^bytes meta))
        result (byte-array (+ 20 (alength ^bytes meta) (alength ^bytes value)))]
    (System/arraycopy header 0 result 0 20)
    (System/arraycopy meta 0 result 20 (alength ^bytes meta))
    (System/arraycopy value 0 result (+ 20 (alength ^bytes meta))
                      (alength ^bytes value))
    result))

(defn- write-blob!
  [^Path directory key meta value]
  (let [path (.resolve directory key)]
    (Files/write path (fixture-bytes meta value)
                 (make-array java.nio.file.OpenOption 0))
    path))

(defn- utf8
  [text]
  (.getBytes ^String text "UTF-8"))

(defn- delete-tree!
  [^Path directory]
  (when (Files/exists directory (make-array java.nio.file.LinkOption 0))
    (with-open [stream (Files/list directory)]
      (doseq [path (iterator-seq (.iterator stream))]
        (Files/deleteIfExists ^Path path)))
    (Files/deleteIfExists directory)))

(deftest raw-konserve-layout-is-preserved-test
  (let [directory (Files/createTempDirectory "eacl-export-layout-"
                                             (make-array java.nio.file.attribute.FileAttribute 0))]
    (try
      (let [path (write-blob! directory key-one (utf8 "metadata")
                              (utf8 "value"))
            blob (export/read-blob (str directory) path)
            item (export/blob-item blob)]
        (is (= key-one (:key blob)))
        (is (= "metadata" (String. ^bytes (:meta blob) "UTF-8")))
        (is (= "value" (String. ^bytes (:value blob) "UTF-8")))
        (is (= 20 (alength ^bytes (:header blob))))
        (is (= "metadata"
               (String. (-> item (get "Meta") .b .asByteArray) "UTF-8")))
        (is (= "value"
               (String. (-> item (get "Value") .b .asByteArray) "UTF-8"))))
      (finally (delete-tree! directory)))))

(deftest preflight-is-deterministic-and-export-retries-only-unprocessed-test
  (let [directory (Files/createTempDirectory "eacl-export-retry-"
                                             (make-array java.nio.file.attribute.FileAttribute 0))]
    (try
      (write-blob! directory key-two (utf8 "m2") (utf8 "v2"))
      (write-blob! directory key-one (utf8 "m1") (utf8 "v1"))
      (let [first-preflight (export/preflight-store (str directory))
            second-preflight (export/preflight-store (str directory))
            calls (atom [])
            sleeps (atom [])
            checkpoints (atom [])
            result
            (export/export-store!
             nil "table" (str directory) first-preflight
             {:clock (constantly 0)
              :sleep #(swap! sleeps conj %)
              :checkpoint! #(swap! checkpoints conj %)
              :call-batch-write
              (fn [_ request]
                (let [writes (vec (get (.requestItems request) "table"))]
                  (swap! calls conj writes)
                  (if (= 1 (count @calls))
                    (-> (BatchWriteItemResponse/builder)
                        (.unprocessedItems {"table" [(first writes)]})
                        .build)
                    (-> (BatchWriteItemResponse/builder) .build))))})]
        (is (= (:store-digest first-preflight)
               (:store-digest second-preflight)))
        (is (= [key-one key-two] (mapv :key (:entries first-preflight))))
        (is (= 2 (:confirmed-count result)))
        (is (= [2 1] (mapv count @calls)))
        (is (= 1 (count @checkpoints)))
        (is (= 2 (:next-index (first @checkpoints))))
        (is (some #{50} @sleeps))
        (is (some pos? @sleeps)))
      (finally (delete-tree! directory)))))

(deftest changed-or-oversized-store-fails-closed-test
  (let [directory (Files/createTempDirectory "eacl-export-closed-"
                                             (make-array java.nio.file.attribute.FileAttribute 0))]
    (try
      (let [path (write-blob! directory key-one (utf8 "meta") (utf8 "value"))
            preflight (export/preflight-store (str directory))]
        (write-blob! directory key-one (utf8 "changed") (utf8 "value"))
        (is (thrown-with-msg?
             clojure.lang.ExceptionInfo #"export validation failed"
             (export/entry-write-request (str directory)
                                         (first (:entries preflight)))))
        (Files/write path (fixture-bytes (utf8 "meta")
                                         (byte-array (* 381 1024)))
                     (make-array java.nio.file.OpenOption 0))
        (is (thrown-with-msg?
             clojure.lang.ExceptionInfo #"export validation failed"
             (export/read-blob (str directory) path))))
      (finally (delete-tree! directory)))))

(deftest checkpoint-is-bound-to-the-exact-store-and-resume-boundary-test
  (let [identity (sorted-map
                  :kind "datahike-dynamodb-export-checkpoint-v1"
                  :table "eacl-demo-datahike-fixture-v1-green"
                  :storeId "2d692f8e-0778-49bf-aed7-241e93d63b2f"
                  :manifestDigest (str "sha256:" (apply str (repeat 64 "1")))
                  :archiveSha256 (str "sha256:" (apply str (repeat 64 "2")))
                  :storeDigest (str "sha256:" (apply str (repeat 64 "3")))
                  :objectCount 2)
        preflight {:entries [{:key key-one} {:key key-two}]}
        progress {:next-index 1 :last-key key-one
                  :store-digest (:storeDigest identity)}
        checkpoint (export-main/checkpoint-value identity progress false)]
    (is (= 1 (export-main/require-valid-checkpoint!
              identity preflight checkpoint)))
    (is (thrown? clojure.lang.ExceptionInfo
                 (export-main/require-valid-checkpoint!
                  identity preflight (assoc checkpoint :lastKey key-two))))
    (is (thrown? clojure.lang.ExceptionInfo
                 (export-main/require-valid-checkpoint!
                  identity preflight
                  (assoc checkpoint :archiveSha256
                         (str "sha256:" (apply str (repeat 64 "4")))))))))
