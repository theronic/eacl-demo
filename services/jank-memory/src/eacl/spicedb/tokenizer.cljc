(ns eacl.spicedb.tokenizer
  "Bounded position-aware tokenizer for the EACL SpiceDB schema subset."
  (:require [clojure.string :as str]))

(def maximum-source-characters 65536)
(def maximum-tokens 100000)
(def maximum-identifier-characters 256)

(def ^:private punctuation
  {":" :colon "|" :pipe "+" :plus "." :dot "/" :slash "#" :hash
   "*" :star "&" :amp "-" :minus "," :comma "(" :lparen
   ")" :rparen "{" :lbrace "}" :rbrace "=" :equals})

(def ^:private reserved
  {"definition" :definition "relation" :relation
   "permission" :permission "with" :with
   "any" :any "all" :all "nil" :nil "self" :self})

(defn- parse-error!
  [reason line column offset data]
  (throw
   (ex-info
    "Schema tokenization failed."
    (merge {:type :eacl.schema/parse-error
            :eacl/error :eacl.schema/parse-error
            :reason reason
            :line line :column column :offset offset}
           data))))

(defn- char-at
  [source position]
  (subs source position (inc position)))

(defn- identifier-start?
  [character]
  (or (= "_" character)
      (str/includes?
       "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
       character)))

(defn- identifier-part?
  [character]
  (or (identifier-start? character)
      (str/includes? "0123456789" character)))

(defn- horizontal-space?
  [character]
  (contains? #{" " "\t" "\f"} character))

(defn- token
  [kind text line column offset]
  {:kind kind :text text :line line :column column :offset offset})

(defn- append-token
  [tokens value line column offset]
  (when (>= (count tokens) maximum-tokens)
    (parse-error! :too-many-tokens line column offset
                  {:maximum maximum-tokens}))
  (conj tokens value))

(defn- scan-identifier
  [source start]
  (loop [position start]
    (if (and (< position (count source))
             (identifier-part? (char-at source position)))
      (recur (inc position))
      position)))

(defn- scan-line-comment
  [source start]
  (loop [position start]
    (if (and (< position (count source))
             (not (contains? #{"\n" "\r"} (char-at source position))))
      (recur (inc position))
      position)))

(defn- scan-block-comment
  [source start line column]
  (loop [position start
         line line
         column column
         newlines []]
    (when (>= position (count source))
      (parse-error! :unterminated-block-comment line column position {}))
    (let [character (char-at source position)
          following (when (< (inc position) (count source))
                      (char-at source (inc position)))]
      (cond
        (and (= "*" character) (= "/" following))
        {:position (+ position 2)
         :line line :column (+ column 2) :newlines newlines}

        (= "\r" character)
        (let [width (if (= "\n" following) 2 1)]
          (recur (+ position width) (inc line) 1
                 (conj newlines (token :newline "\n" line column position))))

        (= "\n" character)
        (recur (inc position) (inc line) 1
               (conj newlines (token :newline "\n" line column position)))

        :else
        (recur (inc position) line (inc column) newlines)))))

(defn tokenize
  [source]
  (when-not (string? source)
    (parse-error! :source-must-be-string 1 1 0 {}))
  (when (> (count source) maximum-source-characters)
    (parse-error! :source-too-large 1 1 0
                  {:maximum maximum-source-characters}))
  (loop [position 0
         line 1
         column 1
         tokens []]
    (if (= position (count source))
      (append-token tokens (token :eof "" line column position)
                    line column position)
      (let [character (char-at source position)
            following (when (< (inc position) (count source))
                        (char-at source (inc position)))]
        (cond
          (horizontal-space? character)
          (recur (inc position) line (inc column) tokens)

          (= "\r" character)
          (let [width (if (= "\n" following) 2 1)]
            (recur (+ position width) (inc line) 1
                   (append-token tokens
                                 (token :newline "\n" line column position)
                                 line column position)))

          (= "\n" character)
          (recur (inc position) (inc line) 1
                 (append-token tokens
                               (token :newline "\n" line column position)
                               line column position))

          (and (= "/" character) (= "/" following))
          (let [end (scan-line-comment source (+ position 2))]
            (recur end line (+ column (- end position)) tokens))

          (and (= "/" character) (= "*" following))
          (let [result (scan-block-comment source (+ position 2)
                                           line (+ column 2))]
            (recur (:position result) (:line result) (:column result)
                   (reduce (fn [result value]
                             (append-token result value
                                           (:line value) (:column value)
                                           (:offset value)))
                           tokens (:newlines result))))

          (and (= "-" character) (= ">" following))
          (recur (+ position 2) line (+ column 2)
                 (append-token tokens
                               (token :arrow "->" line column position)
                               line column position))

          (identifier-start? character)
          (let [end (scan-identifier source position)
                text (subs source position end)]
            (when (> (count text) maximum-identifier-characters)
              (parse-error! :identifier-too-long line column position
                            {:maximum maximum-identifier-characters}))
            (recur end line (+ column (- end position))
                   (append-token tokens
                                 (token (or (get reserved text) :identifier)
                                        text line column position)
                                 line column position)))

          (contains? punctuation character)
          (recur (inc position) line (inc column)
                 (append-token tokens
                               (token (get punctuation character)
                                      character line column position)
                               line column position))

          :else
          (parse-error! :unexpected-character line column position
                        {:character character}))))))
