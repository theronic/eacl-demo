import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "services/datomic-dynamodb/src");
const javaRoot = path.join(root, "services/datomic-dynamodb/java");
const files = await enumerate(sourceRoot);
const javaFiles = await enumerate(javaRoot);
const wireSchema = JSON.parse(await readFile(path.join(root, "schemas/explorer.v1.schema.json"), "utf8"));
assert.deepEqual(files.map((entry) => entry.relative), [
  "eacl_demo/datomic_dynamodb/boundary.clj",
  "eacl_demo/datomic_dynamodb/lambda_handler.clj",
  "eacl_demo/datomic_dynamodb/operations.clj",
  "eacl_demo/datomic_dynamodb/profile.clj",
  "eacl_demo/datomic_dynamodb/reader.clj"
]);
assert.deepEqual(javaFiles.map((entry) => entry.relative), [
  "eacl_demo/datomic_dynamodb/LambdaHandler.java"
]);

const source = [...files, ...javaFiles].map((entry) => entry.text).join("\n");
assert.match(source, /datomic:ddb:\/\//u);
assert.match(source, /\?read-only=true/u);
assert.match(source, /:read-only\? true/u);
assert.match(source, /:direct-snapshot datomic-eacl\/snapshot/u);
assert.match(source, /direct-snapshot client fixed-db/u);
assert.match(source, /:behavior "fixed-environment"/u);
assert.match(source, /fixedForEnvironment true/u);
assert.ok(wireSchema.$defs.basis.properties.behavior.enum.includes("fixed-environment"));
assert.equal(wireSchema.$defs.basis.properties.behavior.enum.includes("fixed-current"), false);
assert.match(source, /unsupported-consistency/u);
assert.match(source, /http\/normalize-input/u);
assert.doesNotMatch(source, /:profileId profile-id/u);
assert.doesNotMatch(source, /\bd\/sync\b|\bd\/transact\b|create-database|delete-database|list-backups/u);
assert.doesNotMatch(source, /read-only=false|aws_access_key_id|aws_secret_key|endpoint=/u);
assert.match(source, /handle-request-stream/u);
assert.doesNotMatch(source, /RequestHandler|System\.getProperty|Runtime\.getRuntime|ProcessBuilder/u);

const reader = files.find((entry) => entry.relative.endsWith("reader.clj")).text;
const boundary = files.find((entry) => entry.relative.endsWith("boundary.clj")).text;
assert.equal((reader.match(/\bcurrent-db connection\b/gu) ?? []).length, 1);
assert.equal((reader.match(/\bdirect-snapshot client fixed-db\b/gu) ?? []).length, 1);
assert.match(boundary, /supported-consistency\s+#\{"minimize"\}/u);
assert.doesNotMatch(boundary, /supported-consistency\s+#\{[^}]*"current"/u);
console.log(`Datomic fixed-current serving source audit passed (${files.length} files)`);

async function enumerate(directory, prefix = "") {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const full = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const metadata = await stat(full);
    if (metadata.isSymbolicLink()) throw new Error(`serving source symlink forbidden: ${relative}`);
    if (metadata.isDirectory()) result.push(...await enumerate(full, relative));
    else if (metadata.isFile()) result.push({ relative, text: await readFile(full, "utf8") });
    else throw new Error(`unsupported serving source entry: ${relative}`);
  }
  return result;
}
