import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "services/datahike-dynamodb/src");
const files = await enumerate(sourceRoot);
const joined = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

const forbiddenSdkWitnesses = [
  "PutItemRequest", "DeleteItemRequest", "DeleteTableRequest", "CreateTableRequest",
  "UpdateTableRequest", "TransactWriteItemsRequest", "BatchWriteItemRequest",
  ".putItem", ".deleteItem", ".deleteTable", ".createTable", ".updateTable",
  ".transactWriteItems", ".batchWriteItem"
];
for (const witness of forbiddenSdkWitnesses) {
  if (joined.includes(witness)) throw new Error(`destructive DynamoDB SDK witness in serving source: ${witness}`);
}
if (joined.includes("konserve-dynamodb.core")) {
  throw new Error("rejected upstream adapter namespace is present in serving source");
}
const readerSource = await readFile(
  path.join(sourceRoot, "eacl_demo/datahike_dynamodb/reader.clj"), "utf8"
);
if (!readerSource.includes(":read-only? true")) {
  throw new Error("EACL client is not explicitly constructed without its writer role");
}
const konserveSource = await readFile(
  path.join(sourceRoot, "eacl_demo/datahike_dynamodb/konserve.clj"), "utf8"
);
if (!/\(-create-store \[_ env\][\s\S]*?:eacl-demo\/missing-dynamodb-store/u.test(
  konserveSource
)) {
  throw new Error("a missing DynamoDB table does not fail with the typed read-only error");
}
if (/\(when-not \(konserve\.impl\.storage-layout\/-store-exists\?/u.test(
  konserveSource
)) {
  throw new Error("the adapter duplicates Konserve's existing-store preflight");
}
const boundarySource = await readFile(
  path.join(sourceRoot, "eacl_demo/datahike_dynamodb/boundary.clj"), "utf8"
);
if (boundarySource.includes(":profileId profile-id")) {
  throw new Error("response metadata contains a non-contract profileId field");
}
if (!boundarySource.includes("http/normalize-input")) {
  throw new Error("closed input validation is not called before serving");
}
if (!boundarySource.includes('#{"minimize" "at-least" "exact"}')) {
  throw new Error("the public boundary does not pass its closed consistency set to validation");
}
const sdkMembraneSource = await readFile(
  path.join(sourceRoot, "eacl_demo/datahike_dynamodb/client.clj"), "utf8"
);
for (const signature of ["getItem", "batchGetItem", "describeTable", "close", "serviceName"]) {
  if (!sdkMembraneSource.includes(`[\"${signature}\"`)) {
    throw new Error(`serving SDK membrane lacks expected signature: ${signature}`);
  }
}
if (!sdkMembraneSource.includes("allowed-signatures") ||
    !sdkMembraneSource.includes("(denied! method)")) {
  throw new Error("serving SDK client is not guarded by the closed membrane");
}
const forbiddenEaclServingCalls = [
  "eacl/write-schema!", "eacl/write-relationships!", "eacl/delete-object!",
  "datahike-eacl/expire-cache!", "datahike-eacl/prepare-cache-coherence!",
  "d/transact", "d/create-database", "d/delete-database"
];
for (const witness of forbiddenEaclServingCalls) {
  if (joined.includes(witness)) {
    throw new Error(`write or administration call in serving source: ${witness}`);
  }
}
const servingClasspath = execFileSync("clojure", ["-A:datahike-dynamodb", "-Spath"], {
  cwd: root, encoding: "utf8"
});
if (servingClasspath.includes("konserve-dynamodb-")) {
  throw new Error("rejected upstream adapter artifact leaked into serving classpath");
}
for (const compilerArtifact of [
  "/org/clojure/clojurescript/",
  "/com/google/javascript/closure-compiler/",
  "/org/clojure/google-closure-library/",
]) {
  if (servingClasspath.includes(compilerArtifact)) {
    throw new Error(`browser/compiler dependency leaked into serving classpath: ${compilerArtifact}`);
  }
}
const dependencySource = await readFile(path.join(root, "deps.edn"), "utf8");
if (!/org\.replikativ\/datahike[\s\S]*?:exclusions \[org\.clojure\/clojurescript\]/u.test(
  dependencySource
)) {
  throw new Error("Datahike serving dependency lacks its ClojureScript exclusion");
}
if (!/org\.replikativ\/konserve[\s\S]*?:exclusions \[org\.clojure\/clojurescript\]/u.test(
  dependencySource
)) {
  throw new Error("Konserve serving dependency lacks its ClojureScript exclusion");
}

console.log(`datahike-dynamodb serving audit passed (${files.length} source files)`);

async function enumerate(directory) {
  const result = [];
  for (const entry of (await readdir(directory)).sort()) {
    const full = path.join(directory, entry);
    const info = await stat(full);
    if (info.isDirectory()) result.push(...await enumerate(full));
    else if (info.isFile()) result.push(full);
  }
  return result;
}
