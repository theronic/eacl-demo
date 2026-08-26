(ns eacl-demo.fixture-golden
  (:require [clojure.string :as str])
  #?(:clj (:import (java.math BigInteger)
                   (java.security MessageDigest))))

(def seed 20260813)
(def ordinal-multiplier 104729)
(def stream-multiplier -7046029254386353131)
(def mix-multiplier-1 -4658895280553007687)
(def mix-multiplier-2 -7723592293110705685)

(defn account-id [account] (str "account-" account))
(defn owner-id [account] (str (account-id account) "-owner"))
(defn team-id [account team] (str (account-id account) "-team-" team))
(defn leader-id [account team] (str (team-id account team) "-leader"))
(defn vpc-id [account vpc] (str (account-id account) "-vpc-" vpc))
(defn vpc-admin-id [account vpc] (str (vpc-id account vpc) "-admin"))
(defn server-id [account server] (str (account-id account) "-server-" server))

(defn mix64 [value]
  #?(:clj
     (let [mixed (unchecked-multiply (bit-xor (long value)
                                              (unsigned-bit-shift-right (long value) 30))
                                     mix-multiplier-1)
           mixed (unchecked-multiply (bit-xor mixed (unsigned-bit-shift-right mixed 27))
                                     mix-multiplier-2)]
       (bit-xor mixed (unsigned-bit-shift-right mixed 31)))
     :cljs
     (js* "(() => { const mask=(1n<<64n)-1n; let x=BigInt.asUintN(64, BigInt(~{})); x=BigInt.asUintN(64,(x^(x>>30n))*0xbf58476d1ce4e5b9n); x=BigInt.asUintN(64,(x^(x>>27n))*0x94d049bb133111ebn); return BigInt.asUintN(64,x^(x>>31n)); })()" value)))

(defn sample64 [account stream]
  #?(:clj
     (mix64
      (unchecked-add
       (unchecked-add seed (unchecked-multiply (long account) ordinal-multiplier))
       (unchecked-multiply (long stream) stream-multiplier)))
     :cljs
     (mix64 (js* "20260813n + BigInt(~{}) * 104729n + BigInt(~{}) * 0x9e3779b97f4a7c15n"
                 account stream))))

(defn unsigned-string [value]
  #?(:clj (Long/toUnsignedString (long value))
     :cljs (.toString value)))

(defn signed-string [value]
  #?(:clj (str (long value))
     :cljs (.toString (js* "BigInt.asIntN(64, ~{})" value))))

(defn account-server-count [account]
  (if (< account 8)
    16
    (let [tier #?(:clj (Long/remainderUnsigned (long (sample64 account 0)) 10000)
                  :cljs (js/Number (js* "~{} % 10000n" (sample64 account 0))))
          [minimum maximum]
          (cond
            (< tier 5500) [1 2000]
            (< tier 8400) [2001 7500]
            (< tier 9600) [7501 20000]
            :else [20001 50000])
          width (inc (- maximum minimum))
          offset #?(:clj (Long/remainderUnsigned (long (sample64 account 1)) (long width))
                    :cljs (js/Number (js* "~{} % BigInt(~{})" (sample64 account 1) width)))]
      (+ minimum offset))))

(defn read-text [path]
  #?(:clj (slurp path)
     :cljs (.toString (.readFileSync (js/require "node:fs") path "utf8"))))

(defn parse-golden [source]
  (into {}
        (comp
         (remove #(or (str/blank? %) (str/starts-with? % "#")))
         (map #(str/split % #"\t" 2)))
        (str/split-lines source)))

(defn sha256-file [path]
  #?(:clj
     (let [digest (.digest (MessageDigest/getInstance "SHA-256")
                           (.getBytes (slurp path) "UTF-8"))]
       (str "sha256:" (format "%064x" (BigInteger. 1 digest))))
     :cljs
     (let [crypto (js/require "node:crypto")
           fs (js/require "node:fs")]
       (str "sha256:" (.digest (.update (.createHash crypto "sha256")
                                        (.readFileSync fs path))
                               "hex")))))
