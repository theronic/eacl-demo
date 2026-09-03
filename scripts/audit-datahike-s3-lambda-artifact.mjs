import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const archive = path.join(root, "dist/datahike-s3/function.jar");
const bytes = await readFile(archive);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const entries = output("unzip", ["-Z1", archive]).split("\n").filter(Boolean);
const entrySet = new Set(entries);
const dependencyTree = output("clojure", ["-A:datahike-s3:lambda-jvm", "-Stree"]);
const classpath = output("clojure", ["-A:datahike-s3:lambda-jvm", "-Spath"])
  .split(path.delimiter);
const deps = await readFile(path.join(root, "deps.edn"), "utf8");

assert.match(dependencyTree, /^org\.replikativ\/datahike \S+$/mu);
assert.match(dependencyTree, /^org\.replikativ\/konserve-s3 \S+$/mu);
assert.match(dependencyTree, /^com\.amazonaws\/aws-lambda-java-core \S+$/mu);
assert.match(dependencyTree, /^org\.clojure\/data\.json \S+$/mu);
assert.match(dependencyTree, /^software\.amazon\.awssdk\/s3 \S+$/mu);
assert.match(dependencyTree,
  /^software\.amazon\.awssdk\/url-connection-client \S+$/mu);
assert.match(deps,
  /org\.replikativ\/datahike[\s\S]*?:exclusions \[org\.clojure\/clojurescript\]/u);
assert.match(deps,
  /org\.replikativ\/konserve-s3[\s\S]*?:exclusions \[org\.clojure\/clojurescript\]/u);
assert.equal(classpath.some((entry) =>
  /\/org\/clojure\/clojurescript\/|\/com\/google\/javascript\/closure-compiler\/|\/org\/clojure\/google-closure-library/u.test(entry)),
false, "ClojureScript or Closure compiler dependency entered the Lambda classpath");
assert.equal(classpath.some((entry) => /aws-xray|aws-java-sdk-xray/u.test(entry)),
  false, "unused optional X-Ray dependencies entered the Lambda classpath");
for (const excluded of ["netty-nio-client", "apache-client", "apache5-client"]) {
  assert.equal(classpath.some((entry) =>
    entry.includes(`/software/amazon/awssdk/${excluded}/`)), false,
  `${excluded} entered the AWS SDK v2 serving classpath`);
}

assert.equal(entries.length, entrySet.size, "duplicate JAR entries are forbidden");
for (const required of [
  "eacl_demo/contracts/observability.clj",
  "eacl_demo/datahike_s3/LambdaHandler.class",
  "eacl_demo/datahike_s3/boundary.clj",
  "eacl_demo/datahike_s3/client.clj",
  "eacl_demo/datahike_s3/konserve.clj",
  "eacl_demo/datahike_s3/lambda_handler.clj",
  "eacl_demo/datahike_s3/operations.clj",
  "eacl_demo/datahike_s3/profile.clj",
  "eacl_demo/datahike_s3/read_only_writer.clj",
  "eacl_demo/datahike_s3/reader.clj",
  "schema-wire.v1.json",
  "EaclKernel/__default.class",
  "PageWindow/__default.class",
]) assert.ok(entrySet.has(required), `required JAR entry missing: ${required}`);

assert.deepEqual(entries
  .filter((entry) => /^eacl_demo\/datahike_s3\/.*\.clj$/u.test(entry))
  .sort(), [
  "eacl_demo/datahike_s3/boundary.clj",
  "eacl_demo/datahike_s3/client.clj",
  "eacl_demo/datahike_s3/konserve.clj",
  "eacl_demo/datahike_s3/lambda_handler.clj",
  "eacl_demo/datahike_s3/operations.clj",
  "eacl_demo/datahike_s3/profile.clj",
  "eacl_demo/datahike_s3/read_only_writer.clj",
  "eacl_demo/datahike_s3/reader.clj",
]);
for (const forbidden of [
  "build.clj",
  "infra/data/datomic-demo-metadata-schema.edn",
  "fixtures/schema.v1.zed",
  "schema.v1.zed",
]) assert.equal(entrySet.has(forbidden), false,
  `maintenance/runtime-irrelevant entry leaked: ${forbidden}`);
assert.equal(entries.some((entry) =>
  /^test\/|^eacl_demo\/datahike_s3\/.*(?:_test|\/seed|\/admin|\/benchmark).*|^maintenance\/|^bin\//iu.test(entry)),
false, "a project test or maintenance entry leaked into the JAR");
assert.equal(entries.some((entry) =>
  /^(?:cljs|cljsjs|goog)(?:\/|$)|^com\/google\/javascript(?:\/|$)|\.(?:cljs|js|mjs|html)$|^META-INF\/maven\/(?:org\.clojure\/clojurescript|com\.google\.javascript\/|org\.clojure\/google-closure-library)/u.test(entry)),
false, "ClojureScript, Closure compiler, or browser/test asset leaked into the JAR");

const source = (entry) => output("unzip", ["-p", archive, entry]);
const observabilitySource = source("eacl_demo/contracts/observability.clj");
const boundarySource = source("eacl_demo/datahike_s3/boundary.clj");
const clientSource = source("eacl_demo/datahike_s3/client.clj");
const handlerSource = source("eacl_demo/datahike_s3/lambda_handler.clj");
const konserveSource = source("eacl_demo/datahike_s3/konserve.clj");
const operationsSource = source("eacl_demo/datahike_s3/operations.clj");
const profileSource = source("eacl_demo/datahike_s3/profile.clj");
const readerSource = source("eacl_demo/datahike_s3/reader.clj");
const writerSource = source("eacl_demo/datahike_s3/read_only_writer.clj");
const servingSources = [boundarySource, clientSource, handlerSource,
  konserveSource, operationsSource, profileSource, readerSource].join("\n");
assert.match(observabilitySource, /EaclDemo\/Runtime/u);
for (const metric of ["Requests", "Errors", "Duration", "Initialization",
  "Restore", "Throttles", "Timeouts", "OOM", "Storage"]) {
  assert.match(observabilitySource, new RegExp(`\\{"Name" "${metric}"`, "u"));
}
assert.doesNotMatch(observabilitySource,
  /stack-trace|\.getMessage|Throwable->map|AWS_SECRET/iu);
assert.match(readerSource, /:read-only\? true/u);
assert.match(readerSource, /:writer read-only-writer\/config/u);
assert.match(readerSource, /:backend read-only-store\/backend/u);
assert.doesNotMatch(readerSource, /:backend :s3/u,
  "the serving reader must not dispatch to upstream S3 connect-store");
assert.match(handlerSource, /\(not= 1 concurrency\)/u);
assert.match(clientSource, /allowed-signatures/u);
assert.match(clientSource, /\["getObject"/u);
assert.match(clientSource, /\["headObject"/u);
assert.doesNotMatch(clientSource,
  /\["(?:putObject|deleteObject|copyObject|createBucket|deleteBucket|listObjects)/u,
  "a write, administration, or enumeration method entered the SDK allowlist");
assert.match(konserveSource, /def backend :eacl-demo-s3-read-only-store/u);
assert.match(konserveSource,
  /\(-create-store \[_ env\][\s\S]*?:eacl-demo\/missing-s3-store/u);
assert.doesNotMatch(konserveSource,
  /\(when-not \(konserve\.impl\.storage-layout\/-store-exists\?/u,
  "the adapter must not duplicate Konserve's existing-store preflight");
assert.doesNotMatch(konserveSource,
  /s3\/(?:connect-store|put-object|put-object-conditional|create-bucket|delete|copy|list-objects)/u,
  "an upstream S3 mutator or enumerator is reachable from the custom backing");
assert.match(writerSource, /denied!/u);
assert.match(writerSource, /defmethod writer\/create-database[\s\S]*?denied!/u);
assert.match(writerSource, /defmethod writer\/delete-database[\s\S]*?denied!/u);
assert.match(operationsSource,
  /:keys \[descriptor cursor-key clock refresh-snapshot! cache-stats\s+operation-metrics\]/u);
assert.match(operationsSource,
  /cache-metrics\/snapshot \(cache-stats\) operation-metrics/u);
assert.match(handlerSource, /datahike-eacl\/cache-stats/u);
assert.match(handlerSource, /cache-metrics\/record-response!/u);
assert.match(operationsSource, /\(:basis \(refresh-snapshot!\)\)/u);
assert.match(readerSource, /active \(atom \(create-snapshot\)\)/u);
assert.match(readerSource, /\(assoc current :release! \(fn \[\]\)\)/u);
assert.match(readerSource, /:refresh-snapshot! refresh/u);
assert.match(readerSource, /:release-snapshot! release-active/u);
assert.match(profileSource, /:snapStart "enabled"/u);
assert.doesNotMatch(profileSource, /"no-snapstart"/u);
assert.match(handlerSource, /defn initialize-runtime!/u);
assert.doesNotMatch(servingSources,
  /\bd\/transact\b|eacl\/(?:write-schema!|write-relationships!|delete-object!)|datahike-eacl\/(?:expire-cache!|prepare-cache-coherence!)|konserve[^\s/]*\/(?:assoc|dissoc|delete|put)/u,
  "a write or administration call is reachable from the packaged service source");
for (const route of ["seed", "setup", "benchmark", "transact", "write-schema",
  "cache-evict", "delete-store", "admin"]) {
  assert.doesNotMatch(boundarySource, new RegExp(`"${route}"`, "u"));
}

const bytecode = output("javap", ["-classpath", archive, "-c",
  "eacl_demo.datahike_s3.LambdaHandler"]);
assert.match(bytecode,
  /implements com\.amazonaws\.services\.lambda\.runtime\.RequestStreamHandler/u);
assert.match(bytecode,
  /handleRequest\(java\.io\.InputStream, java\.io\.OutputStream, com\.amazonaws\.services\.lambda\.runtime\.Context\)/u);
assert.match(bytecode, /eacl-demo\.datahike-s3\.lambda-handler/u);
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
  "(try (Class/forName \"eacl_demo.datahike_s3.LambdaHandler\" false (.getContextClassLoader (Thread/currentThread))) (Class/forName \"EaclKernel.__default\") (println :loaded) (catch Throwable t (.printStackTrace t) (System/exit 1)))"]);
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
                   (d/q '[:find ?value
                          :where
                          [_ :demo/value ?value]]
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
           '[eacl-demo.datahike-s3.lambda-handler :as handler])
  (let [captures (atom 0)
        releases (atom 0)
        environment {"AWS_REGION" "us-east-1"
                     "EACL_DATAHIKE_BUCKET" "eacl-demo-datahike-artifact-smoke"
                     "EACL_DATAHIKE_STORE_ID" "4e67bb31-557d-4f49-8b4c-699d39577310"
                     "EACL_STORE_CACHE_SIZE" "1000"
                     "EACL_SEARCH_CACHE_SIZE" "0"
                     "EACL_MAXIMUM_CONCURRENCY" "1"
                     "EACL_CURSOR_KEY" (apply str (repeat 32 "k"))
                     "EACL_DEMO_SHA" (apply str (repeat 40 "a"))
                     "EACL_CORE_SHA" "21e661e09988dca6e416454dd7a29321076c17ac"
                     "EACL_ARTIFACT_SHA256" (apply str (repeat 64 "b"))
                     "EACL_DEPLOYMENT_ID" "artifact-smoke"
                     "AWS_LAMBDA_FUNCTION_MEMORY_SIZE" "1024"}
        next-snapshot
        (fn []
          (let [revision (swap! captures inc)
                basis {:behavior "request-snapshot"
                       :id (str "datahike:artifact:" revision)
                       :capturedAt "2026-08-26T00:00:00Z"
                       :fixedForEnvironment false}]
            {:value :immutable
             :basis basis
             :release! #(swap! releases inc)}))
        runtime (handler/initialize environment
                                    (fn [_] {:capture-snapshot next-snapshot}))
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
    (assert (= "datahike:artifact:2"
               (get-in bootstrap-body [:meta :revision])))
    (assert (= "datahike:artifact:2"
               (get-in bootstrap-body [:data :basis :id])))
    (assert (= "enabled"
               (get-in bootstrap-body [:data :runtime :snapStart])))
    (assert (= 200 (:statusCode health)))
    (assert (= "datahike:artifact:3"
               (get-in health-body [:meta :revision])))
    (assert (= #{:revision :requestId :elapsedMs}
               (set (keys (:meta health-body)))))
    (assert (= 3 @captures))
    (assert (= 3 @releases))
    (println :datahike-s3-packaged-runtime-pass)))`,
]);
assert.equal(closedRuntimeSmoke, ":datahike-s3-packaged-runtime-pass");

console.log(`Datahike/S3 Lambda artifact audit passed (sha256:${sha256}, ${bytes.length} compressed bytes, ${uncompressedBytes} uncompressed bytes)`);

function output(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}
