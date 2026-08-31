import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const archive = path.join(root, "dist/datomic-dynamodb/function.jar");
const bytes = await readFile(archive);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const entries = output("unzip", ["-Z1", archive]).split("\n").filter(Boolean);
const entrySet = new Set(entries);
const dependencyTree = output("clojure", [
  "-A:datomic-dynamodb:datomic-http-server:lambda-jvm", "-Stree"
]);

assert.match(dependencyTree, /^com\.datomic\/peer \S+$/mu);
assert.match(dependencyTree, /^http-kit\/http-kit \S+$/mu);
assert.doesNotMatch(
  dependencyTree,
  /com\.datomic\/(?:transactor|peer-server|client-cloud)(?:\s|$)/iu,
  "a standalone Datomic transactor/server dependency entered the serving graph"
);

assert.equal(entries.length, entrySet.size, "duplicate JAR entries are forbidden");
for (const required of [
  "eacl_demo/contracts/observability.clj",
  "eacl_demo/datomic_dynamodb/LambdaHandler.class",
  "eacl_demo/datomic_dynamodb/boundary.clj",
  "eacl_demo/datomic_dynamodb/lambda_handler.clj",
  "eacl_demo/datomic_dynamodb/operations.clj",
  "eacl_demo/datomic_dynamodb/profile.clj",
  "eacl_demo/datomic_dynamodb/reader.clj",
  "org/httpkit/server/HttpServer.class",
  "schema-wire.v1.json",
  "CurrentCache/__default.class",
  "EaclKernel/__default.class",
  "PageWindow/__default.class"
]) assert.ok(entrySet.has(required), `required JAR entry missing: ${required}`);

for (const forbidden of [
  "datomic/transactor-key.jks",
  "datomic/transactor-trust.jks",
  "build.clj",
  "infra/data/datomic-demo-metadata-schema.edn",
  "schema.v1.zed",
  "seeding.md",
  "fixture-decision.md",
  "format.md",
  "counts.md"
]) assert.equal(entrySet.has(forbidden), false, `maintenance/runtime-irrelevant entry leaked: ${forbidden}`);
assert.equal(entries.some((entry) =>
  /^test\/|^eacl_demo\/.*(?:_test|\/seed|\/transactor|\/admin).*|^bin\/|^datomic\/(?:transactor|peer[_-]?server)(?:\/|\.class$)/iu.test(entry)), false,
"a project test/maintenance source, transactor executable, or peer-server entry leaked into the JAR");
assert.equal(entries.some((entry) =>
  /^META-INF\/maven\/com\.datomic\/(?:transactor|peer-server|client-cloud)\//iu.test(entry)), false,
"a standalone Datomic transactor/server Maven component leaked into the JAR");

const servingSources = entries
  .filter((entry) => /^eacl_demo\/datomic_dynamodb\/.*\.clj$/u.test(entry))
  .map((entry) => output("unzip", ["-p", archive, entry]))
  .join("\n");
const observabilitySource = output("unzip", ["-p", archive,
  "eacl_demo/contracts/observability.clj"]);
assert.match(observabilitySource, /EaclDemo\/Runtime/u);
for (const metric of ["Requests", "Errors", "Duration", "Initialization",
  "Restore", "Throttles", "Timeouts", "OOM", "Storage"]) {
  assert.match(observabilitySource, new RegExp(`\\{"Name" "${metric}"`, "u"));
}
assert.doesNotMatch(observabilitySource,
  /stack-trace|\.getMessage|Throwable->map|AWS_SECRET/iu);
assert.match(servingSources, /\?read-only=true/u);
assert.match(servingSources, /:read-only\? true/u);
assert.match(servingSources, /datomic-eacl\/cache-stats/u);
assert.match(servingSources,
  /cache-metrics\/snapshot \(cache-stats\) operation-metrics/u);
assert.match(servingSources, /cache-metrics\/record-response!/u);
assert.doesNotMatch(servingSources,
  /\bd\/sync\b|\bd\/transact\b|create-database|delete-database|list-backups|read-only=false/u);

const bytecode = output("javap", ["-classpath", archive, "-c", "eacl_demo.datomic_dynamodb.LambdaHandler"]);
assert.match(bytecode, /implements com\.amazonaws\.services\.lambda\.runtime\.RequestStreamHandler/u);
assert.match(bytecode, /handleRequest\(java\.io\.InputStream, java\.io\.OutputStream, com\.amazonaws\.services\.lambda\.runtime\.Context\)/u);
assert.match(bytecode, /eacl-demo\.datomic-dynamodb\.lambda-handler/u);
assert.match(bytecode, /handle-request-stream/u);
assert.doesNotMatch(bytecode, /transact|sync|create_database|delete_database/iu);
const kernelBytecode = output("javap", ["-classpath", archive, "-verbose", "EaclKernel.__default"]);
assert.match(kernelBytecode, /^\s*major version: 69$/mu,
  "generated EACL kernel must be loadable by the pinned Java 25 Lambda runtime");

const manifest = output("unzip", ["-p", archive, "META-INF/MANIFEST.MF"]);
assert.doesNotMatch(manifest, /^Build-Jdk-Spec:/mu, "host JDK metadata makes the JAR environment-dependent");
assert.match(manifest, /^Multi-Release: true$/mu);

const smoke = output("java", [
  "-cp", archive, "clojure.main", "-e",
  "(try (Class/forName \"eacl_demo.datomic_dynamodb.LambdaHandler\" false (.getContextClassLoader (Thread/currentThread))) (Class/forName \"EaclKernel.__default\") (println :loaded) (catch Throwable t (.printStackTrace t) (System/exit 1)))"
]);
assert.equal(smoke, ":loaded");

const aotLoaderSmoke = output("java", [
  "-cp", archive, "clojure.main", "-e",
  "(require 'clojure.pprint) (clojure.pprint/pprint {:aot-loader :pass})"
]);
assert.equal(aotLoaderSmoke, "{:aot-loader :pass}");

const fixedReaderSmoke = output("java", [
  "-cp", archive, "clojure.main", "-e", String.raw`
(do
  (require '[eacl-demo.datomic-dynamodb.reader :as reader])
  (let [calls (atom [])
        releases (atom [])
        fixed-db (Object.)
        config {:region "us-east-1"
                :table "eacl-demo-datomic-artifact-smoke"
                :database "eacl-demo"
                :maximum-concurrency 2
                :security-key (apply str (repeat 32 "k"))}
        opened
        (reader/open-reader!
         config
         {:connect (fn [uri]
                     (swap! calls conj [:connect uri])
                     :read-only-connection)
          :current-db (fn [connection]
                        (swap! calls conj [:current-db connection])
                        fixed-db)
          :basis-t (fn [database]
                     (swap! calls conj [:basis-t database])
                     424242)
          :make-client (fn [connection options]
                         (swap! calls conj [:make-client connection options])
                         :read-only-client)
          :select-current-snapshot
          (fn [client]
            (swap! calls conj [:select-current-snapshot client])
            :initial-snapshot)
          :select-exact-snapshot
          (fn [client token]
            (swap! calls conj [:select-exact-snapshot client token])
            (Object.))
          :snapshot-db
          (fn [snapshot]
            (swap! calls conj [:snapshot-db snapshot])
            fixed-db)
          :snapshot-token
          (fn [snapshot]
            (swap! calls conj [:snapshot-token snapshot])
            "fixed-authenticated-token")
          :resolve-as-of
          (fn [_ _]
            {:revision 400
             :captured-at (java.time.Instant/parse "2026-08-24T09:30:00Z")})
          :decode-token (fn [_ token]
                          (swap! calls conj [:decode-token token])
                          :fixed-token-scope)
          :issue-exact-token
          (fn [_ token-scope revision]
            (swap! calls conj [:issue-exact-token token-scope revision])
            (if (= 400 revision)
              "historical-authenticated-token"
              "fixed-authenticated-token"))
          :release-snapshot (fn [snapshot]
                              (swap! releases conj [:snapshot snapshot]))
          :release-connection (fn [connection]
                                (swap! releases conj [:connection connection]))
          :read-schema-source (fn [database]
                                (swap! calls conj [:read-schema-source database])
                                (slurp "fixtures/schema.v1.zed"))
          :clock (constantly (java.time.Instant/parse "2026-08-25T12:00:00Z"))})
        snapshots (mapv (fn [_] ((:capture-snapshot opened))) (range 3))
        historical
        ((:capture-snapshot opened)
         {:consistency "historical-date"
          :atExactSnapshotAt "2026-08-24T10:00:00Z"})
        exact-calls (filterv #(= :select-exact-snapshot (first %)) @calls)
        client-options (nth (first (filter #(= :make-client (first %)) @calls)) 2)]
    (assert (= 1 (count (filter #(= :current-db (first %)) @calls))))
    (assert (= [[:select-current-snapshot :read-only-client]]
               (filterv #(= :select-current-snapshot (first %)) @calls)))
    (assert (= 1 (count exact-calls)))
    (assert (= ["historical-authenticated-token"]
               (mapv #(nth % 2) exact-calls)))
    (assert (= 1 (count (filter #(= :decode-token (first %)) @calls))))
    (assert (= [400]
               (mapv last
                     (filter #(= :issue-exact-token (first %)) @calls))))
    (assert (every? #(identical? :initial-snapshot (:value %)) snapshots))
    (assert (every? #(= (:basis opened) (:basis %)) snapshots))
    (assert (= {:behavior "request-snapshot"
                :id "datomic:eacl-demo-datomic-artifact-smoke:eacl-demo:400"
                :capturedAt "2026-08-24T09:30:00Z"
                :fixedForEnvironment false}
               (:basis historical)))
    (assert (= {:behavior "fixed-environment"
                :id "datomic:eacl-demo-datomic-artifact-smoke:eacl-demo:424242"
                :capturedAt "2026-08-25T12:00:00Z"
                :fixedForEnvironment true}
               (:basis opened)))
    (assert (= true (:read-only? client-options)))
    (doseq [snapshot snapshots] ((:release! snapshot)))
    ((:release! historical))
    (reader/close-reader! opened)
    (assert (= 2 (count (filter #(= :snapshot (first %)) @releases))))
    (assert (= [[:connection :read-only-connection]]
               (filterv #(= :connection (first %)) @releases)))
    (println :datomic-packaged-fixed-reader-pass)))`
]);
assert.equal(fixedReaderSmoke, ":datomic-packaged-fixed-reader-pass");

const closedRouteSmoke = output("java", [
  "-cp", archive, "clojure.main", "-e", String.raw`
(do
  (require '[eacl-demo.datomic-dynamodb.lambda-handler :as handler])
  (let [captures (atom 0)
        environment {"AWS_REGION" "us-east-1"
                     "EACL_DATOMIC_TABLE" "eacl-demo-datomic-artifact-smoke"
                     "EACL_DATOMIC_DATABASE" "eacl-demo"
                     "EACL_MAXIMUM_CONCURRENCY" "2"
                     "EACL_CURSOR_KEY" (apply str (repeat 32 "k"))
                     "EACL_DEMO_SHA" (apply str (repeat 40 "a"))
                     "EACL_CORE_SHA" "a91815ae0a4d32fc32db4e671e4d101834688332"
                     "EACL_ARTIFACT_SHA256" (apply str (repeat 64 "b"))
                     "EACL_DEPLOYMENT_ID" "artifact-smoke"
                     "AWS_LAMBDA_FUNCTION_MEMORY_SIZE" "1024"}
        basis {:behavior "fixed-environment"
               :id "datomic:eacl-demo-datomic-artifact-smoke:eacl-demo:424242"
               :capturedAt "2026-08-25T12:00:00Z"
               :fixedForEnvironment true}
        runtime
        (handler/initialize
         environment
         (fn [_]
           {:basis basis
            :capture-snapshot
            (fn []
              (swap! captures inc)
              {:value :fixed :basis basis :release! (fn [])})}))
        event
        (fn [operation]
          {:version "2.0"
           :routeKey "$default"
           :rawPath (str "/" operation)
           :rawQueryString ""
           :headers {"content-type" "application/json"}
           :requestContext {:requestId "artifact-smoke"
                            :http {:method "POST"}}
           :isBase64Encoded false
           :body "{}"
           :cookies nil})
        responses
        (mapv #(handler/handle-event runtime (event %) 10000)
              ["seed" "setup" "benchmark" "transact" "write-schema"
               "cache-evict" "delete-store" "admin"])]
    (assert (every? #(= 404 (:statusCode %)) responses))
    (assert (zero? @captures))
    (println :datomic-packaged-closed-routes-pass)))`
]);
assert.equal(closedRouteSmoke, ":datomic-packaged-closed-routes-pass");

// Datomic Peer is intentionally not relabelled as a stripped reader library:
// its published peer JAR contains dormant transaction and transactor-connector
// API classes. There is no standalone transactor/server component in the
// dependency graph, the packaged handler has no route to these APIs, the URI
// and EACL client are read-only, and serving IAM is the independent write-denial
// boundary.
assert.ok(entrySet.has("datomic/api$transact.class"), "Datomic Peer closure changed; repeat the safety review");
assert.ok(entrySet.has("datomic/connector$create_transactor_hornet_connector.class"),
  "Datomic Peer closure changed; repeat the safety review");

console.log(`Datomic Lambda artifact audit passed (sha256:${sha256}, ${bytes.length} bytes)`);

function output(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"]
  }).trim();
}
