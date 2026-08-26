import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { createProfilePublication } from "../packages/explorer-state/src/profile-publication.mjs";
import { runMergeSmoke } from "../packages/qualification/src/merge-smoke.mjs";
import { runProductionRecheck } from "../packages/qualification/src/production-recheck.mjs";
import { createServerPublicationPlan, executeServerPublication } from "./lib/server-publication.mjs";

const profileId = "datahike-s3";
const definition = { id: profileId, backend: "datahike", storage: "s3" };
const catalogProfile = {
  ...definition,
  state: "qualifying",
  reason: "Initial public qualification is still required.",
  route: `/api/v1/${profileId}`,
  deployment: null,
  lastOutcome: { outcome: "never-deployed", attemptedDemoSha: null, attemptedEaclSha: null, artifactSha256: null, at: null, message: "No deployment exists." }
};
const baseDeployment = deployment({ version: "7", artifactSha256: "7".repeat(64), demoSha: "a".repeat(40), deploymentId: "deploy-7", deployedAt: "2026-08-25T12:00:00Z" });
const plan = createServerPublicationPlan({
  target: profileId,
  artifactDirectory: "/tmp/ordinary-datahike-s3",
  artifactManifest: {
    schema: "eacl-demo.ordinary-artifact.v1",
    target: profileId,
    demoSha: "b".repeat(40),
    eaclSha: "c".repeat(40),
    artifactSha256: "d".repeat(64),
    files: [{ path: "payload/function.jar", bytes: 42, sha256: "8".repeat(64) }]
  },
  deploymentId: "github:42:1:8888888888888888",
  deployedAt: "2026-08-25T12:05:00Z"
});

test("ordinary server publication promotes one candidate/live pair and publishes status last", async () => {
  const adapter = await fakeAdapter();
  const result = await executeServerPublication({
    plan,
    adapter,
    profileDefinitions: { profiles: [definition] },
    baseRegistry: { profiles: [catalogProfile] },
    clock: timestamps(["2026-08-25T12:05:05Z"])
  });
  assert.equal(result.deployment.artifact.version, "8");
  assert.equal(result.deployment.artifact.sha256, plan.runtimeArtifact.sha256);
  assert.equal(adapter.state.candidateAlias.functionVersion, "8");
  assert.equal(adapter.state.liveAlias.functionVersion, "8");
  assert.equal(adapter.state.status.publication.profile.lastOutcome.outcome, "succeeded");
  assert.equal(adapter.state.status.publication.profile.deployment.deploymentId, plan.deploymentId);
  assert.deepEqual(adapter.events.slice(-3), ["smoke-production", "put-status:succeeded", "verify-status:succeeded"]);
});

test("candidate failure restores the exact alias and publishes only a failed outcome over the healthy deployment", async () => {
  const adapter = await fakeAdapter({ candidateFailure: true });
  await assert.rejects(() => executeServerPublication({
    plan,
    adapter,
    profileDefinitions: { profiles: [definition] },
    baseRegistry: { profiles: [catalogProfile] },
    clock: timestamps(["2026-08-25T12:05:03Z"])
  }), /candidate smoke failed/u);
  assert.equal(adapter.state.candidateAlias.functionVersion, "6");
  assert.equal(adapter.state.liveAlias.functionVersion, "7");
  assert.equal(adapter.state.status.publication.profile.deployment.artifact.version, "7");
  assert.equal(adapter.state.status.publication.profile.lastOutcome.outcome, "failed");
  assert.equal(adapter.state.status.publication.profile.lastOutcome.artifactSha256, plan.runtimeArtifact.sha256);
  assert.deepEqual(adapter.events.slice(-4), ["restore-candidate", "read-state", "put-status:failed", "verify-status:failed"]);
});

test("a concurrent status change prevents both promotion and stale failed-attempt reporting", async () => {
  const adapter = await fakeAdapter({ changeStatusBeforePromotion: true });
  await assert.rejects(() => executeServerPublication({
    plan,
    adapter,
    profileDefinitions: { profiles: [definition] },
    baseRegistry: { profiles: [catalogProfile] },
    clock: timestamps(["2026-08-25T12:05:03Z"])
  }), AggregateError);
  assert.equal(adapter.state.candidateAlias.functionVersion, "6");
  assert.equal(adapter.state.liveAlias.functionVersion, "7");
  assert.equal(adapter.state.status.versionId, "status-version-concurrent");
  assert.equal(adapter.events.includes("put-status:failed"), false);
});

test("a same-version alias rewrite after rollback prevents stale failed-attempt reporting", async () => {
  const adapter = await fakeAdapter({ candidateFailure: true, changeCandidateAfterRestore: true });
  await assert.rejects(() => executeServerPublication({
    plan,
    adapter,
    profileDefinitions: { profiles: [definition] },
    baseRegistry: { profiles: [catalogProfile] },
    clock: timestamps(["2026-08-25T12:05:03Z"])
  }), AggregateError);
  assert.equal(adapter.state.candidateAlias.functionVersion, "6");
  assert.equal(adapter.state.candidateAlias.revisionId, "candidate-concurrent-same-version");
  assert.equal(adapter.events.includes("put-status:failed"), false);
});

test("an ambiguous successful status write is discovered, rolled back, and converted to a failed outcome", async () => {
  const adapter = await fakeAdapter({ ambiguousStatusWrite: true });
  await assert.rejects(() => executeServerPublication({
    plan,
    adapter,
    profileDefinitions: { profiles: [definition] },
    baseRegistry: { profiles: [catalogProfile] },
    clock: timestamps(["2026-08-25T12:05:05Z", "2026-08-25T12:05:06Z"])
  }), /status response was lost/u);
  assert.equal(adapter.state.candidateAlias.functionVersion, "6");
  assert.equal(adapter.state.liveAlias.functionVersion, "7");
  assert.equal(adapter.state.status.publication.profile.lastOutcome.outcome, "failed");
  assert.equal(adapter.events.includes("restore-status"), true);
});

test("server handoff rejects extra files, the wrong target, and a non-JAR payload", () => {
  for (const mutate of [
    (manifest) => { manifest.target = "datomic-dynamodb"; },
    (manifest) => { manifest.files.push({ path: "payload/extra", bytes: 1, sha256: "e".repeat(64) }); },
    (manifest) => { manifest.files[0].path = "payload/function.zip"; }
  ]) {
    const artifactManifest = {
      schema: "eacl-demo.ordinary-artifact.v1", target: profileId, demoSha: "b".repeat(40), eaclSha: "c".repeat(40), artifactSha256: "d".repeat(64),
      files: [{ path: "payload/function.jar", bytes: 42, sha256: "8".repeat(64) }]
    };
    mutate(artifactManifest);
    assert.throws(() => createServerPublicationPlan({ target: profileId, artifactDirectory: "/tmp/a", artifactManifest, deploymentId: "deploy-8", deployedAt: "2026-08-25T12:05:00Z" }));
  }
});

test("server execution rejects nested plan drift before invoking an adapter", async () => {
  for (const mutate of [
    (candidate) => { candidate.source.extra = "unbound"; },
    (candidate) => { candidate.runtimeArtifact.key = "artifacts/datahike-s3/unbound.jar"; },
    (candidate) => { candidate.runtimeArtifact.source = "payload/function.jar"; },
    (candidate) => { candidate.deployedAt = "August 25 2026"; }
  ]) {
    const candidate = structuredClone(plan);
    mutate(candidate);
    await assert.rejects(() => executeServerPublication({
      plan: candidate,
      adapter: {},
      profileDefinitions: { profiles: [definition] },
      baseRegistry: { profiles: [catalogProfile] }
    }));
  }
});

async function fakeAdapter({ candidateFailure = false, changeStatusBeforePromotion = false, changeCandidateAfterRestore = false, ambiguousStatusWrite = false } = {}) {
  const publication = await enabledPublication();
  const state = {
    candidateAlias: alias("candidate", "6", "candidate-revision-6"),
    liveAlias: alias("live", "7", "live-revision-7"),
    liveVersion: version(baseDeployment),
    status: status(publication, "status-version-7", `"${"1".repeat(32)}"`)
  };
  const events = [];
  let reads = 0;
  let aliasSequence = 8;
  const adapter = {
    state,
    events,
    async assertFoundation() { events.push("assert-foundation"); },
    async readProfileState() {
      reads += 1;
      if (changeStatusBeforePromotion && reads === 2) {
        state.status = { ...state.status, versionId: "status-version-concurrent", etag: `"${"2".repeat(32)}"` };
      }
      if (changeCandidateAfterRestore && reads === 2) {
        state.candidateAlias = alias("candidate", state.candidateAlias.functionVersion, "candidate-concurrent-same-version");
      }
      events.push("read-state");
      return structuredClone(state);
    },
    async putRuntimeArtifact() { events.push("put-artifact"); return { bucket: "eacl-demo-artifacts", key: plan.runtimeArtifact.key, versionId: "artifact-version-8", sha256: plan.runtimeArtifact.sha256 }; },
    async publishVersion() { events.push("publish-version"); return { version: "8", runtimeArtifactSha256: plan.runtimeArtifact.sha256 }; },
    async moveAlias({ currentAlias, toVersion }) {
      const key = currentAlias.aliasName === "candidate" ? "candidateAlias" : "liveAlias";
      assert.equal(state[key].revisionId, currentAlias.revisionId);
      const moved = alias(currentAlias.aliasName, toVersion, `${currentAlias.aliasName}-revision-${aliasSequence++}`);
      state[key] = moved;
      if (key === "liveAlias") state.liveVersion = version(deployment({ version: toVersion, artifactSha256: plan.runtimeArtifact.sha256, demoSha: plan.source.demoSha, eaclSha: plan.source.eaclSha, deploymentId: plan.deploymentId, deployedAt: plan.deployedAt }));
      events.push(`move-${currentAlias.aliasName}`);
      return structuredClone(moved);
    },
    async restoreAlias({ currentAlias, priorAlias }) {
      const key = currentAlias.aliasName === "candidate" ? "candidateAlias" : "liveAlias";
      if (state[key].revisionId !== currentAlias.revisionId || state[key].functionVersion !== currentAlias.functionVersion) throw new Error("newer alias revision exists");
      state[key] = alias(priorAlias.aliasName, priorAlias.functionVersion, `${priorAlias.aliasName}-restored-${aliasSequence++}`);
      if (key === "liveAlias") state.liveVersion = version(baseDeployment);
      events.push(`restore-${currentAlias.aliasName}`);
      return structuredClone(state[key]);
    },
    async smokeCandidate({ deployment: candidate }) {
      events.push("smoke-candidate");
      if (candidateFailure) throw new Error("candidate smoke failed");
      return passingSmoke(candidate);
    },
    async smokeProduction({ deployment: candidate }) { events.push("smoke-production"); return passingProductionRecheck(candidate); },
    async putProfileStatus({ publication, body }) {
      const next = status(publication, `status-version-${publication.profile.lastOutcome.outcome}-${aliasSequence++}`, `"${String(aliasSequence).padStart(32, "0")}"`);
      next.body = body;
      state.status = next;
      events.push(`put-status:${publication.profile.lastOutcome.outcome}`);
      if (ambiguousStatusWrite && publication.profile.lastOutcome.outcome === "succeeded") throw new Error("status response was lost after the write");
      return structuredClone(next);
    },
    async restoreProfileStatusIfCurrent({ attempt, priorStatus }) {
      if (state.status.publicationId === priorStatus.publicationId && state.status.etag === priorStatus.etag) return structuredClone(state.status);
      if (state.status.publicationId !== attempt.publicationId) throw new Error("newer status exists");
      state.status = { ...structuredClone(priorStatus), versionId: `restored-${priorStatus.versionId}` };
      events.push("restore-status");
      return structuredClone(state.status);
    },
    async verifyPublicStatus({ publication }) { assert.equal(state.status.publication.publicationId, publication.publicationId); events.push(`verify-status:${publication.profile.lastOutcome.outcome}`); }
  };
  return adapter;
}

async function enabledPublication() {
  const profile = {
    ...definition,
    state: "enabled",
    reason: null,
    route: `/api/v1/${profileId}`,
    deployment: baseDeployment,
    lastOutcome: { outcome: "succeeded", attemptedDemoSha: baseDeployment.demoSha, attemptedEaclSha: baseDeployment.eaclSha, artifactSha256: baseDeployment.artifact.sha256, at: baseDeployment.deployedAt, message: "Initial deployment succeeded." }
  };
  return createProfilePublication({ profile, definition, publishedAt: "2026-08-25T12:00:01Z", gate: { kind: "initial-qualification", evidenceId: `sha256:${"9".repeat(64)}` } }, { cryptoImpl: webcrypto, now: "2026-08-25T12:01:00Z" });
}

function deployment({ version: artifactVersion, artifactSha256, demoSha, eaclSha = "c".repeat(40), deploymentId, deployedAt }) {
  return { demoSha, eaclSha, artifact: { kind: "lambda-version", sha256: artifactSha256, version: artifactVersion }, deploymentId, dataManifestSha256: "f".repeat(64), deployedAt };
}

function alias(aliasName, functionVersion, revisionId) { return { functionName: "eacl-demo-datahike-s3-prod", aliasName, functionVersion, revisionId }; }

function version(value) {
  return {
    functionName: "eacl-demo-datahike-s3-prod",
    functionVersion: value.artifact.version,
    codeSha256: value.artifact.sha256,
    environment: { EACL_DEMO_SHA: value.demoSha, EACL_CORE_SHA: value.eaclSha, EACL_ARTIFACT_SHA256: value.artifact.sha256, EACL_DEPLOYMENT_ID: value.deploymentId }
  };
}

function status(publication, versionId, etag) {
  return { bucket: "eacl-demo-static", key: `registry/profiles/${profileId}.json`, etag, versionId, publicationId: publication.publicationId, body: `${JSON.stringify(publication, null, 2)}\n`, publication };
}

async function passingSmoke(candidate) {
  const transport = transportFor(candidate);
  const times = timestamps(["2026-08-25T12:05:01Z", "2026-08-25T12:05:02Z"]);
  return runMergeSmoke({
    transport,
    expectedIdentity: identity(candidate),
    target: { kind: "staged-cloudfront", origin: "https://staging.demo.eacl.dev", path: `/api/v1/${profileId}`, profileId },
    allowedDemand: demand("user-1"), deniedDemand: demand("user-2"), clock: times
  });
}

async function passingProductionRecheck(candidate) {
  const times = timestamps(["2026-08-25T12:05:03Z", "2026-08-25T12:05:04Z"]);
  return runProductionRecheck({ transport: transportFor(candidate), expectedIdentity: identity(candidate), target: { kind: "production-cloudfront", origin: "https://demo.eacl.dev", path: `/api/v1/${profileId}`, profileId }, clock: times });
}

function transportFor(candidate) {
  const expected = identity(candidate);
  return { async request(operation, input) {
    const meta = { revision: "basis-1", requestId: `request-${operation}` };
    if (operation === "health") return { meta, data: { ready: true, status: "ready", identity: expected } };
    if (operation === "bootstrap") return { meta, data: { identity: expected } };
    if (operation === "authorize") return { meta, data: { allowed: input.subjectId === "user-1" } };
    return { meta, error: { code: "route-not-found", message: "The route is not available." } };
  } };
}

function identity(candidate) { return { profileId, demoSha: candidate.demoSha, eaclSha: candidate.eaclSha, artifactSha256: candidate.artifact.sha256, deploymentId: candidate.deploymentId, dataManifestSha256: candidate.dataManifestSha256 }; }
function demand(id) { return { subject: { type: "user", id }, resource: { type: "account", id: "account-0" }, permission: "admin" }; }
function timestamps(values) { let index = 0; return () => values[Math.min(index++, values.length - 1)]; }
