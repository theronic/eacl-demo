import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createObservabilityReadiness } from "./src/observability-readiness.mjs";
import { createFailedDeploymentPublication, createInitialEnablementPublication, createOrdinaryDeploymentPublication } from "./src/publication-gates.mjs";
import { runMergeSmoke } from "./src/merge-smoke.mjs";
import { productionRecheckEvidenceId, runProductionRecheck } from "./src/production-recheck.mjs";
import { verifyProfilePublication } from "../explorer-state/src/profile-publication.mjs";

const readJson = (url) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [registry, definitions] = await Promise.all([readJson("../../registry/profile-registry.v1.json"), readJson("../contracts/profiles.v1.json")]);
const profileId = "datahike-s3";
const identity = { profileId, demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deploy-1", dataManifestSha256: "d".repeat(64) };
const deployment = { demoSha: identity.demoSha, eaclSha: identity.eaclSha, artifact: { kind: "lambda-version", sha256: identity.artifactSha256, version: "7" }, deploymentId: identity.deploymentId, dataManifestSha256: identity.dataManifestSha256, deployedAt: "2026-08-25T12:00:00Z" };
const categories = ["identity", "contract", "authorization", "relationship", "pagination-cursor", "cache", "consistency", "consistency-failure", "failure-redaction", "cleanup"];

test("initial public enablement is impossible without the full qualification and observability gate", async () => {
  const input = initialInput();
  const publication = await createInitialEnablementPublication(input, { cryptoImpl: webcrypto, now: "2026-08-25T12:04:00Z" });
  assert.equal(publication.profile.state, "enabled");
  assert.equal(publication.profile.deployment.dataManifestSha256, identity.dataManifestSha256);
  assert.equal(publication.gate.kind, "initial-qualification");
  assert.match(publication.gate.evidenceId, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(await verify(publication), publication);

  for (const mutate of [
    (candidate) => { candidate.observability.alarms[0].actionsEnabled = false; },
    (candidate) => { candidate.qualification.target.kind = "local"; },
    (candidate) => { candidate.workload.dataset.manifestSha256 = "e".repeat(64); }
  ]) {
    const invalid = initialInput();
    mutate(invalid);
    await assert.rejects(() => createInitialEnablementPublication(invalid, { cryptoImpl: webcrypto, now: "2026-08-25T12:04:00Z" }), (error) => error.code === "initial-qualification-incomplete");
  }
});

test("ordinary publication requires an already-enabled profile and a sealed exact candidate staging smoke", async () => {
  const baseRegistry = enabledRegistry();
  const smoke = await passingSmoke();
  const replacement = { ...deployment, demoSha: "e".repeat(40), artifact: { ...deployment.artifact, sha256: "f".repeat(64), version: "8" }, deploymentId: "deploy-2", deployedAt: "2026-08-25T12:05:00Z" };
  smoke.identity.demoSha = replacement.demoSha;
  smoke.identity.artifactSha256 = replacement.artifact.sha256;
  smoke.identity.deploymentId = replacement.deploymentId;
  smoke.startedAt = "2026-08-25T12:05:01Z";
  smoke.completedAt = "2026-08-25T12:05:02Z";
  smoke.evidenceId = resealSmoke(smoke);
  const productionRecheck = await passingProductionRecheck();
  productionRecheck.identity.demoSha = replacement.demoSha;
  productionRecheck.identity.artifactSha256 = replacement.artifact.sha256;
  productionRecheck.identity.deploymentId = replacement.deploymentId;
  productionRecheck.startedAt = "2026-08-25T12:05:02.100Z";
  productionRecheck.completedAt = "2026-08-25T12:05:02.200Z";
  productionRecheck.evidenceId = productionRecheckEvidenceId(productionRecheck);
  const publication = await createOrdinaryDeploymentPublication({ baseRegistry, profileDefinitions: definitions, profileId, deployment: replacement, smoke, productionRecheck, publishedAt: "2026-08-25T12:05:03Z" }, { cryptoImpl: webcrypto, now: "2026-08-25T12:06:00Z" });
  assert.equal(publication.gate.kind, "merge-smoke");
  assert.notEqual(publication.gate.evidenceId, smoke.evidenceId);
  assert.equal(publication.profile.deployment.demoSha, replacement.demoSha);
  assert.equal(await verify(publication), publication);

  const initial = structuredClone(registry);
  await assert.rejects(() => createOrdinaryDeploymentPublication({ baseRegistry: initial, profileDefinitions: definitions, profileId, deployment: replacement, smoke, productionRecheck, publishedAt: "2026-08-25T12:05:03Z" }, { cryptoImpl: webcrypto, now: "2026-08-25T12:06:00Z" }), /initial enablement/u);
  const drifted = structuredClone(smoke);
  drifted.target.path = "/api/v1/datomic-dynamodb";
  await assert.rejects(() => createOrdinaryDeploymentPublication({ baseRegistry, profileDefinitions: definitions, profileId, deployment: replacement, smoke: drifted, productionRecheck, publishedAt: "2026-08-25T12:05:03Z" }, { cryptoImpl: webcrypto, now: "2026-08-25T12:06:00Z" }));
  await assert.rejects(() => createOrdinaryDeploymentPublication({ baseRegistry, profileDefinitions: definitions, profileId, deployment: replacement, smoke, productionRecheck: null, publishedAt: "2026-08-25T12:05:03Z" }, { cryptoImpl: webcrypto, now: "2026-08-25T12:06:00Z" }));
  const early = structuredClone(productionRecheck);
  early.startedAt = "2026-08-25T12:05:01.500Z";
  early.completedAt = "2026-08-25T12:05:01.600Z";
  early.evidenceId = productionRecheckEvidenceId(early);
  await assert.rejects(() => createOrdinaryDeploymentPublication({ baseRegistry, profileDefinitions: definitions, profileId, deployment: replacement, smoke, productionRecheck: early, publishedAt: "2026-08-25T12:05:03Z" }, { cryptoImpl: webcrypto, now: "2026-08-25T12:06:00Z" }), /before the candidate staging smoke/u);
});

test("a failed attempt retains the prior healthy deployment and exposes only the attempted immutable identity", async () => {
  const baseRegistry = enabledRegistry();
  const attempted = { ...deployment, demoSha: "e".repeat(40), artifact: { ...deployment.artifact, sha256: "f".repeat(64), version: "8" }, deploymentId: "deploy-2", deployedAt: "2026-08-25T12:05:00Z" };
  const publication = await createFailedDeploymentPublication({ baseRegistry, profileDefinitions: definitions, profileId, attemptedDeployment: attempted, failedAt: "2026-08-25T12:05:02Z", publishedAt: "2026-08-25T12:05:03Z", message: "Candidate smoke failed; the prior healthy alias was retained." }, { cryptoImpl: webcrypto, now: "2026-08-25T12:06:00Z" });
  assert.equal(publication.profile.state, "enabled");
  assert.equal(publication.profile.deployment.deploymentId, deployment.deploymentId);
  assert.equal(publication.profile.lastOutcome.outcome, "failed");
  assert.equal(publication.profile.lastOutcome.attemptedDemoSha, attempted.demoSha);
  assert.deepEqual(publication.gate, { kind: "failure-outcome", evidenceId: null });
  assert.equal(await verify(publication), publication);
});

function enabledRegistry() {
  const value = structuredClone(registry);
  const profile = value.profiles.find(({ id }) => id === profileId);
  profile.state = "enabled";
  profile.reason = null;
  profile.deployment = structuredClone(deployment);
  profile.lastOutcome = { outcome: "succeeded", attemptedDemoSha: deployment.demoSha, attemptedEaclSha: deployment.eaclSha, artifactSha256: deployment.artifact.sha256, at: deployment.deployedAt, message: "Initial deployment succeeded." };
  value.storageDefaults[0] = { outcome: "sole-qualified", profileId, storage: "s3", claim: null, evidenceId: null, measuredAt: null, reason: "Only one qualified storage choice is enabled.", backend: "datahike" };
  return value;
}

function initialInput() {
  const qualification = {
    schema: "eacl-demo.qualification-report.v1", result: "pass", startedAt: "2026-08-25T12:00:01Z", completedAt: "2026-08-25T12:01:00Z",
    target: { kind: "staged-cloudfront", origin: "https://staging.demo.eacl.dev", path: "/api/v1/datahike-s3", profileId }, identity, descriptorIdentity: identity, releaseOutcome: "released",
    counts: { passed: categories.length, failed: 0, unsupported: 0 },
    cases: categories.map((category) => ({ id: `${category}-case`, category, status: "passed", durationMs: 1, reason: null, details: {} }))
  };
  const criteria = { requiredPhases: ["cold", "warm"], concurrency: 2, maximumErrorRate: 0, minimumMemoryHeadroomPercent: 20, repetitions: { cold: 2, restore: 2, warm: 4 }, minimumSamples: { cold: 2, restore: 2, warm: 4 }, maximumP95Ms: { cold: 10_000, restore: 10_000, warm: 1_000 } };
  const phase = (name, samples) => ({ phase: name, status: "passed", reason: null, samples, errors: 0, errorRate: 0, latencyMs: { p50: 10, p95: 20, maximumP95: criteria.maximumP95Ms[name] }, memory: { minimumHeadroomPercent: 30, requiredHeadroomPercent: 20 } });
  const workload = { schema: "eacl-demo.qualification-workload.v1", result: "pass", profileId, dataset: { fixtureId: "eacl-demo-fixture-v1", logicalResourceCount: 1_000_000, manifestSha256: identity.dataManifestSha256 }, cacheStates: ["bypass", "warm"], concurrency: 2, criteria, phases: [phase("cold", 2), { phase: "restore", status: "unsupported", reason: "SnapStart is disabled.", samples: 0, errors: 0, latencyMs: null, memory: null }, phase("warm", 4)] };
  const named = (names) => names.map((name) => ({ name, status: "ready" }));
  const observability = createObservabilityReadiness({ schema: "eacl-demo.observability-readiness.v1", identity, route: "/api/v1/datahike-s3", completedAt: "2026-08-25T12:02:00Z", logs: { structured: true, redactionAudit: "passed", retentionDays: 14 }, signals: named(["requests", "errors", "duration", "initialization", "restore", "throttles", "timeouts", "oom", "storage"]), alarms: ["duration", "errors", "health", "initialization", "oom", "throttles", "timeouts"].map((name) => ({ name, status: "ready", state: "OK", actionsEnabled: true, notificationPath: "sns-telegram", scope: { profileId, resourceIdentifier: "eacl-demo-datahike-s3" } })), dashboard: { status: "ready", identifier: "eacl-demo-datahike-s3" }, synthetics: ["bootstrap", "exemplar", "health"].map((name) => ({ name, status: "passed", target: { kind: "staged-cloudfront", baseUrl: "https://staging.demo.eacl.dev/api/v1/datahike-s3" }, checkedAt: "2026-08-25T12:01:30Z", observedIdentity: identity })), runbook: { status: "ready", identifier: "docs/operator-runbook.md#profile-incidents" } });
  return { baseRegistry: structuredClone(registry), profileDefinitions: definitions, profileId, deployment, qualification, workload, observability, publishedAt: "2026-08-25T12:03:00Z" };
}

async function passingSmoke() {
  const transport = { async request(operation, input) {
    const meta = { operation, identity };
    if (operation === "health") return { ok: true, meta, data: { ready: true, status: "ready", identity } };
    if (operation === "bootstrap") return { ok: true, meta, data: { identity } };
    if (operation === "authorize") return { ok: true, meta, data: { ...input, allowed: input.subjectId === "user-1" } };
    return { ok: false, meta, error: { code: "route-not-found" } };
  } };
  const times = ["2026-08-25T12:00:01Z", "2026-08-25T12:00:02Z"];
  let index = 0;
  return runMergeSmoke({ transport, expectedIdentity: identity, target: { kind: "staged-cloudfront", origin: "https://staging.demo.eacl.dev", path: "/api/v1/datahike-s3", profileId }, allowedDemand: { subject: { type: "user", id: "user-1" }, resource: { type: "account", id: "account-1" }, permission: "read" }, deniedDemand: { subject: { type: "user", id: "user-2" }, resource: { type: "account", id: "account-1" }, permission: "read" }, clock: () => times[index++] });
}

async function passingProductionRecheck() {
  const transport = { async request(operation) {
    const meta = { operation, identity };
    if (operation === "health") return { ok: true, meta, data: { ready: true, status: "ready", identity } };
    if (operation === "bootstrap") return { ok: true, meta, data: { identity } };
    throw new Error(`unexpected operation ${operation}`);
  } };
  const times = ["2026-08-25T12:00:03Z", "2026-08-25T12:00:04Z"];
  let index = 0;
  return runProductionRecheck({ transport, expectedIdentity: identity, target: { kind: "production-cloudfront", origin: "https://demo.eacl.dev", path: "/api/v1/datahike-s3", profileId }, clock: () => times[index++] });
}

function resealSmoke(report) {
  const payload = structuredClone(report);
  delete payload.evidenceId;
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function verify(publication) {
  const definition = definitions.profiles.find(({ id }) => id === publication.profile.id);
  const expected = registry.profiles.find(({ id }) => id === publication.profile.id);
  return verifyProfilePublication(publication, definition, expected, { cryptoImpl: webcrypto, now: "2026-08-25T12:06:00Z" });
}
