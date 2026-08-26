(ns eacl.cursor
  "Encrypted authenticated snapshot-bound external cursor format."
  (:require [clojure.string :as str]
            [eacl.secure-format :as secure-format]
            [eacl.secure-keyring :as keyring]
            #?(:jank [eacl.runtime.native.clock :as clock])
            #?(:jank [eacl.runtime.native.crypto :as crypto])
            #?(:jank [eacl.runtime.native.encoding :as encoding])))

(def cursor-version 3)
(def cursor-prefix "eaclc3_")
(def maximum-cursor-length 32768)
(def maximum-future-skew-seconds 300)
(def payload-keys
  #{:v :operation :query-fingerprint :anchor :snapshot-token :source-scope
    :native-revision :schema-generation :ordering-abi
    :dependency-proof-fingerprint :issued-at :expires-at})
(def ^:private payload-wire-fields
  [:v :operation :query-fingerprint :anchor :snapshot-token
   :store-id :lifecycle-id :native-revision :schema-generation :ordering-abi
   :dependency-proof-fingerprint :issued-at :expires-at])
(def ^:private aad
  #?(:jank (encoding/utf8->hex "eacl/jank-cursor/v3\n") :clj nil))
(def ^:private hex-digits (set "0123456789abcdef"))

(defn- fail!
  [reason data]
  (throw
   (ex-info
    "EACL continuation cursor is invalid."
    (merge {:type :eacl.pagination/invalid-cursor
            :eacl/error :eacl.pagination/invalid-cursor
            :reason reason} data))))

(defn now-seconds
  []
  #?(:jank (bigint (quot (clock/unix-time-millis) 1000))
     :clj 0))

(defn fingerprint
  "Return the domain-separated SHA-256 binding for a cursor scope or proof."
  [value]
  #?(:jank
     (crypto/sha-256
      (secure-format/encode-canonical
       [:eacl.cursor/fingerprint-v2 value]
       {:maximum-size 16384 :maximum-depth 32 :maximum-entries 4096}))
     :clj (fail! :jank-runtime-required {})))

(defn- fingerprint?
  [value]
  (and (string? value)
       (= 64 (count value))
       (every? hex-digits value)))

(defn- valid-payload?
  [payload]
  (and (map? payload)
       (= payload-keys (set (keys payload)))
       (= cursor-version (:v payload))
       (keyword? (:operation payload))
       (fingerprint? (:query-fingerprint payload))
       (vector? (:anchor payload))
       (string? (:snapshot-token payload))
       (map? (:source-scope payload))
       (= #{:store-id :lifecycle-id}
          (set (keys (:source-scope payload))))
       (every? string? (vals (:source-scope payload)))
       (integer? (:schema-generation payload))
       (not (neg? (:schema-generation payload)))
       (integer? (:native-revision payload))
       (not (neg? (:native-revision payload)))
       (integer? (:ordering-abi payload))
       (pos? (:ordering-abi payload))
       (fingerprint? (:dependency-proof-fingerprint payload))
       (integer? (:issued-at payload))
       (integer? (:expires-at payload))
       (<= 0 (:issued-at payload) (:expires-at payload))))

(defn- payload->wire
  "Encode the closed cursor payload as a fixed-order vector.

  Cursor v2 encoded a keyword-keyed map, then encoded the encrypted hex again
  inside another canonical map before base64url encoding it.  That opaque
  representation was correct but multiplied both wire size and temporary
  allocation.  V3 keeps the same authenticated fields while giving the wire
  grammar one unambiguous order and no redundant field-name strings."
  [payload]
  [(:v payload)
   (:operation payload)
   (:query-fingerprint payload)
   (:anchor payload)
   (:snapshot-token payload)
   (get-in payload [:source-scope :store-id])
   (get-in payload [:source-scope :lifecycle-id])
   (:native-revision payload)
   (:schema-generation payload)
   (:ordering-abi payload)
   (:dependency-proof-fingerprint payload)
   (:issued-at payload)
   (:expires-at payload)])

(defn- wire->payload
  [wire]
  (when-not (and (vector? wire)
                 (= (count payload-wire-fields) (count wire)))
    (fail! :invalid-payload {}))
  (let [flat (zipmap payload-wire-fields wire)]
    {:v (:v flat)
     :operation (:operation flat)
     :query-fingerprint (:query-fingerprint flat)
     :anchor (:anchor flat)
     :snapshot-token (:snapshot-token flat)
     :source-scope {:store-id (:store-id flat)
                    :lifecycle-id (:lifecycle-id flat)}
     :native-revision (:native-revision flat)
     :schema-generation (:schema-generation flat)
     :ordering-abi (:ordering-abi flat)
     :dependency-proof-fingerprint
     (:dependency-proof-fingerprint flat)
     :issued-at (:issued-at flat)
     :expires-at (:expires-at flat)}))

(defn- encode-kid
  [kid]
  #?(:jank (encoding/hex->base64url (encoding/utf8->hex kid))
     :clj (fail! :jank-runtime-required {})))

(defn- decode-envelope
  [encoded]
  #?(:jank
     (let [parts (str/split (subs encoded (count cursor-prefix)) #"\." -1)]
       (when-not (= 4 (count parts))
         (fail! :malformed {}))
       (let [kid-encoded (nth parts 0)
             nonce (nth parts 1)
             ciphertext (nth parts 2)
             tag (nth parts 3)]
         (when-not (and (not (empty? kid-encoded))
                        (encoding/hex-string? nonce)
                        (= 12 (encoding/byte-length nonce))
                        (encoding/hex-string? ciphertext)
                        (pos? (encoding/byte-length ciphertext))
                        (<= (encoding/byte-length ciphertext) 16384)
                        (encoding/hex-string? tag)
                        (= 16 (encoding/byte-length tag)))
           (fail! :malformed {}))
         {:kid
          (encoding/hex->utf8 (encoding/base64url->hex kid-encoded))
          :nonce nonce :ciphertext ciphertext :tag tag}))
     :clj (fail! :jank-runtime-required {})))

(defn issue-at
  "Issue at an explicit Unix second for deterministic qualification vectors.

  Production callers use `issue`; accepting the clock as data here lets tests
  prove exclusive expiry and future-skew rejection without sleeping."
  [secure-keyring ttl-seconds issued-at value]
  (when-not (and (keyring/keyring? secure-keyring)
                 (integer? ttl-seconds) (pos? ttl-seconds)
                 (integer? issued-at) (not (neg? issued-at))
                 (map? value))
    (fail! :invalid-issuance-input {}))
  (let [payload
        (assoc value :v cursor-version
               :issued-at issued-at
               :expires-at (+ issued-at (bigint ttl-seconds)))]
    (when-not (valid-payload? payload)
      (fail! :invalid-payload {}))
    #?(:jank
       (let [{:keys [kid key]} (keyring/encryption-key secure-keyring)
             nonce (crypto/secure-random-hex 12)
             plaintext (secure-format/encode-canonical
                        (payload->wire payload)
                        {:maximum-size 16384
                         :maximum-depth 32
                         :maximum-entries 4096})
             encrypted (crypto/aes-256-gcm-encrypt
                        key nonce plaintext aad)
             encoded
             (str cursor-prefix (encode-kid kid) "." nonce "."
                  (:ciphertext encrypted) "." (:tag encrypted))]
         (when (> (count encoded) maximum-cursor-length)
           (fail! :too-large {}))
         encoded)
       :clj (fail! :jank-runtime-required {}))))

(defn issue
  [secure-keyring ttl-seconds value]
  (issue-at secure-keyring ttl-seconds (now-seconds) value))

(defn decode
  [secure-keyring encoded]
  (when-not (and (keyring/keyring? secure-keyring)
                 (string? encoded)
                 (<= (count encoded) maximum-cursor-length)
                 (str/starts-with? encoded cursor-prefix))
    (fail! :malformed {}))
  #?(:jank
     (try
       (let [envelope (decode-envelope encoded)
             key (keyring/decryption-key secure-keyring (:kid envelope))
             plaintext
             (crypto/aes-256-gcm-decrypt
              key (:nonce envelope) (:ciphertext envelope)
              (:tag envelope) aad)
             payload
             (wire->payload
              (secure-format/decode-canonical
               plaintext
               {:maximum-size 16384 :maximum-depth 32
                :maximum-entries 4096}))]
         (when-not (valid-payload? payload)
           (fail! :invalid-payload {}))
         payload)
       (catch cpp/jank.runtime.object_ref error
         (if (= :eacl.pagination/invalid-cursor
                (:type (ex-data error)))
           (throw error)
           (fail! :authentication-or-format-failure {}))))
     :clj (fail! :jank-runtime-required {})))

(defn validate-current!
  [payload]
  (when-not (valid-payload? payload)
    (fail! :invalid-payload {}))
  (let [now (now-seconds)]
    (when (> (:issued-at payload) (+ now maximum-future-skew-seconds))
      (fail! :issued-in-future {:issued-at (:issued-at payload)}))
    (when (>= now (:expires-at payload))
      (fail! :expired {:expired-at (:expires-at payload)})))
  payload)
