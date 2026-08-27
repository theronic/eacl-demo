import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateProfileRegistry } from "./src/profile-registry.mjs";

const readJson = (url) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [registry, definitions] = await Promise.all([readJson("../../registry/profile-registry.v1.json"), readJson("../contracts/profiles.v1.json")]);

test("the initial independently publishable registry is truthful", () => {
  assert.equal(validateProfileRegistry(registry, definitions), registry);
  assert.equal(registry.profiles.every(({ deployment, lastOutcome }) => deployment === null && lastOutcome.outcome === "never-deployed"), true);
});

test("enabled profiles require actual immutable deployed identities", () => {
  const invalid = structuredClone(registry);
  invalid.profiles[0].state = "enabled";
  invalid.profiles[0].reason = null;
  assert.throws(() => validateProfileRegistry(invalid, definitions), /deployment identity/u);
  invalid.profiles[0].deployment = { demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifact: { kind: "lambda-version", sha256: "c".repeat(64), version: "42" }, deploymentId: "1345904214:1:1", dataManifestSha256: "d".repeat(64), deployedAt: "2026-08-25T12:00:00Z" };
  invalid.profiles[0].lastOutcome = { outcome: "succeeded", attemptedDemoSha: "a".repeat(40), attemptedEaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), at: "2026-08-25T12:00:00Z", message: "The independently qualified profile was promoted." };
  invalid.storageDefaults[0] = { outcome: "sole-qualified", profileId: "datahike-s3", storage: "s3", claim: null, evidenceId: null, measuredAt: null, reason: "Only one qualified storage choice is enabled.", backend: "datahike" };
  assert.equal(validateProfileRegistry(invalid, definitions), invalid);
});

test("unknown states, outcomes, artifact kinds, and non-canonical routes fail closed", () => {
  for (const mutate of [
    (candidate) => { candidate.profiles[0].state = "healthy"; },
    (candidate) => { candidate.profiles[0].lastOutcome.outcome = "skipped"; },
    (candidate) => { candidate.profiles[0].route = "/extra"; },
    (candidate) => { candidate.profiles[0].deployment = { demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifact: { kind: "container", sha256: "c".repeat(64), version: "42" }, deploymentId: "deploy-1", dataManifestSha256: "d".repeat(64), deployedAt: "2026-08-25T12:00:00Z" }; }
  ]) {
    const invalid = structuredClone(registry);
    mutate(invalid);
    assert.throws(() => validateProfileRegistry(invalid, definitions));
  }
});

test("registry cannot publish an evidence summary without its validated content", () => {
  const invalid = structuredClone(registry);
  invalid.benchmarkEvidence.push({ evidenceId: `sha256:${"a".repeat(64)}`, backend: "datahike", profiles: ["datahike-s3", "datahike-dynamodb"], measuredAt: "2026-08-25T12:00:00Z", expiresAt: "2026-09-25T12:00:00Z", path: "registry/benchmark-evidence/example.json", sha256: "b".repeat(64) });
  assert.throws(() => validateProfileRegistry(invalid, definitions), /summaries do not match/u);
});

test("mutable latest or convergence claims are rejected", () => {
  const invalid = structuredClone(registry);
  invalid.latestDemoSha = "a".repeat(40);
  assert.throws(() => validateProfileRegistry(invalid, definitions), /unknown or missing|latest source/u);
  const claim = structuredClone(registry);
  claim.profiles[0].lastOutcome.message = "All profiles converged.";
  assert.throws(() => validateProfileRegistry(claim, definitions), /latest source or fleet convergence/u);
});
