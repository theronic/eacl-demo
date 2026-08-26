(ns eacl.secure-keyring
  "Validated plain-map AES-256 keyrings with deterministic rotation."
  #?(:jank
     (:require [eacl.runtime.native.encoding :as native-encoding])))

(def ^:private keyring-kind ::keyring)
(def ^:private normalized-keys #{::kind :active-kid :keys})

(defn- invalid-keyring!
  [reason data]
  (throw
   (ex-info
    "Secure keyring is invalid."
    (merge {:type :eacl.crypto/invalid-keyring
            :eacl/error :eacl.crypto/invalid-keyring
            :reason reason}
           data))))

(defn- valid-kid?
  [kid]
  (and (string? kid)
       (<= 1 (count kid) 64)
       (boolean (re-matches #"[A-Za-z0-9._-]+" kid))))

(defn- valid-key?
  [key]
  #?(:jank
     (and (native-encoding/hex-string? key)
          (= 32 (native-encoding/byte-length key)))
     :clj false))

(defn keyring
  [value]
  (when-not (and (map? value)
                 (= #{:active-kid :keys} (set (keys value))))
    (invalid-keyring! :unknown-fields {}))
  (let [active-kid (:active-kid value)
        key-map (:keys value)]
    (when-not (and (valid-kid? active-kid)
                   (map? key-map)
                   (seq key-map)
                   (<= (count key-map) 32)
                   (every? valid-kid? (keys key-map))
                   (every? valid-key? (vals key-map))
                   (contains? key-map active-kid))
      (invalid-keyring! :invalid-key-material {}))
    {::kind keyring-kind
     :active-kid active-kid
     :keys (into (sorted-map) key-map)}))

(defn keyring?
  [value]
  (and (map? value)
       (= normalized-keys (set (keys value)))
       (= keyring-kind (::kind value))
       (try
         (keyring (select-keys value [:active-kid :keys]))
         true
         (catch #?(:jank cpp/jank.runtime.object_ref
                   :clj clojure.lang.ExceptionInfo)
                _
           false))))

(defn- require-keyring!
  [value]
  (when-not (keyring? value)
    (invalid-keyring! :invalid-normalized-keyring {}))
  value)

(defn encryption-key
  [value]
  (require-keyring! value)
  (let [kid (:active-kid value)]
    {:kid kid :key (get (:keys value) kid)}))

(defn decryption-key
  [value kid]
  (require-keyring! value)
  (when-not (valid-kid? kid)
    (invalid-keyring! :invalid-kid {}))
  (if-let [key (get (:keys value) kid)]
    key
    (throw
     (ex-info
      "Secure token key identifier is unknown."
      {:type :eacl.crypto/unknown-key
       :eacl/error :eacl.crypto/unknown-key
       :kid kid}))))

(defn rotate
  [value new-kid new-key]
  (require-keyring! value)
  (keyring {:active-kid new-kid
            :keys (assoc (:keys value) new-kid new-key)}))

(defn- normalize-retained-kids
  [retained-kids]
  (when-not (or (set? retained-kids) (sequential? retained-kids))
    (invalid-keyring! :invalid-retained-keys {}))
  (loop [remaining (seq retained-kids)
         consumed 0
         result #{}]
    (if-not remaining
      result
      (do
        (when (= consumed 32)
          (invalid-keyring! :too-many-retained-keys {:maximum 32}))
        (let [kid (first remaining)]
          (when-not (valid-kid? kid)
            (invalid-keyring! :invalid-kid {}))
          (recur (next remaining) (inc consumed) (conj result kid)))))))

(defn retain
  [value retained-kids]
  (require-keyring! value)
  (let [retained-kids (normalize-retained-kids retained-kids)]
    (when-not (contains? retained-kids (:active-kid value))
      (invalid-keyring! :active-key-not-retained {}))
    (when-not (every? #(contains? (:keys value) %) retained-kids)
      (invalid-keyring! :unknown-retained-key {}))
    (keyring {:active-kid (:active-kid value)
              :keys (select-keys (:keys value) retained-kids)})))
