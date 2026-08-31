import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const archive = path.join(root, "dist/datahike-dynamodb/function.jar");
const bytes = await readFile(archive);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const entries = output("unzip", ["-Z1", archive]).split("\n").filter(Boolean);
const entrySet = new Set(entries);
const dependencyTree = output("clojure", [
  "-A:datahike-dynamodb:lambda-jvm", "-Stree",
]);
const classpath = output("clojure", [
  "-A:datahike-dynamodb:lambda-jvm", "-Spath",
]).split(path.delimiter);
const deps = await readFile(path.join(root, "deps.edn"), "utf8");

assert.match(dependencyTree, /^org\.replikativ\/datahike \S+$/mu);
assert.match(dependencyTree, /^org\.replikativ\/konserve \S+$/mu);
assert.match(dependencyTree,
  /^software\.amazon\.awssdk\/dynamodb \S+$/mu);
assert.match(dependencyTree,
  /^software\.amazon\.awssdk\/url-connection-client \S+$/mu);
assert.match(dependencyTree,
  /^com\.amazonaws\/aws-lambda-java-core \S+$/mu);
assert.match(dependencyTree, /^org\.clojure\/data\.json \S+$/mu);
assert.doesNotMatch(dependencyTree, /^org\.replikativ\/konserve-dynamodb /mu);
assert.match(deps,
  /org\.replikativ\/datahike[\s\S]*?:exclusions \[org\.clojure\/clojurescript\]/u);
assert.match(deps,
  /org\.replikativ\/konserve[\s\S]*?:exclusions \[org\.clojure\/clojurescript\]/u);
assert.equal(classpath.some((entry) =>
  /\/org\/clojure\/clojurescript\/|\/com\/google\/javascript\/closure-compiler\/|\/org\/clojure\/google-closure-library\//u.test(entry)),
false, "ClojureScript or Closure compiler dependency entered the Lambda classpath");
assert.equal(classpath.some((entry) => entry.includes("/konserve-dynamodb/")),
  false, "the rejected upstream DynamoDB adapter entered the Lambda classpath");
for (const excluded of ["netty-nio-client", "apache-client", "apache5-client"]) {
  assert.equal(classpath.some((entry) =>
    entry.includes(`/software/amazon/awssdk/${excluded}/`)), false,
  `${excluded} entered the AWS SDK v2 serving classpath`);
}

assert.equal(entries.length, entrySet.size, "duplicate JAR entries are forbidden");
for (const required of [
  "eacl_demo/contracts/function_url.clj",
  "eacl_demo/contracts/http.clj",
  "eacl_demo/contracts/observability.clj",
  "eacl_demo/datahike_dynamodb/LambdaHandler.class",
  "schema-wire.v1.json",
  "EaclKernel/__default.class",
  "PageWindow/__default.class",
]) assert.ok(entrySet.has(required), `required JAR entry missing: ${required}`);

const serviceEntries = [
  "adapter", "boundary", "client", "context", "errors", "konserve",
  "lambda_handler", "operations", "profile", "read_only_writer", "reader",
  "retry",
].map((name) => `eacl_demo/datahike_dynamodb/${name}.clj`).sort();
assert.deepEqual(entries
  .filter((entry) => /^eacl_demo\/datahike_dynamodb\/.*\.clj$/u.test(entry))
  .sort(), serviceEntries);
for (const forbidden of [
  "build.clj",
  "infra/data/datomic-demo-metadata-schema.edn",
  "fixtures/schema.v1.zed",
  "schema.v1.zed",
]) assert.equal(entrySet.has(forbidden), false,
  `maintenance/runtime-irrelevant entry leaked: ${forbidden}`);
assert.equal(entries.some((entry) =>
  /^test\/|^eacl_demo\/datahike_dynamodb\/.*(?:_test|\/seed|\/admin|\/benchmark).*|^maintenance\/|^bin\//iu.test(entry)),
false, "a project test or maintenance entry leaked into the JAR");
assert.equal(entries.some((entry) =>
  /^(?:cljs|cljsjs|goog)(?:\/|$)|^com\/google\/javascript(?:\/|$)|\.(?:cljs|js|mjs|html)$|^META-INF\/maven\/(?:org\.clojure\/clojurescript|com\.google\.javascript\/|org\.clojure\/google-closure-library)/u.test(entry)),
false, "ClojureScript, Closure compiler, or browser/test asset leaked into the JAR");

const source = (entry) => output("unzip", ["-p", archive, entry]);
const observabilitySource = source("eacl_demo/contracts/observability.clj");
const sources = Object.fromEntries(serviceEntries.map((entry) => [
  path.basename(entry, ".clj"), source(entry),
]));
const servingSources = Object.values(sources).join("\n");
assert.match(observabilitySource, /EaclDemo\/Runtime/u);
for (const metric of ["Requests", "Errors", "Duration", "Initialization",
  "Restore", "Throttles", "Timeouts", "OOM", "Storage"]) {
  assert.match(observabilitySource, new RegExp(`\\{"Name" "${metric}"`, "u"));
}
assert.doesNotMatch(observabilitySource,
  /stack-trace|\.getMessage|Throwable->map|AWS_SECRET/iu);
assert.match(sources.reader, /:read-only\? true/u);
assert.match(sources.reader, /:writer read-only-writer\/config/u);
assert.match(sources.reader, /:security-key \(:security-key config\)/u);
assert.match(sources.lambda_handler, /\(not= 1 concurrency\)/u);
assert.match(sources.read_only_writer,
  /defmethod writer\/create-database[\s\S]*?denied!/u);
assert.match(sources.read_only_writer,
  /defmethod writer\/delete-database[\s\S]*?denied!/u);
for (const denied of [
  "write-header", "write-meta", "write-value", "write-binary", "delete-blob",
  "migrate", "copy", "atomic-move", "delete-store",
  "enumerate-store-keys", "migrate-foreign-key",
]) assert.match(sources.konserve, new RegExp(`denied! :${denied}`, "u"));
assert.match(sources.konserve, /:lock-blob\? true/u);
assert.match(sources.konserve,
  /\(-create-store \[_ env\][\s\S]*?:eacl-demo\/missing-dynamodb-store/u);
assert.match(sources.adapter, /\.consistentRead true/u);
assert.match(sources.adapter, /BatchGetItemRequest/u);
assert.match(sources.client, /allowed-signatures/u);
assert.match(sources.client, /\(denied! method\)/u);
for (const method of ["getItem", "batchGetItem", "describeTable", "close",
  "serviceName"]) assert.match(sources.client, new RegExp(`"${method}"`, "u"));
assert.match(sources.errors, /defn classify/u);
assert.match(sources.retry, /full-jitter-delay-ms/u);
assert.match(sources.retry, /\(<= 1 \(:max-attempts value\) 8\)/u);
assert.match(sources.operations,
  /:keys \[descriptor cursor-key clock refresh-snapshot! cache-stats\s+operation-metrics\]/u);
assert.match(sources.operations,
  /cache-metrics\/snapshot \(cache-stats\) operation-metrics/u);
assert.match(sources.lambda_handler, /datahike-eacl\/cache-stats/u);
assert.match(sources.lambda_handler, /cache-metrics\/record-response!/u);
assert.match(sources.operations, /\(:basis \(refresh-snapshot!\)\)/u);
assert.match(sources.reader, /active \(atom \(create-snapshot\)\)/u);
assert.match(sources.reader, /\(assoc current :release! \(fn \[\]\)\)/u);
assert.match(sources.reader, /:refresh-snapshot! refresh/u);
assert.match(sources.reader, /:release-snapshot! release-active/u);
assert.match(sources.profile, /:snapStart "enabled"/u);
assert.doesNotMatch(sources.profile, /"no-snapstart"/u);
assert.match(sources.lambda_handler, /defn initialize-runtime!/u);
assert.doesNotMatch(servingSources,
  /\bd\/transact\b|eacl\/(?:write-schema!|write-relationships!|delete-object!)|datahike-eacl\/(?:expire-cache!|prepare-cache-coherence!)|PutItemRequest|DeleteItemRequest|CreateTableRequest|UpdateTableRequest|TransactWriteItemsRequest|BatchWriteItemRequest/u,
  "a write or administration call is reachable from the packaged service source");
for (const route of ["seed", "setup", "benchmark", "transact", "write-schema",
  "cache-evict", "delete-store", "admin"]) {
  assert.doesNotMatch(sources.boundary, new RegExp(`"${route}"`, "u"));
}

const bytecode = output("javap", ["-classpath", archive, "-c",
  "eacl_demo.datahike_dynamodb.LambdaHandler"]);
assert.match(bytecode,
  /implements com\.amazonaws\.services\.lambda\.runtime\.RequestStreamHandler/u);
assert.match(bytecode,
  /handleRequest\(java\.io\.InputStream, java\.io\.OutputStream, com\.amazonaws\.services\.lambda\.runtime\.Context\)/u);
assert.match(bytecode, /eacl-demo\.datahike-dynamodb\.lambda-handler/u);
assert.match(bytecode, /handle-request-stream/u);
assert.doesNotMatch(bytecode, /transact|seed|create_database|delete_database/iu);
const kernelBytecode = output("javap", ["-classpath", archive, "-verbose",
  "EaclKernel.__default"]);
assert.match(kernelBytecode, /^\s*major version: 69$/mu,
  "generated EACL kernel must be loadable by the pinned Java 25 Lambda runtime");

const manifest = source("META-INF/MANIFEST.MF");
assert.doesNotMatch(manifest, /^Build-Jdk-Spec:/mu,
  "host JDK metadata makes the JAR environment-dependent");
assert.match(manifest, /^Multi-Release: true$/mu);
assert.ok(bytes.length < 50 * 1024 * 1024,
  "compressed JAR exceeds Lambda's direct-upload package limit");
const uncompressedBytes = Number(/\n\s*(\d+)\s+\d+\s+files?\s*$/u.exec(
  output("unzip", ["-l", archive]))?.[1]);
assert.ok(Number.isSafeInteger(uncompressedBytes) && uncompressedBytes > 0);
assert.ok(uncompressedBytes < 250 * 1024 * 1024,
  "uncompressed JAR exceeds Lambda's package limit");

const loadSmoke = output("java", ["-cp", archive, "clojure.main", "-e",
  "(try (Class/forName \"eacl_demo.datahike_dynamodb.LambdaHandler\" false (.getContextClassLoader (Thread/currentThread))) (Class/forName \"EaclKernel.__default\") (println :loaded) (catch Throwable t (.printStackTrace t) (System/exit 1)))"]);
assert.equal(loadSmoke, ":loaded");

const aotLoaderSmoke = output("java", ["-cp", archive, "clojure.main", "-e",
  "(require 'clojure.pprint) (clojure.pprint/pprint {:aot-loader :pass})"]);
assert.equal(aotLoaderSmoke, "{:aot-loader :pass}");

const packagedDatahikeSmoke = output("java", [
  "-cp", archive, "clojure.main", "-e", String.raw`
(do
  (require '[datahike.api :as d])
  (let [config {:store {:backend :memory :id (random-uuid)}
                :schema-flexibility :read
                :max-string-length 0}]
    (d/create-database config)
    (let [connection (d/connect config)]
      (try
        (d/transact connection [{:demo/value "packaged"}])
        (assert (= #{["packaged"]}
                   (d/q '[:find ?value :where [_ :demo/value ?value]]
                        (d/db connection))))
        (println :packaged-datahike-pass)
        (finally
          (d/release connection)
          (d/delete-database config))))))`,
]);
assert.equal(packagedDatahikeSmoke, ":packaged-datahike-pass");

const closedRuntimeSmoke = output("java", [
  "-cp", archive, "clojure.main", "-e", String.raw`
(do
  (require '[clojure.data.json :as json]
           '[eacl-demo.datahike-dynamodb.lambda-handler :as handler])
  (let [captures (atom 0)
        releases (atom 0)
        environment {"AWS_REGION" "us-east-1"
                     "EACL_DATAHIKE_TABLE" "eacl-demo-datahike-artifact-smoke"
                     "EACL_DATAHIKE_STORE_ID" "4e67bb31-557d-4f49-8b4c-699d39577310"
                     "EACL_STORE_CACHE_SIZE" "1000"
                     "EACL_SEARCH_CACHE_SIZE" "0"
                     "EACL_MAXIMUM_CONCURRENCY" "1"
                     "EACL_MAX_ATTEMPTS" "4"
                     "EACL_BASE_DELAY_MS" "25"
                     "EACL_MAX_DELAY_MS" "250"
                     "EACL_ATTEMPT_TIMEOUT_MS" "3000"
                     "EACL_CONNECT_TIMEOUT_MS" "1000"
                     "EACL_CURSOR_KEY" (apply str (repeat 32 "k"))
                     "EACL_DEMO_SHA" (apply str (repeat 40 "a"))
                     "EACL_CORE_SHA" "e9e9c616350da43cd2c731385eea856ce6c58075"
                     "EACL_ARTIFACT_SHA256" (apply str (repeat 64 "b"))
                     "EACL_DEPLOYMENT_ID" "artifact-smoke"
                     "AWS_LAMBDA_FUNCTION_MEMORY_SIZE" "1024"}
        next-snapshot
        (fn []
          (let [revision (swap! captures inc)
                basis {:behavior "request-snapshot"
                       :id (str "datahike-dynamodb:artifact:" revision)
                       :capturedAt "2026-08-26T00:00:00Z"
                       :fixedForEnvironment false}]
            {:value :immutable
             :basis basis
             :release! #(swap! releases inc)}))
        runtime (handler/initialize
                 environment
                 (fn [_] {:capture-snapshot next-snapshot
                          :connection :fake
                          :release-connection (fn [_])}))
        event (fn [operation method body]
                {:version "2.0"
                 :routeKey "$default"
                 :rawPath (str "/" operation)
                 :rawQueryString ""
                 :headers (if body {"content-type" "application/json"} {})
                 :requestContext {:requestId "artifact-smoke"
                                  :http {:method method}}
                 :isBase64Encoded false
                 :body body
                 :cookies nil})
        denied (mapv #(handler/handle-event runtime (event % "POST" "{}") 10000)
                     ["seed" "setup" "benchmark" "transact" "write-schema"
                      "cache-evict" "delete-store" "admin"])
        _ (assert (every? #(= 404 (:statusCode %)) denied))
        _ (assert (= 1 @captures))
        bootstrap (handler/handle-event runtime (event "bootstrap" "GET" nil) 10000)
        bootstrap-body (json/read-str (:body bootstrap) :key-fn keyword)
        health (handler/handle-event runtime (event "health" "GET" nil) 10000)
        health-body (json/read-str (:body health) :key-fn keyword)]
    (assert (= 200 (:statusCode bootstrap)))
    (assert (= #{:data :meta} (set (keys bootstrap-body))))
    (assert (= #{:revision :requestId :elapsedMs}
               (set (keys (:meta bootstrap-body)))))
    (assert (= "datahike-dynamodb:artifact:2"
               (get-in bootstrap-body [:meta :revision])))
    (assert (= "datahike-dynamodb:artifact:2"
               (get-in bootstrap-body [:data :basis :id])))
    (assert (= "enabled"
               (get-in bootstrap-body [:data :runtime :snapStart])))
    (assert (= 200 (:statusCode health)))
    (assert (= "datahike-dynamodb:artifact:3"
               (get-in health-body [:meta :revision])))
    (assert (= #{:revision :requestId :elapsedMs}
               (set (keys (:meta health-body)))))
    (assert (= 3 @captures))
    (assert (= 3 @releases))
    (println :datahike-dynamodb-packaged-runtime-pass)))`,
]);
assert.equal(closedRuntimeSmoke, ":datahike-dynamodb-packaged-runtime-pass");

console.log(`Datahike/DynamoDB Lambda artifact audit passed (sha256:${sha256}, ${bytes.length} compressed bytes, ${uncompressedBytes} uncompressed bytes)`);

function output(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}
