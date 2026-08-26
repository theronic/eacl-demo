import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAuthorizedComputePreview, createAuthorizedPreview } from "./authorization.mjs";
import { verifyPostTemporaryComputeEvidence } from "./post-compute.mjs";

const policy = JSON.parse(await readFile(new URL("../../infra/data/authorized-initial-stateful-operations.v1.json", import.meta.url), "utf8"));
const caps = JSON.parse(await readFile(new URL("../../infra/data/dynamodb-cap-policy.v1.json", import.meta.url), "utf8"));
const now = () => new Date("2026-08-25T12:10:00.000Z");
const sha = (character) => `sha256:${character.repeat(64)}`;
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);
const contentDigest = (value) => `sha256:${createHash("sha256").update(`${stableJson(value)}\n`).digest("hex")}`;
const costGate = (character) => ({ verified: true, evidenceId: sha(character), verifiedAt: "2026-08-25T11:55:00Z", capPolicyDigest: contentDigest(caps) });
const telegramGate = (character) => ({ verified: true, evidenceId: sha(character), verifiedAt: "2026-08-25T11:55:00Z", notificationTopicArn: "arn:aws:sns:us-east-1:843761893873:eacl-demo-alerts" });
const executionArtifacts = {
  artifactBucket: "eacl-demo-artifacts-example",
  seedArtifactKey: `artifacts/datomic-dynamodb/seed/${"1".repeat(64)}/seed.jar`, seedArtifactVersion: "seed-version-1", seedArtifactSha256: "1".repeat(64),
  fixtureStreamKey: `artifacts/datomic-dynamodb/fixtures/${"2".repeat(64)}/fixture-1000000.batches.jsonl.gz`, fixtureStreamVersion: "fixture-version-1", fixtureStreamSha256: "2".repeat(64),
  seedEvidenceKey: "evidence/datomic-dynamodb/fixture-v1-green/seed-evidence.jsonl",
  datomicDistributionUrl: "https://datomic-pro-downloads.s3.amazonaws.com/1.0.7705/datomic-pro-1.0.7705.zip", datomicDistributionSha256: "a17c2603b893dfb0d998a35a032a7295736d234d32937222c8ec21d81a1b8c7e", datomicDistributionBytes: 272642957, datomicDistributionRoot: "datomic-pro-1.0.7705"
};
const temporaryCompute = {
  purpose: "datomic-transactor", amiId: "ami-0123456789abcdef0", instanceType: "m7i.2xlarge", vcpus: 8, memoryGiB: 32,
  runtimeMinutes: 180, rootVolumeGiB: 40, forecastUsd: 4.5, subnetId: "subnet-0123456789abcdef0", securityGroupId: "sg-0123456789abcdef0",
  instanceProfileArn: "arn:aws:iam::843761893873:instance-profile/eacl-demo-datomic-seed-fixture-v1-green", inboundRules: [], metadataTokens: "required",
  associatePublicIpAddress: false, elasticIpAllocationId: null, expiresAtTag: "2026-08-25T15:00:00.000Z"
};
const preview = createAuthorizedPreview(policy, {
  accountId: policy.authorizedAccountId, region: policy.authorizedRegion, repositoryId: policy.authorizedRepositoryId, ref: policy.authorizedRef,
  profileId: "datomic-dynamodb", operation: "seed", tableName: "eacl-demo-datomic-fixture-v1-green", generationId: "fixture-v1-green",
  fixtureManifestDigest: sha("a"), logicalResourceCount: 1_000_000, costControls: costGate("b"), telegramGate: telegramGate("c"), temporaryCompute, executionArtifacts
}, { now: () => new Date("2026-08-25T12:00:00.000Z") });
const launch = {
  schema: "eacl-demo.temporary-compute-launch-result.v1", previewId: preview.previewId, accountId: preview.accountId, region: preview.region,
  instanceId: "i-0123456789abcdef0", rootVolumeId: "vol-0123456789abcdef0", elasticIpAllocationId: null,
  temporaryRoleArn: "arn:aws:iam::843761893873:role/eacl-demo-datomic-seed-fixture-v1-green", instanceProfileArn: temporaryCompute.instanceProfileArn,
  launchedAt: "2026-08-25T12:01:00.000Z",
  tags: { Project: "eacl-demo", Lifecycle: "temporary", ManagedBy: "eacl-demo-temp-watchdog", Owner: "theronic/eacl-demo", Purpose: "datomic-transactor", AuthorizationId: preview.previewId, ExpiresAt: temporaryCompute.expiresAtTag }
};
const topic = "arn:aws:sns:us-east-1:843761893873:eacl-demo-alerts";
const alarmKinds = ["read-cap-70", "read-cap-90", "write-cap-70", "write-cap-90", "read-throttle", "write-throttle", "read-cap-drift", "write-cap-drift"];
const evidence = {
  schema: "eacl-demo.post-temporary-compute-evidence.v1", previewId: preview.previewId, accountId: preview.accountId, region: preview.region, collectedAt: "2026-08-25T12:09:00.000Z",
  tableCostControls: [{
    profileId: preview.profileId, tableName: preview.tableName, phase: "seed", billingMode: "PAY_PER_REQUEST", tableStatus: "ACTIVE",
    maxReadRequestUnits: 250, maxWriteRequestUnits: 200, deletionProtectionEnabled: true, pointInTimeRecoveryStatus: "ENABLED", alarmTopicArn: topic,
    alarms: alarmKinds.map((kind) => ({ kind, alarmName: `${preview.tableName}-${kind}`, stateValue: "OK", actionsEnabled: true, alarmActions: [topic], okActions: [] }))
  }],
  cleanup: {
    terminationRequestedForInstanceId: launch.instanceId, terminationRequestedAt: "2026-08-25T12:05:00.000Z", instanceState: "terminated", instanceStateObservedAt: "2026-08-25T12:08:00.000Z", matchingNonterminatedInstanceIds: [],
    rootVolumeId: launch.rootVolumeId, rootVolumeState: "deleted", matchingBillableVolumeIds: [], matchingElasticAddressAllocationIds: [],
    temporaryRoleArn: launch.temporaryRoleArn, instanceProfileArn: launch.instanceProfileArn, roleSessionsRevokedAt: "2026-08-25T12:06:00.000Z", temporaryRoleExists: false, instanceProfileExists: false, temporaryRoleAttachedPolicyCount: 0, temporaryRoleInlinePolicyCount: 0
  }
};

test("exact fresh evidence proves table controls and complete temporary-compute cleanup", () => {
  const verified = verifyPostTemporaryComputeEvidence(policy, caps, preview, launch, evidence, { now });
  assert.equal(verified.verified, true);
  assert.equal(verified.previewId, preview.previewId);
  assert.match(verified.evidenceDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("cost, identity, freshness, and cleanup loopholes fail closed", () => {
  const mutations = [
    { ...evidence, collectedAt: "2026-08-25T11:00:00.000Z" },
    { ...evidence, tableCostControls: [{ ...evidence.tableCostControls[0], maxWriteRequestUnits: 201 }] },
    { ...evidence, tableCostControls: [{ ...evidence.tableCostControls[0], alarms: evidence.tableCostControls[0].alarms.slice(1) }] },
    { ...evidence, tableCostControls: [{ ...evidence.tableCostControls[0], alarms: evidence.tableCostControls[0].alarms.map((alarm, index) => index ? alarm : { ...alarm, stateValue: "ALARM" }) }] },
    { ...evidence, tableCostControls: [{ ...evidence.tableCostControls[0], alarms: evidence.tableCostControls[0].alarms.map((alarm, index) => index ? alarm : { ...alarm, okActions: [topic] }) }] },
    { ...evidence, cleanup: { ...evidence.cleanup, terminationRequestedForInstanceId: "i-aaaaaaaaaaaaaaaaa" } },
    { ...evidence, cleanup: { ...evidence.cleanup, rootVolumeId: "vol-aaaaaaaaaaaaaaaaa" } },
    { ...evidence, cleanup: { ...evidence.cleanup, matchingBillableVolumeIds: [launch.rootVolumeId] } },
    { ...evidence, cleanup: { ...evidence.cleanup, temporaryRoleExists: true } },
    { ...evidence, cleanup: { ...evidence.cleanup, roleSessionsRevokedAt: "2026-08-25T12:11:00.000Z" } }
  ];
  for (const changed of mutations) assert.throws(() => verifyPostTemporaryComputeEvidence(policy, caps, preview, launch, changed, { now }));
  const forgedRequest = { ...preview, tableName: "eacl-demo-datomic-fixture-v2-blue", generationId: "fixture-v2-blue" };
  const { schema, previewId: _oldId, confirmation: _oldConfirmation, cleanup, ...payload } = forgedRequest;
  const forgedId = contentDigest(payload);
  const forged = { schema, previewId: forgedId, ...payload, confirmation: `EXECUTE:seed:${payload.tableName}:${payload.generationId}:${forgedId}`, cleanup };
  assert.throws(() => verifyPostTemporaryComputeEvidence(policy, caps, forged, { ...launch, previewId: forgedId, tags: { ...launch.tags, AuthorizationId: forgedId } }, { ...evidence, previewId: forgedId }, { now }), /approved target|outside authorization/u);
});

test("standalone Jank build evidence cannot smuggle in a durable table", () => {
  const jankCompute = { ...temporaryCompute, purpose: "jank-build", instanceProfileArn: "arn:aws:iam::843761893873:instance-profile/eacl-demo-jank-build", expiresAtTag: "2026-08-25T14:00:00.000Z" };
  const jankPreview = createAuthorizedComputePreview(policy, {
    accountId: policy.authorizedAccountId, region: policy.authorizedRegion, repositoryId: policy.authorizedRepositoryId, ref: policy.authorizedRef,
    profileId: "jank-memory", operation: "launch-temporary-compute", workloadDigest: sha("d"), costControls: costGate("b"), telegramGate: telegramGate("c"), temporaryCompute: jankCompute
  }, { now: () => new Date("2026-08-25T12:00:00.000Z") });
  const jankLaunch = { ...launch, previewId: jankPreview.previewId, instanceProfileArn: jankCompute.instanceProfileArn, temporaryRoleArn: "arn:aws:iam::843761893873:role/eacl-demo-jank-build", tags: { ...launch.tags, Purpose: "jank-build", AuthorizationId: jankPreview.previewId, ExpiresAt: jankCompute.expiresAtTag } };
  const jankEvidence = { ...evidence, previewId: jankPreview.previewId, tableCostControls: [], cleanup: { ...evidence.cleanup, temporaryRoleArn: jankLaunch.temporaryRoleArn, instanceProfileArn: jankLaunch.instanceProfileArn } };
  assert.equal(verifyPostTemporaryComputeEvidence(policy, caps, jankPreview, jankLaunch, jankEvidence, { now }).verified, true);
  assert.throws(() => verifyPostTemporaryComputeEvidence(policy, caps, jankPreview, jankLaunch, { ...jankEvidence, tableCostControls: evidence.tableCostControls }, { now }), /unrelated table/u);
});
