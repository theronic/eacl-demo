import assert from "node:assert/strict";
import test from "node:test";

import { runMergeSmoke, validateMergeSmoke } from "./src/merge-smoke.mjs";

const identity = { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deploy-1", dataManifestSha256: "d".repeat(64) };
const allowedDemand = { subject: { type: "user", id: "user-1" }, resource: { type: "account", id: "account-1" }, permission: "read" };
const deniedDemand = { subject: { type: "user", id: "user-2" }, resource: { type: "account", id: "account-1" }, permission: "read" };
const target = { kind: "staged-cloudfront", origin: "https://staging.demo.eacl.dev", path: "/api/v1/datahike-s3", profileId: identity.profileId };
const deployment = { demoSha: identity.demoSha, eaclSha: identity.eaclSha, artifact: { kind: "lambda-version", sha256: identity.artifactSha256, version: "7" }, deploymentId: identity.deploymentId, dataManifestSha256: identity.dataManifestSha256, deployedAt: "2026-08-25T12:00:00Z" };
const times = ["2026-08-25T12:00:01Z", "2026-08-25T12:00:02Z"];

test("merge smoke is exactly health, identity, allow, deny, and mutation denial", async () => {
  const operations = [];
  const transport = {
    async request(operation, input) {
      operations.push(operation);
      const meta = { revision: "basis-1", requestId: `request-${operation}` };
      if (operation === "health") return { meta, data: { ready: true, status: "ready", identity } };
      if (operation === "bootstrap") return { meta, data: { identity } };
      if (operation === "authorize") return { meta, data: { allowed: input.subjectId === "user-1" } };
      if (operation === "seed") return { meta, error: { code: "route-not-found", message: "The route is not available." } };
      throw new Error(`unexpected operation ${operation}`);
    }
  };
  let index = 0;
  const report = await runMergeSmoke({ transport, expectedIdentity: identity, target, allowedDemand, deniedDemand, clock: () => times[index++] });
  assert.equal(report.result, "pass");
  assert.equal(validateMergeSmoke(report, { profile: { id: identity.profileId, route: target.path }, deployment }), report);
  assert.match(report.evidenceId, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(operations, ["health", "bootstrap", "authorize", "authorize", "seed"]);
  assert.deepEqual(report.cases.map(({ id }) => id), ["health", "bootstrap-identity", "allowed-authorization", "denied-authorization", "mutation-denial"]);
});

test("identity drift and an exposed mutation fail merge smoke without adding deep suites", async () => {
  const drift = { ...identity, artifactSha256: "e".repeat(64) };
  const transport = {
    async request(operation, input) {
      const meta = { revision: "basis-1", requestId: `request-${operation}` };
      if (operation === "health") return { meta, data: { ready: true, status: "ready", identity: drift } };
      if (operation === "bootstrap") return { meta, data: { identity } };
      if (operation === "authorize") return { meta, data: { allowed: input.subjectId === "user-1" } };
      return { meta, data: { seeded: true } };
    }
  };
  let index = 0;
  const report = await runMergeSmoke({ transport, expectedIdentity: identity, target, allowedDemand, deniedDemand, clock: () => times[index++] });
  assert.equal(report.result, "fail");
  assert.deepEqual(report.cases.filter(({ status }) => status === "failed").map(({ id }) => id), ["health", "mutation-denial"]);
});

test("local targets, route drift, stale timestamps, tampering, and replay against another deployment fail closed", async () => {
  const transport = { async request(operation, input) {
    const meta = { revision: "basis-1", requestId: `request-${operation}` };
    if (operation === "health") return { meta, data: { ready: true, status: "ready", identity } };
    if (operation === "bootstrap") return { meta, data: { identity } };
    if (operation === "authorize") return { meta, data: { allowed: input.subjectId === "user-1" } };
    return { meta, error: { code: "route-not-found", message: "The route is not available." } };
  } };
  let index = 0;
  const report = await runMergeSmoke({ transport, expectedIdentity: identity, target, allowedDemand, deniedDemand, clock: () => times[index++] });
  for (const mutate of [
    (candidate) => { candidate.target.kind = "local"; },
    (candidate) => { candidate.target.path = "/api/v1/datomic-dynamodb"; },
    (candidate) => { candidate.completedAt = "2026-08-25T11:59:59Z"; },
    (candidate) => { candidate.identity.artifactSha256 = "e".repeat(64); }
  ]) {
    const candidate = structuredClone(report);
    mutate(candidate);
    assert.throws(() => validateMergeSmoke(candidate, { profile: { id: identity.profileId, route: target.path }, deployment }));
  }
});
