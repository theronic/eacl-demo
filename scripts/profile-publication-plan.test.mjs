import assert from "node:assert/strict";
import test from "node:test";

import { runMergeSmoke } from "../packages/qualification/src/merge-smoke.mjs";
import { createServerAliasPromotionPlan, createServerProfilePublicationPlan } from "./lib/profile-publication-plan.mjs";

const profile = { id: "datahike-s3", route: "/api/v1/datahike-s3" };
const identity = { profileId: profile.id, demoSha: "c".repeat(40), eaclSha: "d".repeat(40), artifactSha256: "e".repeat(64), deploymentId: "deploy-8", dataManifestSha256: "f".repeat(64) };
const deployment = { demoSha: identity.demoSha, eaclSha: identity.eaclSha, artifact: { kind: "lambda-version", sha256: identity.artifactSha256, version: "8" }, deploymentId: identity.deploymentId, dataManifestSha256: identity.dataManifestSha256, deployedAt: "2026-08-25T12:00:00Z" };
const publication = {
  publicationId: `sha256:${"a".repeat(64)}`,
  gate: { kind: "merge-smoke", evidenceId: `sha256:${"b".repeat(64)}` },
  profile: {
    ...profile,
    deployment,
    lastOutcome: { outcome: "succeeded", attemptedDemoSha: identity.demoSha, attemptedEaclSha: identity.eaclSha, artifactSha256: identity.artifactSha256, at: "2026-08-25T12:01:00Z", message: "passed" }
  }
};
const priorAlias = { functionName: "eacl-demo-datahike-s3", aliasName: "live", functionVersion: "7", revisionId: "alias-revision-7" };
const activeAlias = { ...priorAlias, functionVersion: "8", revisionId: "alias-revision-8" };
const currentStatus = { exists: true, bucket: "eacl-demo-static-123", key: "registry/profiles/datahike-s3.json", etag: `"${"1".repeat(32)}"`, versionId: "status-version-7", publicationId: `sha256:${"2".repeat(64)}` };
const bodySha256 = "3".repeat(64);
const smoke = await passingSmoke();

test("candidate staging evidence produces an exact alias-only promotion plan", () => {
  const plan = createServerAliasPromotionPlan({ profile, deployment, smoke, currentAlias: priorAlias });
  assert.equal(plan.profileId, profile.id);
  assert.deepEqual(plan.promotion.alias, { functionName: priorAlias.functionName, aliasName: "live", fromVersion: "7", toVersion: "8", revisionId: priorAlias.revisionId });
  assert.equal(plan.rollback.alias.restoreVersion, "7");
  assert.equal(plan.rollback.alias.onlyIfCurrentVersion, "8");
  assert.equal(plan.verifyAfterPromotion.kind, "production-cloudfront");
  assert.equal(JSON.stringify(plan).includes("registry/profiles"), false);
});

test("post-recheck publication writes one status key and retains executable alias rollback coordinates", () => {
  const plan = createServerProfilePublicationPlan({ publication, activeAlias, rollbackAlias: priorAlias, currentStatus, bodySha256 });
  assert.equal(plan.schema, "eacl-demo.profile-publication-plan.v2");
  assert.equal(plan.profileId, profile.id);
  assert.equal(plan.promotion.alias, null);
  assert.deepEqual(plan.preconditions.statusObject, { ifMatch: currentStatus.etag, ifNoneMatch: null });
  assert.equal(plan.publicObject.key, "registry/profiles/datahike-s3.json");
  assert.equal(plan.publicObject.bodySha256, bodySha256);
  assert.deepEqual(plan.rollback.alias, { functionName: activeAlias.functionName, aliasName: "live", restoreVersion: "7", onlyIfCurrentVersion: "8", revisionId: activeAlias.revisionId });
  assert.equal(plan.rollback.statusObject.versionId, currentStatus.versionId);
  assert.equal(JSON.stringify(plan).includes("datahike-dynamodb"), false);
});

test("ordinary publication refuses a first status object that would require delete-based rollback", () => {
  assert.throws(() => createServerProfilePublicationPlan({ publication, activeAlias, rollbackAlias: priorAlias, currentStatus: { exists: false, bucket: currentStatus.bucket, key: currentStatus.key, etag: null, versionId: null, publicationId: null }, bodySha256 }), /existing rollbackable status/u);
});

test("wrong keys, alias drift, incomplete rollback coordinates, and cross-gated outcomes are rejected", () => {
  const cases = [
    { publication, activeAlias, rollbackAlias: priorAlias, currentStatus: { ...currentStatus, key: "registry/profiles/datomic-dynamodb.json" }, bodySha256 },
    { publication, activeAlias, rollbackAlias: priorAlias, currentStatus: { ...currentStatus, versionId: null }, bodySha256 },
    { publication, activeAlias: { ...activeAlias, functionVersion: "9" }, rollbackAlias: priorAlias, currentStatus, bodySha256 },
    { publication, activeAlias, rollbackAlias: { ...priorAlias, functionName: "another-function" }, currentStatus, bodySha256 },
    { publication: { ...publication, gate: { kind: "failure-outcome", evidenceId: null } }, activeAlias, rollbackAlias: priorAlias, currentStatus, bodySha256 },
    { publication, activeAlias, rollbackAlias: priorAlias, currentStatus, bodySha256: "invalid" }
  ];
  for (const input of cases) assert.throws(() => createServerProfilePublicationPlan(input));
  assert.throws(() => createServerAliasPromotionPlan({ profile, deployment, smoke, currentAlias: activeAlias }), /already active/u);
});

test("a failed attempt writes status only after the healthy alias is retained or restored", () => {
  const failed = structuredClone(publication);
  failed.gate = { kind: "failure-outcome", evidenceId: null };
  failed.profile.deployment = { ...deployment, artifact: { ...deployment.artifact, version: "7" } };
  failed.profile.lastOutcome.outcome = "failed";
  const plan = createServerProfilePublicationPlan({ publication: failed, activeAlias: priorAlias, rollbackAlias: null, currentStatus, bodySha256 });
  assert.equal(plan.promotion.alias, null);
  assert.equal(plan.rollback.alias, null);
  assert.throws(() => createServerProfilePublicationPlan({ publication: failed, activeAlias: priorAlias, rollbackAlias: activeAlias, currentStatus, bodySha256 }), /failed publication/u);
});

async function passingSmoke() {
  const transport = { async request(operation, input) {
    const meta = { revision: "basis-1", requestId: `request-${operation}` };
    if (operation === "health") return { meta, data: { ready: true, status: "ready", identity } };
    if (operation === "bootstrap") return { meta, data: { identity } };
    if (operation === "authorize") return { meta, data: { allowed: input.subjectId === "user-1" } };
    return { meta, error: { code: "route-not-found", message: "The route is not available." } };
  } };
  const times = ["2026-08-25T12:00:01Z", "2026-08-25T12:00:02Z"];
  let index = 0;
  return runMergeSmoke({
    transport,
    expectedIdentity: identity,
    target: { kind: "staged-cloudfront", origin: "https://staging.demo.eacl.dev", path: profile.route, profileId: profile.id },
    allowedDemand: { subject: { type: "user", id: "user-1" }, resource: { type: "account", id: "account-0" }, permission: "admin" },
    deniedDemand: { subject: { type: "user", id: "user-2" }, resource: { type: "account", id: "account-0" }, permission: "admin" },
    clock: () => times[index++]
  });
}
