import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { authorizeComputePreviewExecution, authorizePreviewExecution, createAuthorizedComputePreview, createAuthorizedPreview, validateInitialStatefulAuthorization } from "./authorization.mjs";

const policy = JSON.parse(await readFile(new URL("../../infra/data/authorized-initial-stateful-operations.v1.json", import.meta.url), "utf8"));
const capPolicy = JSON.parse(await readFile(new URL("../../infra/data/dynamodb-cap-policy.v1.json", import.meta.url), "utf8"));
const digest = (character) => `sha256:${character.repeat(64)}`;
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);
const contentDigest = (value) => `sha256:${createHash("sha256").update(`${stableJson(value)}\n`).digest("hex")}`;
const now = () => new Date("2026-08-25T12:00:00.000Z");
const request = {
  accountId: "843761893873",
  region: "us-east-1",
  repositoryId: "1345904214",
  ref: "refs/heads/production",
  profileId: "datomic-dynamodb",
  operation: "seed",
  tableName: "eacl-demo-datomic-fixture-v1-green",
  generationId: "fixture-v1-green",
  fixtureManifestDigest: digest("a"),
  logicalResourceCount: 1_000_000,
  costControls: { verified: true, evidenceId: digest("b"), verifiedAt: "2026-08-25T11:50:00Z", capPolicyDigest: contentDigest(capPolicy) },
  telegramGate: { verified: true, evidenceId: digest("c"), verifiedAt: "2026-08-25T11:55:00Z", notificationTopicArn: "arn:aws:sns:us-east-1:843761893873:eacl-demo-alerts" },
  executionArtifacts: {
    artifactBucket: "eacl-demo-artifacts-example",
    seedArtifactKey: `artifacts/datomic-dynamodb/seed/${"1".repeat(64)}/seed.jar`,
    seedArtifactVersion: "seed-version-1",
    seedArtifactSha256: "1".repeat(64),
    fixtureStreamKey: `artifacts/datomic-dynamodb/fixtures/${"2".repeat(64)}/fixture-1000000.batches.jsonl.gz`,
    fixtureStreamVersion: "fixture-version-1",
    fixtureStreamSha256: "2".repeat(64),
    seedEvidenceKey: "evidence/datomic-dynamodb/fixture-v1-green/seed-evidence.jsonl",
    datomicDistributionUrl: "https://datomic-pro-downloads.s3.amazonaws.com/1.0.7705/datomic-pro-1.0.7705.zip",
    datomicDistributionSha256: "a17c2603b893dfb0d998a35a032a7295736d234d32937222c8ec21d81a1b8c7e",
    datomicDistributionBytes: 272642957,
    datomicDistributionRoot: "datomic-pro-1.0.7705"
  },
  temporaryCompute: {
    purpose: "datomic-transactor", amiId: "ami-0123456789abcdef0", instanceType: "m7i.2xlarge", vcpus: 8, memoryGiB: 32,
    runtimeMinutes: 180, rootVolumeGiB: 40, forecastUsd: 4.5, subnetId: "subnet-0123456789abcdef0", securityGroupId: "sg-0123456789abcdef0",
    instanceProfileArn: "arn:aws:iam::843761893873:instance-profile/eacl-demo-datomic-seed-fixture-v1-green", inboundRules: [], metadataTokens: "required",
    associatePublicIpAddress: false, elasticIpAllocationId: null, expiresAtTag: "2026-08-25T15:00:00.000Z"
  }
};

test("the recorded authorization is closed to the two approved million-resource generations", () => {
  assert.equal(validateInitialStatefulAuthorization(policy), policy);
  assert.deepEqual(policy.scope.durableGenerations.map(({ profileId }) => profileId), ["datahike-dynamodb", "datomic-dynamodb"]);
  assert.deepEqual(policy.scope.durableGenerations.map(({ tableName, generationId }) => ({ tableName, generationId })), [
    { tableName: "eacl-demo-datahike-fixture-v1-green", generationId: "fixture-v1-green" },
    { tableName: "eacl-demo-datomic-fixture-v1-green", generationId: "fixture-v1-green" }
  ]);
  assert.equal(policy.scope.durableGenerations.every(({ maximumNewGenerations, logicalResourceCount }) => maximumNewGenerations === 1 && logicalResourceCount === 1_000_000), true);
  assert.equal(policy.explicitlyExcluded.includes("ordinary-main-branch-deployment"), true);
});

test("execution requires a fresh immutable exact-target preview and typed confirmation", () => {
  const preview = createAuthorizedPreview(policy, request, { now });
  assert.match(preview.previewId, /^sha256:[0-9a-f]{64}$/u);
  assert.match(preview.authorizationPolicyDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(preview.confirmation, new RegExp(`^EXECUTE:seed:${request.tableName}:${request.generationId}:sha256:`));
  assert.deepEqual(preview.cleanup, { terminateBy: "launch-result-instance-id", noninteractive: true, verify: policy.requiredAfterTemporaryCompute });
  assert.equal(authorizePreviewExecution(policy, preview, preview.confirmation, { now }).authorized, true);
  assert.throws(() => authorizePreviewExecution(policy, preview, "EXECUTE:something-else", { now }), /confirmation/u);
  assert.throws(() => authorizePreviewExecution(policy, { ...preview, tableName: "other" }, preview.confirmation, { now }), /modified/u);
  assert.throws(() => authorizePreviewExecution(policy, preview, preview.confirmation, { now: () => new Date("2026-08-25T12:31:00.000Z") }), /expired/u);
  assert.throws(() => authorizePreviewExecution({ ...policy, explicitlyExcluded: [...policy.explicitlyExcluded, "changed-after-preview"] }, preview, preview.confirmation, { now }), /policy changed/u);
});

test("scope, cost, network, and cleanup expansions fail closed", () => {
  for (const changed of [
    { ...request, accountId: "000000000000" },
    { ...request, region: "eu-west-1" },
    { ...request, tableName: "unrelated-table" },
    { ...request, tableName: "eacl-demo-datomic-fixture-v2-blue", generationId: "fixture-v2-blue" },
    { ...request, logicalResourceCount: 1_000_001 },
    { ...request, operation: "delete" },
    { ...request, executionArtifacts: { ...request.executionArtifacts, seedArtifactSha256: "3".repeat(64) } },
    { ...request, executionArtifacts: { ...request.executionArtifacts, fixtureStreamVersion: "bad\nversion" } },
    { ...request, executionArtifacts: { ...request.executionArtifacts, seedEvidenceKey: "evidence/other.jsonl" } },
    { ...request, costControls: { ...request.costControls, verifiedAt: "2026-08-25T11:29:59Z" } },
    { ...request, costControls: { ...request.costControls, capPolicyDigest: "not-a-digest" } },
    { ...request, telegramGate: { ...request.telegramGate, verifiedAt: "2026-08-25T12:00:01Z" } },
    { ...request, telegramGate: { ...request.telegramGate, notificationTopicArn: "arn:aws:sns:eu-west-1:843761893873:eacl-demo-alerts" } },
    { ...request, temporaryCompute: { ...request.temporaryCompute, inboundRules: [{ port: 22 }] } },
    { ...request, temporaryCompute: { ...request.temporaryCompute, associatePublicIpAddress: true } },
    { ...request, temporaryCompute: { ...request.temporaryCompute, instanceProfileArn: "arn:aws:iam::843761893873:instance-profile/some-other-role" } },
    { ...request, temporaryCompute: { ...request.temporaryCompute, forecastUsd: 15.01 } },
    { ...request, temporaryCompute: { ...request.temporaryCompute, vcpus: 16 } }
  ]) assert.throws(() => createAuthorizedPreview(policy, changed, { now }));
  assert.throws(() => validateInitialStatefulAuthorization({ ...policy, authorizedAccountId: "000000000000" }), /identity/u);
  assert.throws(() => validateInitialStatefulAuthorization({ ...policy, scope: { ...policy.scope, durableGenerations: policy.scope.durableGenerations.map((generation, index) => index ? generation : { ...generation, tableName: "eacl-demo-datahike-fixture-v2-blue", generationId: "fixture-v2-blue" }) } }), /approved target/u);
});

test("Jank build compute has its own exact content-addressed authorization", () => {
  const computeRequest = {
    accountId: request.accountId,
    region: request.region,
    repositoryId: request.repositoryId,
    ref: request.ref,
    profileId: "jank-memory",
    operation: "launch-temporary-compute",
    workloadDigest: digest("d"),
    costControls: request.costControls,
    telegramGate: request.telegramGate,
    temporaryCompute: {
      ...request.temporaryCompute,
      purpose: "jank-build",
      instanceType: "c7i.2xlarge",
      instanceProfileArn: "arn:aws:iam::843761893873:instance-profile/eacl-demo-jank-build",
      expiresAtTag: "2026-08-25T14:00:00.000Z"
    }
  };
  const preview = createAuthorizedComputePreview(policy, computeRequest, { now });
  assert.match(preview.confirmation, new RegExp(`^EXECUTE:launch-temporary-compute:jank-memory:${computeRequest.workloadDigest}:sha256:`));
  assert.equal(authorizeComputePreviewExecution(policy, preview, preview.confirmation, { now }).authorized, true);
  assert.throws(() => createAuthorizedComputePreview(policy, { ...computeRequest, profileId: "datomic-dynamodb" }, { now }), /profile authorization/u);
  assert.throws(() => createAuthorizedComputePreview(policy, { ...computeRequest, temporaryCompute: { ...computeRequest.temporaryCompute, purpose: "datomic-transactor" } }, { now }), /durable generation preview/u);
  assert.throws(() => createAuthorizedComputePreview(policy, { ...computeRequest, temporaryCompute: { ...computeRequest.temporaryCompute, expiresAtTag: "2026-08-26T14:00:00.000Z" } }, { now }), /safety topology/u);
  assert.throws(() => createAuthorizedComputePreview(policy, { ...computeRequest, temporaryCompute: { ...computeRequest.temporaryCompute, instanceProfileArn: "arn:aws:iam::000000000000:instance-profile/eacl-demo-jank-build" } }, { now }), /target/u);
});
