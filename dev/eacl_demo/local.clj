(ns eacl-demo.local
  "Local writable Caveat playground over Datomic dev and Datahike S3."
  (:require [clojure.data.json :as json]
            [clojure.java.io :as io]
            [datomic.api :as dt]
            [datahike.api :as dh]
            [konserve-s3.core]
            [eacl.core :as eacl]
            [eacl.caveats.jvm :as caveats]
            [eacl.relationships.storage :as relationship-storage]
            [eacl.datomic.core :as datomic]
            [eacl.datomic.schema :as datomic-schema]
            [eacl.datahike.core :as datahike]
            [nrepl.server :as nrepl]
            [org.httpkit.server :as http])
  (:import [java.util UUID]))

(def schema
  "caveat in_region(region string, accepted list<string>) {
     region in accepted
   }
   definition user {}
   definition doc {
     relation viewer: user | user with in_region
     relation banned: user
     permission view = viewer - banned
   }")

(defonce runtime (atom nil))

(defn- seed! [{:keys [client transact!]}]
  (eacl/write-schema! client schema)
  (transact! (mapv #(hash-map :eacl/id %) ["alice" "bob" "public" "regional" "temporary"]))
  (eacl/create-relationships!
   client
   [{:subject {:type :user :id "alice"} :relation :viewer
     :resource {:type :doc :id "public"}}
    {:subject {:type :user :id "alice"} :relation :viewer
     :resource {:type :doc :id "regional"}
     :caveat "in_region" :caveat-context {"accepted" ["za"]}}
    {:subject {:type :user :id "alice"} :relation :viewer
     :resource {:type :doc :id "temporary"}
     :valid-until-ms (+ (System/currentTimeMillis) 60000)}]))

(defn- open-datomic! []
  (let [uri "datomic:dev://localhost:14334/eacl-v8-playground"
        fresh? (dt/create-database uri)
        conn (dt/connect uri)
        _ (when fresh? (datomic-schema/install! conn))
        client (datomic/make-client conn {:caveat-evaluator (caveats/evaluator)})
        backend {:client client :conn conn :storage "Datomic :dev (14334)"
                 :schema-source #(:eacl/schema-string (dt/entity (dt/db conn) [:eacl/id "schema-string"]))
                 :transact! #(deref (dt/transact conn %))
                 :close! #(dt/release conn)}]
    (when fresh? (seed! backend))
    backend))

(defn- open-datahike! []
  (let [id-file (io/file "target/local-dev/store-id")
        _ (io/make-parents id-file)
        id (if (.exists id-file)
             (UUID/fromString (.trim (slurp id-file)))
             (let [id (UUID/randomUUID)] (spit id-file (str id)) id))
        config {:store {:backend :s3 :id id :bucket "eacl-v8-playground"
                        :region "us-east-1"
                        :endpoint-override {:protocol :http :hostname "127.0.0.1" :port 19400}
                        :path-style-access? true
                        :access-key (System/getenv "EACL_LOCAL_S3_ACCESS_KEY")
                        :secret (System/getenv "EACL_LOCAL_S3_SECRET_KEY")}
                :schema-flexibility :write :attribute-refs? true :keep-history? true}
        fresh? (not (dh/database-exists? config))
        conn (if fresh? (datahike/create-conn nil config) (dh/connect config))
        client (datahike/make-client conn {:caveat-evaluator (caveats/evaluator)})
        backend {:client client :conn conn :storage "Datahike S3 / MinIO (19400)"
                 :schema-source #(:eacl/schema-string (dh/entity (dh/db conn) [:eacl/id "schema-string"]))
                 :transact! #(dh/transact conn %) :close! #(dh/release conn)}]
    (when fresh? (seed! backend))
    backend))

(defn- object [value]
  {:type (keyword (get value "type")) :id (get value "id")})

(defn- relationship [body]
  (cond-> {:subject (object (get body "subject"))
           :resource (object (get body "resource"))
           :relation (keyword (get body "relation"))}
    (seq (get body "caveat")) (assoc :caveat (get body "caveat")
                                     :caveat-context (get body "caveatContext" {}))
    (get body "validUntilMs") (assoc :valid-until-ms (get body "validUntilMs"))))

(defn invoke! [backends body]
  (let [{:keys [client transact! storage schema-source]} (or (get backends (get body "backend"))
                                                             (throw (ex-info "Choose a backend." {})))
        request {:subject (object (get body "subject"))
                 :resource (object (get body "resource"))
                 :permission (keyword (get body "permission" "view"))
                 :caveat-context (get body "context" {})}
        query (cond-> (-> request (dissoc :resource)
                          (assoc :resource/type (get-in request [:resource :type])
                                 :result-policy :detailed :first 20))
                (get body "after") (assoc :after (get body "after")))
        result
        (case (get body "operation")
          "info" {:schema (schema-source) :storage storage :version relationship-storage/version}
          "check" (eacl/check-permission client request)
          "resources" (eacl/lookup-resources client query)
          "count" (eacl/count-resources client (dissoc query :first :after))
          "relationships" (eacl/read-relationships client {:resource/type :doc :first 100})
          "schema" (do (eacl/write-schema! client (get body "schema")) {:written true})
          "write" (let [rel (relationship body)]
                    (transact! [{:eacl/id (get-in rel [:subject :id])}
                                {:eacl/id (get-in rel [:resource :id])}])
                    (eacl/create-relationship! client rel)
                    {:created rel})
          "delete" (do (eacl/delete-relationship! client (relationship body)) {:deleted true})
          (throw (ex-info "Unknown operation." {})))]
    {:result result :serverTimeMs (System/currentTimeMillis)}))

(defn handler [backends request]
  (try
    (if (and (= :post (:request-method request)) (= "/api/local" (:uri request)))
      (if (re-find #"^application/json(?:;|$)" (get-in request [:headers "content-type"] ""))
        {:status 200 :headers {"content-type" "application/json"}
         :body (json/write-str (invoke! backends (json/read-str (slurp (:body request)))))}
        {:status 415 :body "Expected application/json"})
      {:status 404 :body "Not found"})
    (catch Exception error
      {:status 400 :headers {"content-type" "application/json"}
       :body (json/write-str {:error (.getMessage error)
                              :details (pr-str (ex-data error))})})))

(defn stop! []
  (when-let [{:keys [stop-server backends]} @runtime]
    (stop-server)
    (doseq [backend (vals backends)] ((:close! backend)))
    (reset! runtime nil)))

(defn start! []
  (or @runtime
      (let [dt (open-datomic!)]
        (try
          (let [backends {"datomic" dt "datahike" (open-datahike!)}
                stop-server (http/run-server (partial handler backends)
                                             {:ip "127.0.0.1" :port 8788 :max-body 65536})]
            (reset! runtime {:backends backends :stop-server stop-server})
            {:url "http://127.0.0.1:5176/caveats.html"})
          (catch Exception error ((:close! dt)) (throw error))))))

(defn -main [& _]
  (println (start!))
  (let [repl (nrepl/start-server :bind "127.0.0.1" :port 7821)]
    (.addShutdownHook (Runtime/getRuntime)
                      (Thread. #(do (stop!) (nrepl/stop-server repl))))))
