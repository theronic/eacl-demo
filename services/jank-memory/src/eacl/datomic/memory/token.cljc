(ns eacl.datomic.memory.token
  "Versioned authenticated causal tokens for exact memory snapshots."
  (:require [clojure.string :as str]
            [eacl.datomic.memory.order :as order]
            [eacl.runtime.native.crypto :as crypto]
            [eacl.runtime.native.encoding :as encoding]
            [eacl.secure-format :as secure-format]
            [eacl.secure-keyring :as secure-keyring]))

(def token-version 2)
(def token-prefix "eaclct2_")
(def maximum-token-length 8192)
(def ^:private authentication-domain
  (encoding/utf8->hex "eacl/memory-causal-token/v2\n"))
(def ^:private payload-keys
  #{:format :store :lifecycle :revision :locator :issued-at :expires-at})
(def ^:private wire-field-count 7)

(defn- invalid-token!
  [reason]
  (throw
   (ex-info
    "EACL causal token is invalid."
    {:type :eacl.consistency/invalid-token
     :eacl/error :eacl.consistency/invalid-token
     :reason reason})))

(defn- identity-hex?
  [value]
  (and (encoding/hex-string? value)
       (= 16 (encoding/byte-length value))))

(defn- valid-payload?
  [payload]
  (and (map? payload)
       (= payload-keys (set (keys payload)))
       (= token-version (:format payload))
       (identity-hex? (:store payload))
       (identity-hex? (:lifecycle payload))
       (order/non-negative-id? (:revision payload))
       (= (:revision payload) (:locator payload))
       (order/non-negative-id? (:issued-at payload))
       (order/non-negative-id? (:expires-at payload))
       (<= (:issued-at payload) (:expires-at payload))))

(defn- payload->wire
  [payload]
  [(:format payload) (:store payload) (:lifecycle payload)
   (:revision payload) (:locator payload)
   (:issued-at payload) (:expires-at payload)])

(defn- wire->payload
  [wire]
  (when-not (and (vector? wire) (= wire-field-count (count wire)))
    (invalid-token! :malformed))
  {:format (nth wire 0)
   :store (nth wire 1)
   :lifecycle (nth wire 2)
   :revision (nth wire 3)
   :locator (nth wire 4)
   :issued-at (nth wire 5)
   :expires-at (nth wire 6)})

(defn- encode-kid
  [kid]
  (encoding/hex->base64url (encoding/utf8->hex kid)))

(defn- authentication-input
  [kid payload-encoded]
  ;; Both values are canonical, self-delimiting encodings. Keeping the payload
  ;; bytes already destined for the wire avoids rebuilding the full token map
  ;; merely to compute its HMAC.
  (str authentication-domain
       (secure-format/encode-canonical [token-version kid])
       payload-encoded))

(defn- decode-envelope
  [encoded]
  (let [parts (str/split (subs encoded (count token-prefix)) #"\." -1)]
    (when-not (= 3 (count parts))
      (invalid-token! :malformed))
    (let [kid-encoded (nth parts 0)
          payload-encoded (nth parts 1)
          tag (nth parts 2)]
      (when-not (and (not (empty? kid-encoded))
                     (encoding/hex-string? payload-encoded)
                     (pos? (encoding/byte-length payload-encoded))
                     (<= (encoding/byte-length payload-encoded) 4096)
                     (encoding/hex-string? tag)
                     (= 32 (encoding/byte-length tag)))
        (invalid-token! :malformed))
      {:kid
       (encoding/hex->utf8 (encoding/base64url->hex kid-encoded))
       :payload-encoded payload-encoded
       :tag tag})))

(defn issue
  [{:keys [store-id lifecycle-id revision issued-at ttl-seconds keyring]}]
  (when-not (and (identity-hex? store-id)
                 (identity-hex? lifecycle-id)
                 (order/non-negative-id? revision)
                 (order/non-negative-id? issued-at)
                 (integer? ttl-seconds)
                 (pos? ttl-seconds)
                 (secure-keyring/keyring? keyring))
    (invalid-token! :invalid-issuance-input))
  (let [{:keys [kid key]} (secure-keyring/encryption-key keyring)
        expires-at (+ (bigint issued-at) (bigint ttl-seconds))
        _ (when-not (order/non-negative-id? expires-at)
            (invalid-token! :expiry-out-of-range))
        payload {:format token-version
                 :store store-id
                 :lifecycle lifecycle-id
                 :revision revision
                 :locator revision
                 :issued-at issued-at
                 :expires-at expires-at}
        payload-encoded
        (secure-format/encode-canonical (payload->wire payload))
        tag (crypto/hmac-sha-256
             key (authentication-input kid payload-encoded))
        encoded (str token-prefix (encode-kid kid) "."
                     payload-encoded "." tag)]
    (when (> (count encoded) maximum-token-length)
      (invalid-token! :too-large))
    encoded))

(defn decode
  [keyring encoded]
  (when-not (and (secure-keyring/keyring? keyring)
                 (string? encoded)
                 (<= (count encoded) maximum-token-length)
                 (str/starts-with? encoded token-prefix))
    (invalid-token! :malformed))
  (try
    (let [{:keys [kid payload-encoded tag]} (decode-envelope encoded)
          payload
          (wire->payload
           (secure-format/decode-canonical
            payload-encoded {:maximum-size 4096}))]
      (let [key (secure-keyring/decryption-key keyring kid)
            expected
            (crypto/hmac-sha-256
             key (authentication-input kid payload-encoded))]
        (when-not (crypto/constant-time-equal? expected tag)
          (invalid-token! :authentication-failed))
        (when-not (valid-payload? payload)
          (invalid-token! :invalid-payload))
        (assoc payload :kid kid)))
    (catch #?(:jank cpp/jank.runtime.object_ref
              :clj clojure.lang.ExceptionInfo)
           error
      (if (= :eacl.consistency/invalid-token (:type (ex-data error)))
        (throw error)
        (invalid-token! :malformed)))))
