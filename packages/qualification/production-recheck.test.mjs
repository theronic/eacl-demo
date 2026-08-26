import assert from "node:assert/strict";
import test from "node:test";

import { runProductionRecheck, validateProductionRecheck } from "./src/production-recheck.mjs";

const profileId = "datahike-s3";
const identity = { profileId, demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deploy-1", dataManifestSha256: "d".repeat(64) };
const target = { kind: "production-cloudfront", origin: "https://demo.eacl.dev", path: "/api/v1/datahike-s3", profileId };
const deployment = { demoSha: identity.demoSha, eaclSha: identity.eaclSha, artifact: { kind: "lambda-version", sha256: identity.artifactSha256, version: "7" }, deploymentId: identity.deploymentId, dataManifestSha256: identity.dataManifestSha256, deployedAt: "2026-08-25T12:00:00Z" };

test("post-promotion recheck is exactly production health and bootstrap identity", async () => {
  const operations = [];
  const transport = { async request(operation) {
    operations.push(operation);
    const meta = { operation, identity };
    if (operation === "health") return { ok: true, meta, data: { ready: true, status: "ready", identity } };
    if (operation === "bootstrap") return { ok: true, meta, data: { identity } };
    throw new Error(`unexpected operation ${operation}`);
  } };
  const times = ["2026-08-25T12:00:01Z", "2026-08-25T12:00:02Z"];
  let index = 0;
  const report = await runProductionRecheck({ transport, expectedIdentity: identity, target, clock: () => times[index++] });
  assert.equal(validateProductionRecheck(report, { profile: { id: profileId, route: target.path }, deployment }), report);
  assert.deepEqual(operations, ["health", "bootstrap"]);
  assert.deepEqual(report.cases.map(({ id }) => id), ["health", "bootstrap-identity"]);
});

test("wrong route kind, identity drift, failed readiness, and tampering fail closed", async () => {
  const drift = { ...identity, artifactSha256: "e".repeat(64) };
  const transport = { async request(operation) {
    const meta = { operation, identity: operation === "health" ? drift : identity };
    if (operation === "health") return { ok: true, meta, data: { ready: false, status: "starting", identity: drift } };
    return { ok: true, meta, data: { identity } };
  } };
  const times = ["2026-08-25T12:00:01Z", "2026-08-25T12:00:02Z"];
  let index = 0;
  const report = await runProductionRecheck({ transport, expectedIdentity: identity, target, clock: () => times[index++] });
  assert.equal(report.result, "fail");
  assert.deepEqual(report.cases.filter(({ status }) => status === "failed").map(({ id }) => id), ["health"]);
  assert.throws(() => validateProductionRecheck(report, { profile: { id: profileId, route: target.path }, deployment }), /did not pass/u);
  for (const mutate of [
    (candidate) => { candidate.target.kind = "staged-cloudfront"; },
    (candidate) => { candidate.target.path = "/api/v1/datomic-dynamodb"; },
    (candidate) => { candidate.identity.demoSha = "f".repeat(40); }
  ]) {
    const candidate = structuredClone(report);
    mutate(candidate);
    assert.throws(() => validateProductionRecheck(candidate, { profile: { id: profileId, route: target.path }, deployment, requirePassing: false }));
  }
});
