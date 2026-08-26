(ns eacl.spicedb.parser
  "Bounded recursive-descent parser for EACL's supported SpiceDB surface.

  This replaces the upstream parser generator while retaining the PR #145
  logical schema model and typed compatibility failures."
  (:require [eacl.schema.model :as model]
            [eacl.spicedb.tokenizer :as tokenizer]))

(def maximum-expression-depth 64)
(def maximum-logical-entities 9000)
(def maximum-definitions 1023)

(defn- parse-error!
  [reason state data]
  (let [token (nth (:tokens state) (:index state))]
    (throw
     (ex-info
      "Schema parse error."
      (merge {:type :eacl.schema/parse-error
              :eacl/error :eacl.schema/parse-error
              :reason reason
              :line (:line token) :column (:column token)
              :offset (:offset token) :actual (:kind token)}
             data)))))

(defn- current
  [state]
  (nth (:tokens state) (:index state)))

(defn- kind
  [state]
  (:kind (current state)))

(defn- advance
  [state]
  (update state :index inc))

(defn- expect
  [state expected]
  (when-not (= expected (kind state))
    (parse-error! :unexpected-token state {:expected expected}))
  [(current state) (advance state)])

(defn- skip-newlines
  [state]
  (loop [state state]
    (if (= :newline (kind state))
      (recur (advance state))
      state)))

(defn- parse-identifier
  [state]
  (let [[token state] (expect state :identifier)]
    [(:text token) state]))

(defn- parse-type-path
  [state]
  (let [[first-part state] (parse-identifier state)]
    (loop [parts [first-part]
           state state]
      (if (= :slash (kind state))
        (let [[_ state] (expect state :slash)
              [part state] (parse-identifier state)]
          (recur (conj parts part) state))
        [{:kind :type-path :parts parts} state]))))

(declare parse-union)

(defn- require-depth!
  [depth state]
  (when (> depth maximum-expression-depth)
    (parse-error! :expression-too-deep state
                  {:maximum maximum-expression-depth})))

(defn- parse-primary
  [state depth]
  (require-depth! depth state)
  (case (kind state)
    :identifier
    (let [[token state] (expect state :identifier)]
      [{:kind :identifier :name (:text token) :position token} state])

    :nil
    (let [[token state] (expect state :nil)]
      [{:kind :nil :position token} state])

    :self
    (let [[token state] (expect state :self)]
      [{:kind :self :position token} state])

    :lparen
    (let [[token state] (expect state :lparen)
          [expression state] (parse-union state (inc depth))
          [_ state] (expect state :rparen)]
      [{:kind :paren :expression expression :position token} state])

    (parse-error! :expected-permission-operand state {})))

(defn- parse-arrow
  [state depth]
  (if (and (= :identifier (kind state))
           (= :dot (:kind (nth (:tokens state) (inc (:index state))))))
    (let [[base state] (parse-identifier state)
          [dot-token state] (expect state :dot)
          function-kind (kind state)
          _ (when-not (contains? #{:any :all} function-kind)
              (parse-error! :unknown-arrow-function state {}))
          [_ state] (expect state function-kind)
          [_ state] (expect state :lparen)
          [target state] (parse-identifier state)
          [_ state] (expect state :rparen)]
      [{:kind :arrow-function :function function-kind
        :base base :target target :position dot-token}
       state])
    (let [[first-part state] (parse-primary state depth)]
      (loop [parts [first-part]
             state state]
        (if (= :arrow (kind state))
          (let [[_ state] (expect state :arrow)
                [part state] (parse-primary state (inc depth))]
            (recur (conj parts part) state))
          [{:kind :arrow :parts parts :position (:position first-part)}
           state])))))

(defn- parse-repeated
  [state depth child-parser operator node-kind]
  (let [[first-child state] (child-parser state depth)]
    (loop [children [first-child]
           state state]
      (if (= operator (kind state))
        (let [[_ state] (expect state operator)
              [child state] (child-parser state depth)]
          (recur (conj children child) state))
        [{:kind node-kind :children children
          :position (:position first-child)} state]))))

(defn- parse-exclusion
  [state depth]
  (parse-repeated state depth parse-arrow :minus :exclusion))

(defn- parse-intersection
  [state depth]
  (parse-repeated state depth parse-exclusion :amp :intersection))

(defn- parse-union
  [state depth]
  (parse-repeated state depth parse-intersection :plus :union))

(defn- parse-relation-subject
  [state]
  (let [[path state] (parse-type-path state)
        [wildcard? subject-relation state]
        (cond
          (= :colon (kind state))
          (let [[_ state] (expect state :colon)
                [_ state] (expect state :star)]
            [true nil state])

          (= :hash (kind state))
          (let [[_ state] (expect state :hash)
                [relation state] (parse-identifier state)]
            [false relation state])

          :else [false nil state])
        [caveat state]
        (if (= :with (kind state))
          (let [[_ state] (expect state :with)
                [name state] (parse-identifier state)]
            [name state])
          [nil state])]
    [{:kind :relation-subject :path path :wildcard? wildcard?
      :subject-relation subject-relation :caveat caveat}
     state]))

(defn- parse-relation
  [state]
  (let [[start state] (expect state :relation)
        [name state] (parse-identifier state)
        [_ state] (expect state :colon)
        [first-subject state] (parse-relation-subject state)]
    (loop [subjects [first-subject]
           state state]
      (if (= :pipe (kind state))
        (let [[_ state] (expect state :pipe)
              [subject state] (parse-relation-subject state)]
          (recur (conj subjects subject) state))
        [{:kind :relation :name name :subjects subjects :position start}
         state]))))

(defn- parse-permission
  [state]
  (let [[start state] (expect state :permission)
        [name state] (parse-identifier state)
        [_ state] (expect state :equals)
        [expression state] (parse-union state 0)]
    [{:kind :permission :name name :expression expression :position start}
     state]))

(defn- parse-definition
  [state]
  (let [[start state] (expect state :definition)
        [path state] (parse-type-path state)
        [_ state] (expect state :lbrace)]
    (loop [declarations []
           state (skip-newlines state)]
      (case (kind state)
        :rbrace
        (let [[_ state] (expect state :rbrace)]
          [{:kind :definition :path path :declarations declarations
            :position start}
           state])

        :relation
        (let [[declaration state] (parse-relation state)]
          (when-not (= :newline (kind state))
            (parse-error! :declaration-must-end-at-line-boundary state {}))
          (recur (conj declarations declaration) (skip-newlines state)))

        :permission
        (let [[declaration state] (parse-permission state)]
          (when-not (= :newline (kind state))
            (parse-error! :declaration-must-end-at-line-boundary state {}))
          (recur (conj declarations declaration) (skip-newlines state)))

        (parse-error! :expected-declaration-or-closing-brace state {})))))

(defn parse-schema
  [source]
  (let [tokens (tokenizer/tokenize source)
        initial (skip-newlines {:tokens tokens :index 0})]
    (when (= :eof (kind initial))
      (parse-error! :schema-requires-definition initial {}))
    (loop [definitions []
           state initial]
      (let [[definition state] (parse-definition state)
            state (skip-newlines state)]
        (case (kind state)
          :definition (recur (conj definitions definition) state)
          :eof {:kind :schema :definitions (conj definitions definition)}
          (parse-error! :expected-definition state {}))))))

(defn parse-permission-expression
  [source]
  (try
    (let [schema (parse-schema
                  (str "definition temp {\npermission test = " source "\n}"))]
      (:expression (first (:declarations (first (:definitions schema))))))
    (catch #?(:jank cpp/jank.runtime.object_ref
              :clj clojure.lang.ExceptionInfo)
           _ nil)))

(defn- duplicate-error!
  [type data]
  (throw
   (ex-info
    "Duplicate or colliding schema declaration."
    (merge {:type type :eacl/error type} data))))

(defn extract-relations
  [definition]
  (loop [remaining (seq (:declarations definition))
         result {}]
    (if-not remaining
      result
      (let [declaration (first remaining)]
        (if (= :relation (:kind declaration))
          (if (contains? result (:name declaration))
            (duplicate-error! :eacl.schema/duplicate-relation
                              {:relation (:name declaration)})
            (recur (next remaining)
                   (assoc result (:name declaration)
                          (:subjects declaration))))
          (recur (next remaining) result))))))

(defn extract-permissions
  [definition]
  (loop [remaining (seq (:declarations definition))
         result []
         names #{}]
    (if-not remaining
      result
      (let [declaration (first remaining)]
        (if (= :permission (:kind declaration))
          (if (contains? names (:name declaration))
            (duplicate-error! :eacl.schema/duplicate-permission
                              {:permission (:name declaration)})
            (recur (next remaining) (conj result declaration)
                   (conj names (:name declaration))))
          (recur (next remaining) result names))))))

(defn extract-definitions
  [schema]
  (reduce
   (fn [result definition]
     (let [path (get-in definition [:path :parts])
           name (apply str (interpose "/" path))
           relations (extract-relations definition)
           permissions (extract-permissions definition)
           collisions
           (filter #(contains? relations (:name %)) permissions)]
       (when (seq collisions)
         (duplicate-error! :eacl.schema/name-collision
                           {:definition name
                            :names (mapv :name collisions)}))
       (if (contains? result name)
         (duplicate-error! :eacl.schema/duplicate-definition
                           {:definition name})
         (assoc result name {:relations relations
                             :permissions permissions
                             :path path}))))
   {} (:definitions schema)))

(defn transform-schema
  [schema]
  (when-not (and (map? schema) (= :schema (:kind schema)))
    (throw
     (ex-info
      "Unexpected schema AST."
      {:type :eacl.schema/parse-error
       :eacl/error :eacl.schema/parse-error
       :reason :invalid-ast})))
  {:definitions (extract-definitions schema)})

(declare expression-issues)

(defn- expression-issues
  [expression]
  (let [kind (:kind expression)
        children (:children expression)]
    (cond
      (= :union kind)
      (vec (mapcat expression-issues children))

      (= :intersection kind)
      (into (if (> (count children) 1)
              [{:type :unsupported-operator :operator "&"}]
              [])
            (mapcat expression-issues children))

      (= :exclusion kind)
      (into (if (> (count children) 1)
              [{:type :unsupported-operator :operator "-"}]
              [])
            (mapcat expression-issues children))

      (= :arrow kind)
      (into
       (cond-> []
         (> (count (:parts expression)) 2)
         (conj {:type :multi-level-arrow})
         (and (> (count (:parts expression)) 1)
              (some #(= :paren (:kind %)) (:parts expression)))
         (conj {:type :paren-arrow}))
       (mapcat expression-issues (:parts expression)))

      (= :arrow-function kind)
      (if (= :all (:function expression))
        [{:type :unsupported-arrow-function :function "all"}]
        [])

      (= :paren kind) (expression-issues (:expression expression))
      (= :nil kind) [{:type :unsupported-keyword :keyword "nil"}]
      (= :self kind) [{:type :unsupported-keyword :keyword "self"}]
      :else [])))

(defn- relation-issues
  [definition-name relation]
  (vec
   (mapcat
    (fn [subject]
      (cond-> []
        (> (count (get-in subject [:path :parts])) 1)
        (conj {:type :namespaced-type
               :resource-type definition-name
               :relation (:name relation)})
        (:wildcard? subject)
        (conj {:type :wildcard-relation
               :resource-type definition-name
               :relation (:name relation)})
        (:subject-relation subject)
        (conj {:type :subject-relation
               :resource-type definition-name
               :relation (:name relation)
               :subject-relation (:subject-relation subject)})
        (:caveat subject)
        (conj {:type :caveat
               :resource-type definition-name
               :relation (:name relation)
               :caveat (:caveat subject)})))
    (:subjects relation))))

(defn validate-eacl-restrictions
  [schema transformed]
  (let [issues
        (vec
         (mapcat
          (fn [definition]
            (let [definition-name
                  (apply str (interpose "/" (get-in definition [:path :parts])))]
              (into
               (if (> (count (get-in definition [:path :parts])) 1)
                 [{:type :namespaced-type :definition definition-name}]
                 [])
               (mapcat
                (fn [declaration]
                  (case (:kind declaration)
                    :relation (relation-issues definition-name declaration)
                    :permission (expression-issues (:expression declaration))
                    []))
                (:declarations definition)))))
          (:definitions schema)))]
    (when (seq issues)
      (throw
       (ex-info
        "Schema contains features unsupported by EACL."
        {:type :eacl.schema/unsupported-feature
         :eacl/error :eacl.schema/unsupported-feature
         :issues issues :issue-count (count issues)})))
    nil))

(defn- schema-info
  [definitions]
  (reduce
   (fn [result [resource-type definition]]
     (assoc result resource-type
            {:relations (set (keys (:relations definition)))
             :relation-subject-types
             (into {}
                   (map
                    (fn [[relation-name subjects]]
                      [relation-name
                       (into #{}
                             (map #(first (get-in % [:path :parts])))
                             subjects)]))
                   (:relations definition))
             :permissions (into #{} (map :name) (:permissions definition))}))
   {} definitions))

(declare flatten-expression)

(defn- flatten-expression
  [expression]
  (case (:kind expression)
    :union (vec (mapcat flatten-expression (:children expression)))
    :intersection (vec (mapcat flatten-expression (:children expression)))
    :exclusion (vec (mapcat flatten-expression (:children expression)))
    :identifier [{:type :identifier :name (:name expression)}]
    :paren (flatten-expression (:expression expression))
    :arrow
    (let [parts (:parts expression)]
      (if (= 1 (count parts))
        (flatten-expression (first parts))
        [{:type :arrow
          :base (:name (first parts))
          :target (:name (second parts))}]))
    :arrow-function
    [{:type :arrow :base (:base expression) :target (:target expression)}]
    []))

(defn- resolve-component
  [component resource-type info]
  (case (:type component)
    :identifier
    (if (contains? (get-in info [resource-type :relations] #{})
                   (:name component))
      {:relation (keyword (:name component))}
      {:permission (keyword (:name component))})

    :arrow
    (let [base (:base component)
          target (:target component)
          subject-types
          (get-in info [resource-type :relation-subject-types base] #{})]
      (when (empty? subject-types)
        (throw
         (ex-info
          "Unknown relation for arrow base."
          {:type :eacl.schema/invalid-reference
           :eacl/error :eacl.schema/invalid-reference
           :resource-type resource-type :relation base})))
      (let [kinds
            (into #{}
                  (map
                   (fn [subject-type]
                     (cond
                       (contains? (get-in info [subject-type :relations] #{})
                                  target) :relation
                       (contains? (get-in info [subject-type :permissions] #{})
                                  target) :permission
                       :else :missing)))
                  subject-types)
            present (disj kinds :missing)]
        (when (= present #{:relation :permission})
          (throw
           (ex-info
            "Arrow target has mixed relation/permission kinds."
            {:type :eacl.schema/mixed-arrow-target
             :eacl/error :eacl.schema/mixed-arrow-target
             :resource-type resource-type :relation base
             :target target :subject-types subject-types})))
        (if (= present #{:relation})
          {:arrow (keyword base) :relation (keyword target)}
          {:arrow (keyword base) :permission (keyword target)})))

    (throw (ex-info "Unsupported permission component."
                    {:type :eacl.schema/invalid-component}))))

(defn ->eacl-schema
  [schema]
  (let [transformed (transform-schema schema)]
    (validate-eacl-restrictions schema transformed)
    (let [definitions (:definitions transformed)
          info (schema-info definitions)
          definition-order
          (mapv (fn [definition]
                  (apply str
                         (interpose "/" (get-in definition [:path :parts]))))
                (:definitions schema))
          _ (when (> (count definition-order) maximum-definitions)
              (throw
               (ex-info
                "Schema has too many definitions."
                {:type :eacl.schema/schema-too-large
                 :eacl/error :eacl.schema/schema-too-large
                 :maximum-definitions maximum-definitions})))
          result
          {:definitions definition-order
           :relations
           (vec
            (distinct
            (mapcat
             (fn [[resource-type definition]]
               (mapcat
                (fn [[relation-name subjects]]
                  (map
                   (fn [subject]
                     (model/Relation
                      (keyword resource-type)
                      (keyword relation-name)
                      (keyword (first (get-in subject [:path :parts])))))
                   subjects))
                (:relations definition)))
             definitions)))
           :permissions
           (vec
            (distinct
            (mapcat
             (fn [[resource-type definition]]
               (mapcat
                (fn [permission]
                  (map
                   (fn [component]
                     (model/Permission
                      (keyword resource-type)
                      (keyword (:name permission))
                      (resolve-component component resource-type info)))
                   (flatten-expression (:expression permission))))
                (:permissions definition)))
             definitions)))}]
      (when (> (+ (count (:relations result))
                  (count (:permissions result)))
               maximum-logical-entities)
        (throw
         (ex-info
          "Schema has too many logical relation and permission entities."
          {:type :eacl.schema/schema-too-large
           :eacl/error :eacl.schema/schema-too-large
           :maximum maximum-logical-entities})))
      (model/validate-schema-references result)
      result)))
