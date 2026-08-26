import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceDirectory = path.join(root, "services/datahike-s3/src/eacl_demo/datahike_s3");
const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".clj")).sort();
assert.deepEqual(names, [
  "boundary.clj",
  "client.clj",
  "konserve.clj",
  "lambda_handler.clj",
  "operations.clj",
  "profile.clj",
  "read_only_writer.clj",
  "reader.clj",
]);

const forbidden = /handle[-_](?:seed|schema[-_]write|cache[-_]evict)|storage[-_]gc|benchmark|admin[-_]token|transact!/iu;
const records = [];
for (const name of names) {
  const bytes = await readFile(path.join(sourceDirectory, name));
  const text = bytes.toString("utf8");
  if (name !== "read_only_writer.clj") assert.doesNotMatch(text, forbidden, `${name} contains a serving mutation/admin witness`);
  if (name === "read_only_writer.clj") {
    assert.match(text, /denied!/u);
    assert.doesNotMatch(text, /d\/transact|konserve.*(?:assoc|dissoc)|put-object|delete-object/iu);
  }
  records.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}

const boundary = await readFile(path.join(sourceDirectory, "boundary.clj"), "utf8");
assert.doesNotMatch(boundary, /:profileId profile-id/u, "response metadata has a non-contract field");
assert.match(boundary, /unsupported-consistency/u);
assert.match(boundary, /http\/normalize-input/u, "closed input validation is not called before serving");
for (const route of ["seed", "setup", "benchmark", "transact", "cache-evict", "delete-store", "admin"]) {
  assert.doesNotMatch(boundary, new RegExp(`"${route}"`, "u"));
}
const reader = await readFile(path.join(sourceDirectory, "reader.clj"), "utf8");
assert.match(reader, /:read-only\?\s+true/u, "EACL writer role must not be constructed");
assert.match(reader, /:backend read-only-store\/backend/u);
assert.doesNotMatch(reader, /:backend :s3/u,
  "reader dispatches to the marker-writing upstream connector");
assert.doesNotMatch(
  reader,
  /eacl\/(?:write-schema!|write-relationships!|delete-object!)|datahike-eacl\/(?:expire-cache!|prepare-cache-coherence!)|d\/transact/u,
  "reader contains a write or administration call"
);
const client = await readFile(path.join(sourceDirectory, "client.clj"), "utf8");
assert.match(client, /\["getObject"/u);
assert.match(client, /\["headObject"/u);
assert.doesNotMatch(client,
  /\["(?:putObject|deleteObject|copyObject|createBucket|deleteBucket|listObjects)/u,
  "SDK membrane exposes mutation, administration, or enumeration");
const konserve = await readFile(path.join(sourceDirectory, "konserve.clj"), "utf8");
assert.match(konserve, /def backend :eacl-demo-s3-read-only-store/u);
assert.match(konserve,
  /\(when-not \(konserve\.impl\.storage-layout\/-store-exists\?/u,
  "connect does not preflight the existing store marker");
assert.doesNotMatch(konserve,
  /s3\/(?:connect-store|put-object|put-object-conditional|create-bucket|delete|copy|list-objects)/u,
  "custom backing reaches an upstream mutator or enumerator");
const profile = await readFile(path.join(sourceDirectory, "profile.clj"), "utf8");
assert.match(profile, /:snapStart "disabled"/u, "unqualified S3 reader lifecycle must not claim SnapStart");
assert.match(profile, /"no-snapstart"/u);
assert.doesNotMatch(profile, /:snapStart "enabled"/u);
process.stdout.write(`${JSON.stringify({ schema: "eacl-demo.datahike-s3-serving-audit.v1", records }, null, 2)}\n`);
