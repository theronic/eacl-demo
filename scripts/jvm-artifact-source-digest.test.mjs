import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("current JVM artifact source closures are sorted, unique, and content addressed", () => {
  for (const profileId of ["datahike-s3", "datahike-dynamodb", "datomic-dynamodb"]) {
    const first = capture(profileId);
    const second = capture(profileId);
    assert.deepEqual(second, first);
    assert.match(first.digest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(first.fileCount, first.records.length);
    assert.deepEqual(first.records.map(({ path }) => path),
      [...new Set(first.records.map(({ path }) => path))].sort());
    for (const required of [
      "build.clj", "deps.edn", "dependencies/eacl-core.lock.json",
      "dependencies/jvm.lock.json", "fixtures/schema-wire.v1.json",
      "packages/contracts/src/eacl_demo/contracts/observability.clj",
      "scripts/lib/prepare-eacl-core.mjs", "scripts/normalize-zip.py",
      "scripts/prepare-eacl-core.mjs"
    ]) assert.equal(first.records.some(({ path }) => path === required), true);
    assert.equal(first.records.some(({ path }) =>
      path.includes(`/src/eacl_demo/${profileId.replaceAll("-", "_")}/lambda_handler.clj`)), true);
  }
});

function capture(profileId) {
  return JSON.parse(execFileSync(process.execPath,
    ["scripts/capture-jvm-artifact-source-digest.mjs", profileId],
    { encoding: "utf8" }));
}
