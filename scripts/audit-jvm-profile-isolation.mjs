import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const leanServerAliases = ["datomic-dynamodb", "datalevin-memory"];
const browserCompiler = /(?:clojurescript-|closure-compiler-|google-closure-library)/u;

for (const alias of leanServerAliases) {
  const entries = classpath(alias);
  assert.equal(entries.some((entry) => browserCompiler.test(entry)), false,
    `${alias} includes the ClojureScript/Closure compiler toolchain`);
}

const workerEntries = classpath("datascript-worker");
assert.ok(workerEntries.some((entry) => /clojurescript-1\.12\.42\.jar$/u.test(entry)),
  "DataScript worker lacks its exact ClojureScript compiler");
console.log("Datomic/Datalevin server and DataScript browser dependency isolation audit passed; Datahike's upstream cross-platform closure remains an artifact-pruning gate");

function classpath(alias) {
  return execFileSync("clojure", [`-A:${alias}`, "-Spath"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  }).trim().split(path.delimiter);
}
