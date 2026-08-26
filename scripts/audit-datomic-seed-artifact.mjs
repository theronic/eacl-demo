import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const archive = path.join(root, "dist/datomic-dynamodb-seed/seed.jar");
const bytes = await readFile(archive);
const entries = output("unzip", ["-Z1", archive]).split("\n").filter(Boolean);
const entrySet = new Set(entries);

for (const required of [
  "eacl_demo/datomic_dynamodb/seed.clj",
  "eacl_demo/datomic_dynamodb/seed_main.clj",
  "CurrentCache/__default.class",
  "EaclKernel/__default.class",
  "PageWindow/__default.class",
  "schema.v1.zed",
  "manifests/fixture-10000.v1.json",
  "manifests/fixture-1000000.v1.json",
  "datomic-demo-metadata-schema.edn",
  "seed-runner.sh"
]) assert.ok(entrySet.has(required), `seed artifact entry missing: ${required}`);
for (const forbidden of [
  "eacl_demo/datomic_dynamodb/LambdaHandler.class",
  "eacl_demo/datomic_dynamodb/lambda_handler.clj",
  "eacl_demo/datomic_dynamodb/reader.clj",
  "schema-wire.v1.json",
  "build.clj",
  "datomic/transactor-key.jks",
  "datomic/transactor-trust.jks"
]) assert.equal(entrySet.has(forbidden), false, `serving/build entry leaked into seed artifact: ${forbidden}`);

const seedSource = ["seed.clj", "seed_main.clj"]
  .map((name) => output("unzip", ["-p", archive, `eacl_demo/datomic_dynamodb/${name}`]))
  .join("\n");
assert.match(seedSource, /d\/transact/u);
assert.match(seedSource, /d\/create-database/u);
assert.match(seedSource, /d\/request-index/u);
assert.match(seedSource, /d\/sync-index/u);
assert.match(seedSource, /d\/as-of/u);
assert.match(seedSource, /d\/history/u);
assert.match(seedSource, /:db\/noHistory/u);
assert.match(seedSource, /history-evidence/u);
assert.match(seedSource, /seed-batch-delay-millis 500/u);
assert.doesNotMatch(seedSource, /read-only=true|LambdaHandler|RequestStreamHandler/u);

const runner = output("unzip", ["-p", archive, "seed-runner.sh"]);
for (const marker of [
  "set -Eeuo pipefail",
  "s3api get-object",
  "--version-id",
  "sha256sum --check --strict",
  "gzip --test",
  "encrypt-channel=false",
  "write-concurrency=2",
  "historyVerified",
  "s3api put-object",
  "--server-side-encryption AES256",
  "trap cleanup EXIT"
]) assert.ok(runner.includes(marker), `seed runner safety marker missing: ${marker}`);
assert.doesNotMatch(runner, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|--no-verify-ssl|curl\s+[^\n]*http:/u);

const manifest = output("unzip", ["-p", archive, "META-INF/MANIFEST.MF"]);
assert.doesNotMatch(manifest, /^Build-Jdk-Spec:/mu);
const kernelBytecode = output("javap", ["-classpath", archive, "-verbose", "EaclKernel.__default"]);
assert.match(kernelBytecode, /^\s*major version: 69$/mu,
  "generated EACL kernel must be loadable by the pinned Java 25 seed runtime");
const smoke = output("java", [
  "-cp", archive, "clojure.main", "-e",
  "(try (Class/forName \"EaclKernel.__default\") (let [resource-text (requiring-resolve (quote eacl-demo.datomic-dynamodb.seed-main/resource-text)) manifest-path (requiring-resolve (quote eacl-demo.datomic-dynamodb.seed-main/manifest-resource-path)) m (resource-text (manifest-path 1000000)) s (resource-text \"schema.v1.zed\") d (resource-text \"datomic-demo-metadata-schema.edn\")] (assert (.contains m \"1000000\")) (assert (pos? (count s))) (assert (pos? (count d))) (println :loaded)) (catch Throwable t (.printStackTrace t) (System/exit 1)))"
]);
assert.equal(smoke, ":loaded");

const aotLoaderSmoke = output("java", [
  "-cp", archive, "clojure.main", "-e",
  "(require 'clojure.pprint) (clojure.pprint/pprint {:aot-loader :pass})"
]);
assert.equal(aotLoaderSmoke, "{:aot-loader :pass}");

console.log(`Datomic seed artifact audit passed (sha256:${createHash("sha256").update(bytes).digest("hex")}, ${bytes.length} bytes)`);

function output(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"]
  }).trim();
}
