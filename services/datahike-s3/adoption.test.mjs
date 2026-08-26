import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidence = JSON.parse(await readFile(new URL("../../docs/provenance/datahike-s3-adoption-2026-08-25.json", import.meta.url), "utf8"));

test("legacy S3 adoption retains the store but fails closed on unresolved provenance and fixture mismatch", () => {
  assert.equal(evidence.profileId, "datahike-s3");
  assert.equal(evidence.readOnlyCapture, true);
  assert.equal(evidence.status, "replacement-reader-required");
  assert.equal(evidence.source.status, "unresolved");
  assert.equal(evidence.source.eaclSha, null);
  assert.match(evidence.artifact.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(evidence.artifact.downloadVerified, true);
  assert.equal(evidence.basis.status, "resolved");
  assert.equal(evidence.storage.storeId, evidence.basis.sourceStoreId);
  assert.equal(evidence.legacyFixture.manifestSha256, null);
  assert.equal(evidence.canonicalFixtureComparison.status, "mismatch");
  assert.equal(evidence.iam.status, "legacy-role-not-strictly-read-only");
  assert.ok(evidence.artifact.forbiddenServingClosureWitnesses.length >= 5);
});
