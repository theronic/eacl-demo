(ns eacl-demo.fixture
  (:require [eacl-demo.fixture-golden :as golden]))

(def fixture-id "eacl-demo-fixture-v1")
(def algorithm-version 1)
(def seed "20260813")
(def small-resource-count 10000)
(def small-manifest-sha256
  "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a")
(def small-fixture-sha256
  "ec47ae57973bc7e9c580709410e530a7ac64acd24c01f9e3161489e8ebd58dfd")
(def schema-sha256
  "7fa7ae57dec4e442c66815ea74a63b08f12a79d7e9a716ebc8f1d6b03ee2262c")
(def exemplar-sha256
  "1d144a8031c29057bf553cd832549781233351c40e02d0010c127fd3134a93f2")

(def schema
  (str "definition user {}\n\n"
       "definition platform {\n"
       "  relation super_admin: user\n"
       "  permission view = super_admin\n"
       "}\n\n"
       "definition account {\n"
       "  relation owner: user\n"
       "  relation platform: platform\n"
       "  relation parent: account\n"
       "  permission admin = owner + parent->admin + platform->super_admin\n"
       "  permission view = admin + parent->admin\n"
       "}\n\n"
       "definition team {\n"
       "  relation account: account\n"
       "  relation leader: user\n"
       "  permission admin = account->admin + leader\n"
       "  permission view = admin\n"
       "}\n\n"
       "definition vpc {\n"
       "  relation account: account\n"
       "  relation shared_admin: user\n"
       "  permission admin = account->admin + shared_admin\n"
       "  permission view = admin\n"
       "}\n\n"
       "definition server {\n"
       "  relation account: account\n"
       "  relation team: team\n"
       "  relation vpc: vpc\n"
       "  relation shared_admin: user\n"
       "  relation parent: server\n"
       "  permission admin = account->admin + shared_admin\n"
       "  permission view = admin + parent->view + account->view + team->view + vpc->view + shared_admin\n"
       "}\n"))

(def wire-schema
  {:sha256 schema-sha256
   :types
   [{:name "account"
     :relations [{:name "owner" :subjectTypes ["user"]}
                 {:name "parent" :subjectTypes ["account"]}
                 {:name "platform" :subjectTypes ["platform"]}]
     :permissions [{:name "admin" :expression "owner + parent->admin + platform->super_admin"}
                   {:name "view" :expression "admin + parent->admin"}]}
    {:name "platform"
     :relations [{:name "super_admin" :subjectTypes ["user"]}]
     :permissions [{:name "view" :expression "super_admin"}]}
    {:name "server"
     :relations [{:name "account" :subjectTypes ["account"]}
                 {:name "parent" :subjectTypes ["server"]}
                 {:name "shared_admin" :subjectTypes ["user"]}
                 {:name "team" :subjectTypes ["team"]}
                 {:name "vpc" :subjectTypes ["vpc"]}]
     :permissions [{:name "admin" :expression "account->admin + shared_admin"}
                   {:name "view" :expression "admin + parent->view + account->view + team->view + vpc->view + shared_admin"}]}
    {:name "team"
     :relations [{:name "account" :subjectTypes ["account"]}
                 {:name "leader" :subjectTypes ["user"]}]
     :permissions [{:name "admin" :expression "account->admin + leader"}
                   {:name "view" :expression "admin"}]}
    {:name "user" :relations [] :permissions []}
    {:name "vpc"
     :relations [{:name "account" :subjectTypes ["account"]}
                 {:name "shared_admin" :subjectTypes ["user"]}]
     :permissions [{:name "admin" :expression "account->admin + shared_admin"}
                   {:name "view" :expression "admin"}]}]})

(defn object [type id]
  {:type type :id id})

(defn object-record [role type id]
  {:kind :object :object (object type id) :role role})

(defn relationship-record
  [subject-type subject-id relation resource-type resource-id]
  {:kind :relationship
   :relation relation
   :resource (object resource-type resource-id)
   :subject (object subject-type subject-id)})

(defn- platform-bundle []
  {:resource (object "platform" "platform")
   :records [(object-record :resource "platform" "platform")
             (object-record :subject "user" "super-user")
             (object-record :subject "user" "user-1")
             (object-record :subject "user" "user-2")
             (relationship-record "user" "super-user" "super_admin" "platform" "platform")]})

(defn- account-bundle [account]
  (let [account-id (golden/account-id account)
        owner-id (golden/owner-id account)]
    {:resource (object "account" account-id)
     :records
     (cond-> [(object-record :subject "user" owner-id)
              (object-record :resource "account" account-id)
              (relationship-record "platform" "platform" "platform" "account" account-id)
              (relationship-record "user" owner-id "owner" "account" account-id)]
       (and (pos? account) (not (zero? (mod account 4))))
       (conj (relationship-record "account" (golden/account-id (dec account)) "parent" "account" account-id))

       (= account 1)
       (conj (relationship-record "account" "account-1" "parent" "account" "account-0"))

       (= account 0)
       (conj (relationship-record "user" "user-1" "owner" "account" account-id))

       (= account 4)
       (conj (relationship-record "user" "user-2" "owner" "account" account-id)))}))

(defn- team-bundle [account team]
  (let [account-id (golden/account-id account)
        team-id (golden/team-id account team)]
    {:resource (object "team" team-id)
     :records [(object-record :subject "user" (golden/leader-id account team))
               (object-record :resource "team" team-id)
               (relationship-record "account" account-id "account" "team" team-id)
               (relationship-record "user" (golden/leader-id account team) "leader" "team" team-id)]}))

(defn- vpc-bundle [account vpc]
  (let [account-id (golden/account-id account)
        vpc-id (golden/vpc-id account vpc)]
    {:resource (object "vpc" vpc-id)
     :records [(object-record :subject "user" (golden/vpc-admin-id account vpc))
               (object-record :resource "vpc" vpc-id)
               (relationship-record "account" account-id "account" "vpc" vpc-id)
               (relationship-record "user" (golden/vpc-admin-id account vpc) "shared_admin" "vpc" vpc-id)]}))

(defn- server-bundle [account server]
  (let [account-id (golden/account-id account)
        server-id (golden/server-id account server)]
    {:resource (object "server" server-id)
     :records
     (cond-> [(object-record :resource "server" server-id)
              (relationship-record "account" account-id "account" "server" server-id)
              (relationship-record "team" (golden/team-id account (mod server 4)) "team" "server" server-id)
              (relationship-record "vpc" (golden/vpc-id account (mod server 2)) "vpc" "server" server-id)]
       (and (pos? server) (not (zero? (mod server 8))))
       (conj (relationship-record "server" (golden/server-id account (dec server)) "parent" "server" server-id)))}))

(defn- bundles-for-account [account]
  (concat [(account-bundle account)]
          (map #(team-bundle account %) (range 4))
          (map #(vpc-bundle account %) (range 2))
          (map #(server-bundle account %)
               (range (golden/account-server-count account)))))

(defn fixture-bundles
  "Returns a lazy, deterministic sequence ending at an exact resource cut point."
  [resource-count]
  (when-not (and (integer? resource-count) (pos? resource-count))
    (throw (ex-info "resource-count must be a positive integer" {:resource-count resource-count})))
  (letfn [(accounts [account emitted]
            (lazy-seq
             (when (< emitted resource-count)
               (let [available (- resource-count emitted)
                     account-size (+ 7 (golden/account-server-count account))
                     used (min available account-size)]
                 (concat (take used (bundles-for-account account))
                         (accounts (inc account) (+ emitted used)))))))]
    (cons (platform-bundle) (accounts 0 1))))

(defn small-fixture-bundles []
  (fixture-bundles small-resource-count))
