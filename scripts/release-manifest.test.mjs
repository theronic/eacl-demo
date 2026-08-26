import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseManifest, validateReleaseManifest } from "./lib/release-manifest.mjs";

const input = {
  demoSha: "a".repeat(40),
  eaclSha: "b".repeat(40),
  fixture: { id: "eacl-canonical.v1-10000", manifestSha256: "c".repeat(64) },
  deployment: { provider: "github-actions", repositoryId: "1345904214", runId: "12345", runAttempt: 2, ref: "refs/heads/demos" },
  artifacts: [{ name: "datahike-s3", path: "dist/datahike-s3/artifact.json", sha256: "d".repeat(64), bytes: 123 }]
};

test("release identity closes over source, fixture, deployment, contract and artifacts", () => {
  const manifest = createReleaseManifest(input);
  assert.equal(validateReleaseManifest(manifest), manifest);
  assert.equal(manifest.deployment.identity, `1345904214:12345:2:${"a".repeat(40)}`);
  assert.equal(manifest.source.eacl.sha, "b".repeat(40));
  assert.equal(manifest.fixture.manifestSha256, "c".repeat(64));
});

test("unknown fields and mutable source identities are rejected", () => {
  assert.throws(() => createReleaseManifest({ ...input, demoSha: "demos" }), /demo SHA/u);
  const manifest = createReleaseManifest(input);
  manifest.latest = true;
  assert.throws(() => validateReleaseManifest(manifest), /release manifest keys/u);
});

test("artifact path, digest, and deployment scope are bound", () => {
  assert.throws(() => createReleaseManifest({ ...input, artifacts: [{ ...input.artifacts[0], path: "other" }] }), /path/u);
  assert.throws(() => createReleaseManifest({ ...input, deployment: { ...input.deployment, ref: "refs/heads/main" } }), /refs\/heads\/demos/u);
});
