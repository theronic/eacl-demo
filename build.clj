(ns build
  (:require [clojure.tools.build.api :as b]))

(def datomic-class-dir "target/datomic-dynamodb-lambda/classes")
(def datomic-uber-file "dist/datomic-dynamodb/function.jar")
(def datomic-generated-classes-dir
  "target/eacl-core-source/9e0105f2dfe9db9f87057c3791abddd9ba511c5e/target/formal/java/classes")
(def datomic-source-dirs
  ["packages/contracts/src"
   "services/datomic-dynamodb/src"])
(def datomic-java-dirs ["services/datomic-dynamodb/java"])
(def datomic-seed-class-dir "target/datomic-dynamodb-seed/classes")
(def datomic-seed-uber-file "dist/datomic-dynamodb-seed/seed.jar")
(def datomic-seed-source-dirs ["maintenance/datomic-dynamodb/src"])
(def datahike-s3-class-dir "target/datahike-s3-lambda/classes")
(def datahike-s3-uber-file "dist/datahike-s3/function.jar")
(def datahike-s3-source-dirs ["services/datahike-s3/src"])
(def datahike-contract-files
  [["packages/contracts/src/eacl_demo/contracts/function_url.clj"
    "eacl_demo/contracts/function_url.clj"]
   ["packages/contracts/src/eacl_demo/contracts/http.clj"
    "eacl_demo/contracts/http.clj"]
   ["packages/contracts/src/eacl_demo/contracts/observability.clj"
    "eacl_demo/contracts/observability.clj"]])
(def datahike-s3-java-dirs ["services/datahike-s3/java"])
(def contract-source-dir "packages/contracts/src")
(def datahike-dynamodb-class-dir
  "target/datahike-dynamodb-lambda/classes")
(def datahike-dynamodb-uber-file
  "dist/datahike-dynamodb/function.jar")
(def datahike-dynamodb-source-dirs
  ["services/datahike-dynamodb/src"])
(def datahike-dynamodb-java-dirs
  ["services/datahike-dynamodb/java"])
(def datahike-seed-class-dir "target/datahike-dynamodb-seed/classes")
(def datahike-seed-uber-file "dist/datahike-dynamodb-seed/seed.jar")
(def datahike-seed-source-dirs
  ["maintenance/datahike-dynamodb/src"
   "services/datahike-dynamodb/src"
   "packages/contracts/src"])
(def datalevin-memory-class-dir
  "target/datalevin-memory-lambda/classes")
(def datalevin-memory-work-dir
  "target/datalevin-memory-build")
(def datalevin-memory-fixture
  (str datalevin-memory-work-dir "/fixture-10000.ndjson"))
(def datalevin-memory-native-jar
  "dist/datalevin-native-al2023/dtlvnative-linux-arm64-0.18.8-eacl.al2023.1.jar")
(def datalevin-memory-uber-file
  "dist/datalevin-memory/function.jar")
(def datalevin-memory-source-dirs
  ["services/datalevin-memory/src"])
(def datalevin-memory-java-dirs
  ["services/datalevin-memory/java"])
(def datahike-jvm-exclusions
  ["(?i)^META-INF/(?:[^/]+\\.(?:SF|RSA|DSA)|INDEX\\.LIST)$"
   "^cljs(?:/.*)?$"
   "^cljsjs(?:/.*)?$"
   "^goog(?:/.*)?$"
   "^com/google/javascript(?:/.*)?$"
   "^META-INF/maven/(?:org\\.clojure/clojurescript|com\\.google\\.javascript|org\\.clojure/google-closure-library)(?:/.*)?$"
   "^test(?:/.*)?$"
   ".*\\.(?:cljs|js|mjs|html)$"])

(defn- generate-build-identity!
  [class-dir]
  (let [{:keys [exit]}
        (b/process {:command-args ["node"
                                   "scripts/generate-jvm-build-identity.mjs"
                                   class-dir]})]
    (when-not (zero? exit)
      (throw (ex-info "JVM build identity generation failed."
                      {:class-dir class-dir :exit exit})))))

(defn- compile-service!
  [basis class-dir source-dirs]
  ;; Lambda cold starts must not spend tens of seconds compiling application
  ;; namespaces from source. Compile only this workspace's closed service and
  ;; transport namespaces; dependency JARs remain untouched. Clojure AOT emits
  ;; captured locals from identity-keyed maps, whose default HotSpot identity
  ;; hashes make otherwise identical clean builds bytewise unstable. The pinned
  ;; Temurin build VM's constant identity-hash mode gives those maps a stable
  ;; insertion order; it affects the compiler process only, not deployed code.
  (b/compile-clj
   {:basis basis
    :src-dirs (vec (distinct (conj source-dirs contract-source-dir)))
    :class-dir class-dir
    :sort :topo
    :java-opts ["-XX:+UnlockExperimentalVMOptions" "-XX:hashCode=2"]}))

(defn datahike-s3-lambda
  [_]
  (let [{:keys [exit]}
        (b/process {:command-args ["node" "scripts/prepare-eacl-core.mjs"]})]
    (when-not (zero? exit)
      (throw (ex-info "Pinned EACL Core preparation failed."
                      {:exit exit}))))
  (let [basis (b/create-basis
               {:project "deps.edn"
                :aliases [:datahike-s3 :lambda-jvm]})]
    (b/delete {:path datahike-s3-class-dir})
    (b/delete {:path datahike-s3-uber-file})
    (generate-build-identity! datahike-s3-class-dir)
    (b/copy-dir {:src-dirs (conj datahike-s3-source-dirs
                                  datomic-generated-classes-dir)
                 :target-dir datahike-s3-class-dir})
    (doseq [[src target] datahike-contract-files]
      (b/copy-file {:src src
                    :target (str datahike-s3-class-dir "/" target)}))
    (b/copy-file {:src "fixtures/schema-wire.v1.json"
                  :target (str datahike-s3-class-dir
                               "/schema-wire.v1.json")})
    (compile-service! basis datahike-s3-class-dir datahike-s3-source-dirs)
    (b/javac
     {:basis basis
      :src-dirs datahike-s3-java-dirs
      :class-dir datahike-s3-class-dir
      :javac-opts ["--release" "17" "-Xlint:all" "-Werror"]})
    (b/uber
     {:class-dir datahike-s3-class-dir
      :uber-file datahike-s3-uber-file
      :basis basis
      :exclude datahike-jvm-exclusions})
    (let [{:keys [exit]}
          (b/process {:command-args ["python3" "scripts/normalize-zip.py"
                                     datahike-s3-uber-file]})]
      (when-not (zero? exit)
        (throw (ex-info "Deterministic Datahike/S3 JAR normalization failed."
                        {:exit exit}))))
    (println datahike-s3-uber-file)))

(defn datahike-dynamodb-lambda
  [_]
  (let [{:keys [exit]}
        (b/process {:command-args ["node" "scripts/prepare-eacl-core.mjs"]})]
    (when-not (zero? exit)
      (throw (ex-info "Pinned EACL Core preparation failed."
                      {:exit exit}))))
  (let [basis (b/create-basis
               {:project "deps.edn"
                :aliases [:datahike-dynamodb :lambda-jvm]})]
    (b/delete {:path datahike-dynamodb-class-dir})
    (b/delete {:path datahike-dynamodb-uber-file})
    (generate-build-identity! datahike-dynamodb-class-dir)
    (b/copy-dir {:src-dirs (conj datahike-dynamodb-source-dirs
                                  datomic-generated-classes-dir)
                 :target-dir datahike-dynamodb-class-dir})
    (doseq [[src target] datahike-contract-files]
      (b/copy-file {:src src
                    :target (str datahike-dynamodb-class-dir "/" target)}))
    (b/copy-file {:src "fixtures/schema-wire.v1.json"
                  :target (str datahike-dynamodb-class-dir
                               "/schema-wire.v1.json")})
    (compile-service! basis datahike-dynamodb-class-dir
                      datahike-dynamodb-source-dirs)
    (b/javac
     {:basis basis
      :src-dirs datahike-dynamodb-java-dirs
      :class-dir datahike-dynamodb-class-dir
      :javac-opts ["--release" "17" "-Xlint:all" "-Werror"]})
    (b/uber
     {:class-dir datahike-dynamodb-class-dir
      :uber-file datahike-dynamodb-uber-file
      :basis basis
      :exclude datahike-jvm-exclusions})
    (let [{:keys [exit]}
          (b/process {:command-args ["python3" "scripts/normalize-zip.py"
                                     datahike-dynamodb-uber-file]})]
      (when-not (zero? exit)
        (throw (ex-info
                "Deterministic Datahike/DynamoDB JAR normalization failed."
                {:exit exit}))))
    (println datahike-dynamodb-uber-file)))

(defn datahike-dynamodb-seed
  [_]
  (let [{:keys [exit]}
        (b/process {:command-args ["node" "scripts/prepare-eacl-core.mjs"]})]
    (when-not (zero? exit)
      (throw (ex-info "Pinned EACL Core preparation failed."
                      {:exit exit}))))
  (let [basis (b/create-basis
               {:project "deps.edn"
                :aliases [:datahike-dynamodb-maintenance]})]
    (b/delete {:path datahike-seed-class-dir})
    (b/delete {:path datahike-seed-uber-file})
    (b/copy-dir {:src-dirs (conj datahike-seed-source-dirs
                                  datomic-generated-classes-dir)
                 :target-dir datahike-seed-class-dir})
    (doseq [[src target]
            [["fixtures/schema.v1.zed" "schema.v1.zed"]
             ["fixtures/manifests/fixture-10000.v1.json"
              "manifests/fixture-10000.v1.json"]
             ["fixtures/manifests/fixture-1000000.v1.json"
              "manifests/fixture-1000000.v1.json"]
             ["infra/data/datahike-demo-metadata-schema.edn"
              "datahike-demo-metadata-schema.edn"]
             ["maintenance/datahike-dynamodb/run-seed-on-ec2.sh"
              "seed-runner.sh"]]]
      (b/copy-file {:src src
                    :target (str datahike-seed-class-dir "/" target)}))
    (b/uber
     {:class-dir datahike-seed-class-dir
      :uber-file datahike-seed-uber-file
      :basis basis
      :exclude datahike-jvm-exclusions})
    (let [{:keys [exit]}
          (b/process {:command-args ["python3" "scripts/normalize-zip.py"
                                     datahike-seed-uber-file]})]
      (when-not (zero? exit)
        (throw (ex-info
                "Deterministic Datahike/DynamoDB seed JAR normalization failed."
                {:exit exit}))))
    (println datahike-seed-uber-file)))

(defn datomic-lambda
  [_]
  (let [{:keys [exit]}
        (b/process {:command-args ["node" "scripts/prepare-eacl-core.mjs"]})]
    (when-not (zero? exit)
      (throw (ex-info "Pinned EACL Core preparation failed."
                      {:exit exit}))))
  (let [basis (b/create-basis
               {:project "deps.edn"
                :aliases [:datomic-dynamodb :datomic-http-server
                          :lambda-jvm]})]
    (b/delete {:path datomic-class-dir})
    (b/delete {:path datomic-uber-file})
    (generate-build-identity! datomic-class-dir)
    (b/copy-dir {:src-dirs (conj datomic-source-dirs
                                  datomic-generated-classes-dir)
                 :target-dir datomic-class-dir})
    (b/copy-file {:src "fixtures/schema-wire.v1.json"
                  :target (str datomic-class-dir "/schema-wire.v1.json")})
    (compile-service! basis datomic-class-dir datomic-source-dirs)
    (b/javac
     {:basis basis
      :src-dirs datomic-java-dirs
      :class-dir datomic-class-dir
      :javac-opts ["--release" "17" "-Xlint:all" "-Werror"]})
    (b/uber {:class-dir datomic-class-dir
             :uber-file datomic-uber-file
             :basis basis
             :exclude [#"(?i)^META-INF/(?:[^/]+\.(?:SF|RSA|DSA)|INDEX\.LIST)$"
                       #"^datomic/transactor-(?:key|trust)\.jks$"]})
    (let [{:keys [exit]}
          (b/process {:command-args ["python3" "scripts/normalize-zip.py"
                                     datomic-uber-file]})]
      (when-not (zero? exit)
        (throw (ex-info "Deterministic JAR normalization failed."
                        {:exit exit}))))
    (println datomic-uber-file)))

(defn datomic-seed
  [_]
  (let [{:keys [exit]}
        (b/process {:command-args ["node" "scripts/prepare-eacl-core.mjs"]})]
    (when-not (zero? exit)
      (throw (ex-info "Pinned EACL Core preparation failed."
                      {:exit exit}))))
  (let [basis (b/create-basis
               {:project "deps.edn"
                :aliases [:datomic-dynamodb :lambda-jvm
                          :datomic-maintenance]})]
    (b/delete {:path datomic-seed-class-dir})
    (b/delete {:path datomic-seed-uber-file})
    (b/copy-dir {:src-dirs (conj datomic-seed-source-dirs
                                  datomic-generated-classes-dir)
                 :target-dir datomic-seed-class-dir})
    (doseq [[src target]
            [["fixtures/schema.v1.zed"
              "schema.v1.zed"]
             ["fixtures/manifests/fixture-10000.v1.json"
              "manifests/fixture-10000.v1.json"]
             ["fixtures/manifests/fixture-1000000.v1.json"
              "manifests/fixture-1000000.v1.json"]
             ["infra/data/datomic-demo-metadata-schema.edn"
              "datomic-demo-metadata-schema.edn"]
             ["maintenance/datomic-dynamodb/run-seed-on-ec2.sh"
              "seed-runner.sh"]]]
      (b/copy-file {:src src
                    :target (str datomic-seed-class-dir "/" target)}))
    (b/uber {:class-dir datomic-seed-class-dir
             :uber-file datomic-seed-uber-file
             :basis basis
             :exclude [#"(?i)^META-INF/(?:[^/]+\.(?:SF|RSA|DSA)|INDEX\.LIST)$"
                       #"^datomic/transactor-(?:key|trust)\.jks$"]})
    (let [{:keys [exit]}
          (b/process {:command-args ["python3" "scripts/normalize-zip.py"
                                     datomic-seed-uber-file]})]
      (when-not (zero? exit)
        (throw (ex-info "Deterministic seed JAR normalization failed."
                        {:exit exit}))))
    (println datomic-seed-uber-file)))

(defn datalevin-memory-lambda
  [_]
  (b/delete {:path datalevin-memory-work-dir})
  (b/delete {:path datalevin-memory-class-dir})
  (b/delete {:path datalevin-memory-uber-file})
  (generate-build-identity! datalevin-memory-class-dir)
  (doseq [command [["node" "scripts/prepare-eacl-core.mjs"]
                   ["clojure" "-X:deps" "prep" ":aliases"
                    "[:datalevin-memory :lambda-jvm]"]
                   ["node" "scripts/qualify-datalevin-native-arm64.mjs"
                    "--artifact" datalevin-memory-native-jar]
                   ["node" "scripts/generate-fixture.mjs"
                    "--cut-point" "10000"
                    "--output" datalevin-memory-fixture]]]
    (let [{:keys [exit]} (b/process {:command-args command})]
      (when-not (zero? exit)
        (throw (ex-info "Datalevin Lambda prerequisite failed."
                        {:command command :exit exit})))))
  (let [basis (b/create-basis
               {:project "deps.edn"
                :aliases [:datalevin-memory :lambda-jvm]})]
    (b/copy-dir
     {:src-dirs (conj datalevin-memory-source-dirs
                      datomic-generated-classes-dir)
      :target-dir datalevin-memory-class-dir})
    (doseq [[src target]
            (concat datahike-contract-files
                    [["fixtures/schema-wire.v1.json" "schema-wire.v1.json"]
                     ["fixtures/schema.v1.zed" "schema.v1.zed"]
                     [datalevin-memory-fixture "fixture-10000.ndjson"]])]
      (b/copy-file {:src src
                    :target (str datalevin-memory-class-dir "/" target)}))
    (compile-service! basis datalevin-memory-class-dir
                      datalevin-memory-source-dirs)
    (b/javac
     {:basis basis
      :src-dirs datalevin-memory-java-dirs
      :class-dir datalevin-memory-class-dir
      :javac-opts ["--release" "17" "-Xlint:all" "-Werror"]})
    (b/uber
     {:class-dir datalevin-memory-class-dir
      :uber-file datalevin-memory-uber-file
      :basis basis
      :exclude
      [#"(?i)^META-INF/(?:[^/]+\.(?:SF|RSA|DSA)|INDEX\.LIST)$"
       #"^datalevin/dtlvnative/(?:macosx-arm64|windows-x86_64)(?:/.*)?$"]})
    (let [{:keys [exit]}
          (b/process {:command-args ["python3" "scripts/normalize-zip.py"
                                     datalevin-memory-uber-file]})]
      (when-not (zero? exit)
        (throw (ex-info "Deterministic Datalevin JAR normalization failed."
                        {:exit exit}))))
    (println datalevin-memory-uber-file)))
