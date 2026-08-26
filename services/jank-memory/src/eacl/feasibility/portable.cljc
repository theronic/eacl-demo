(ns eacl.feasibility.portable
  (:require [clojure.set :as set]
            [clojure.string :as str]
            [clojure.walk :as walk]))

(def dialect
  #?(:jank :jank
     :clj :clj
     :cljs :cljs))

(def ^:dynamic *binding-probe* :root)

(defn collections-and-sequences
  []
  (let [items [{:id 3 :kind :odd}
               {:id 1 :kind :odd}
               {:id 2 :kind :even}
               {:id 2 :kind :duplicate}]
        by-id (into {} (map (juxt :id identity)) items)]
    {:vector (-> [1 2] (conj 3) (assoc 0 0) pop)
     :map (-> by-id
              (assoc 4 {:id 4})
              (update 4 assoc :kind :even)
              (dissoc 3)
              (select-keys [1 2 4]))
     :set (-> (into #{} (map :id items)) (conj 4) (disj 3))
     :sorted (mapv :id (sort-by :id items))
     :filtered (mapv :id (filter #(= :odd (:kind %)) items))
     :kept (into [] (keep #(when (even? (:id %)) (:id %))) items)
     :distinct (into [] (distinct (map :id items)))
     :reversed (into [] (reverse [1 2 3]))
     :subvector (subvec [0 1 2 3] 1 3)
     :reduced (reduce + 0 (map :id items))
     :nested (-> {} (assoc-in [:a :b] 1) (update-in [:a :b] inc))
     :predicates [(some #(= 3 (:id %)) items)
                  (every? map? items)]
     :grouped (into {} (map (fn [[key values]]
                              [key (mapv :id values)]))
                    (group-by :kind items))
     :frequencies (frequencies (map :id items))
     :mapcat (into [] (mapcat (fn [value] [value (- value)])) [1 2])}))

(defn transients
  []
  {:vector (persistent! (conj! (conj! (transient []) 1) 2))
   :map (persistent! (dissoc! (assoc! (assoc! (transient {}) :a 1) :b 2)
                              :a))
   :set (persistent! (disj! (conj! (conj! (transient #{}) :a) :b)
                            :a))})

(defn metadata-round-trip
  []
  (let [value (with-meta {:value 1} {:eacl/probe :metadata})]
    {:value value
     :metadata (meta value)}))

(defn binding-round-trip
  []
  {:outside *binding-probe*
   :inside (binding [*binding-probe* :inside]
             *binding-probe*)
   :restored *binding-probe*})

(defn caught-ex-info
  []
  (try
    (throw (ex-info "probe" {:type :eacl/probe}))
    (catch #?(:jank cpp/jank.runtime.object_ref
              :clj clojure.lang.ExceptionInfo
              :cljs :default)
           error
      (ex-data error))))

(defn loop-sum
  [upper-bound]
  (loop [value 0
         total 0]
    (if (= value upper-bound)
      total
      (recur (inc value) (+ total value)))))

(defn recursive-sum
  [value]
  (if (zero? value)
    0
    (+ value (recursive-sum (dec value)))))

(defn atom-primitives
  []
  (let [state (atom 0)
        values (swap-vals! state inc)
        cas-success? (compare-and-set! state 1 7)
        cas-failure? (compare-and-set! state 1 8)]
    {:swap-values values
     :cas-success? cas-success?
     :cas-failure? cas-failure?
     :final @state}))

(defn helper-namespaces
  []
  {:string {:joined (str/join "," ["a" "b"])
            :split (str/split "a,b" #",")
            :replaced (str/replace "a-b" "-" "/")
            :lower (str/lower-case "ABC")}
   :set {:union (set/union #{1 2} #{2 3})
         :intersection (set/intersection #{1 2} #{2 3})
         :difference (set/difference #{1 2} #{2 3})}
   :walk (walk/postwalk #(if (integer? %) (inc %) %) {:a [1 2]})})
