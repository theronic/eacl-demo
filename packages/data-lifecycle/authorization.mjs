import { createHash } from "node:crypto";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ACCOUNT = /^[0-9]{12}$/u;
const REGION = /^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]$/u;
const PROFILE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GENERATION = /^[a-z0-9-]{3,80}$/u;
const AUTHORIZED_ACCOUNT_ID = "843761893873";
const AUTHORIZED_REGION = "us-east-1";
const AUTHORIZED_REPOSITORY_ID = "1345904214";
const AUTHORIZED_REF = "refs/heads/production";
const S3_VERSION = /^[A-Za-z0-9._~+/=-]{1,1024}$/u;
const AUTHORIZED_DURABLE_TARGETS = new Map([
  ["datahike-dynamodb", { tableName: "eacl-demo-datahike-fixture-v1-green", generationId: "fixture-v1-green" }],
  ["datomic-dynamodb", { tableName: "eacl-demo-datomic-fixture-v1-green", generationId: "fixture-v1-green" }]
]);

export function validateInitialStatefulAuthorization(policy) {
  exactKeys(policy, ["schema", "authorizationStatus", "authorizedAccountId", "authorizedRegion", "authorizedRepositoryId", "authorizedRef", "scope", "requiredBeforeExecution", "requiredAfterTemporaryCompute", "explicitlyExcluded"], "authorization policy");
  if (policy.schema !== "eacl-demo.initial-stateful-authorization.v1" || policy.authorizationStatus !== "user-approved") throw new Error("stateful authorization is not active");
  if (!ACCOUNT.test(policy.authorizedAccountId) || !REGION.test(policy.authorizedRegion) || policy.authorizedAccountId !== AUTHORIZED_ACCOUNT_ID || policy.authorizedRegion !== AUTHORIZED_REGION || policy.authorizedRepositoryId !== AUTHORIZED_REPOSITORY_ID || policy.authorizedRef !== AUTHORIZED_REF) throw new Error("stateful authorization identity is invalid");
  exactKeys(policy.scope, ["durableGenerations", "temporaryCompute"], "authorization scope");
  if (!Array.isArray(policy.scope.durableGenerations) || policy.scope.durableGenerations.length !== 2) throw new Error("authorization must name exactly two durable profiles");
  const profiles = new Set();
  for (const generation of policy.scope.durableGenerations) {
    exactKeys(generation, ["profileId", "tableName", "generationId", "maximumNewGenerations", "logicalResourceCount", "operations"], "durable generation authorization");
    if (!PROFILE.test(generation.profileId) || profiles.has(generation.profileId)) throw new Error("durable profile authorization is invalid");
    profiles.add(generation.profileId);
    if (generation.maximumNewGenerations !== 1 || generation.logicalResourceCount !== 1_000_000 || !Array.isArray(generation.operations) || generation.operations.join(",") !== "create-table,seed,verify,backup,publish") throw new Error("durable generation scope expanded");
    if (!/^eacl-demo-(?:datahike|datomic)-[a-z0-9-]{3,80}$/u.test(generation.tableName) || !GENERATION.test(generation.generationId) || !generation.tableName.endsWith(generation.generationId)) throw new Error("durable generation target is invalid");
    const expected = AUTHORIZED_DURABLE_TARGETS.get(generation.profileId);
    if (!expected || generation.tableName !== expected.tableName || generation.generationId !== expected.generationId) throw new Error("durable generation differs from the approved target");
  }
  if (profiles.size !== 2 || !profiles.has("datahike-dynamodb") || !profiles.has("datomic-dynamodb")) throw new Error("unexpected durable profile authorization");
  validateTemporaryComputePolicy(policy.scope.temporaryCompute);
  for (const field of ["requiredBeforeExecution", "requiredAfterTemporaryCompute", "explicitlyExcluded"]) {
    if (!Array.isArray(policy[field]) || policy[field].length < 1 || policy[field].some((value) => typeof value !== "string" || !value)) throw new Error(`${field} is invalid`);
  }
  return policy;
}

export function createAuthorizedPreview(policy, request, { now = () => new Date() } = {}) {
  validateInitialStatefulAuthorization(policy);
  const createdAtDate = validNow(now());
  exactKeys(request, ["accountId", "region", "repositoryId", "ref", "profileId", "operation", "tableName", "generationId", "fixtureManifestDigest", "logicalResourceCount", "costControls", "telegramGate", "temporaryCompute", "executionArtifacts"], "stateful request");
  if (request.accountId !== policy.authorizedAccountId || request.region !== policy.authorizedRegion || request.repositoryId !== policy.authorizedRepositoryId || request.ref !== policy.authorizedRef) throw new Error("stateful request identity is outside authorization");
  const durable = policy.scope.durableGenerations.find(({ profileId }) => profileId === request.profileId);
  if (!durable || !durable.operations.includes(request.operation)) throw new Error("stateful operation is outside authorization");
  if (request.tableName !== durable.tableName || request.generationId !== durable.generationId) throw new Error("stateful target is outside authorization");
  if (!SHA256.test(request.fixtureManifestDigest) || request.logicalResourceCount !== durable.logicalResourceCount) throw new Error("fixture target is outside authorization");
  validateCostControlGate(request.costControls, createdAtDate);
  validateTelegramGate(request.telegramGate, policy.authorizedAccountId, policy.authorizedRegion, createdAtDate);
  validateExecutionArtifacts(request.executionArtifacts, request.profileId, request.operation, request.generationId);
  if (request.temporaryCompute === null) {
    if (request.operation === "seed" && request.profileId === "datomic-dynamodb") throw new Error("Datomic seed preview must resolve its temporary compute topology");
  } else {
    validateTemporaryComputeRequest(policy.scope.temporaryCompute, request.temporaryCompute, request.profileId, policy.authorizedAccountId, createdAtDate);
    if (request.profileId === "datomic-dynamodb" && request.operation === "seed" && request.temporaryCompute.instanceProfileArn !== `arn:aws:iam::${policy.authorizedAccountId}:instance-profile/eacl-demo-datomic-seed-fixture-v1-green`) throw new Error("Datomic seed instance profile is outside authorization");
  }
  const createdAt = createdAtDate.toISOString();
  const payload = { ...structuredClone(request), authorizationPolicyDigest: digest(policy), createdAt, expiresAt: new Date(Date.parse(createdAt) + 30 * 60 * 1000).toISOString() };
  const previewId = digest(payload);
  return Object.freeze({
    schema: "eacl-demo.stateful-execution-preview.v1",
    previewId,
    ...payload,
    confirmation: `EXECUTE:${request.operation}:${request.tableName}:${request.generationId}:${previewId}`,
    cleanup: request.temporaryCompute === null ? null : {
      terminateBy: "launch-result-instance-id",
      noninteractive: true,
      verify: [...policy.requiredAfterTemporaryCompute]
    }
  });
}

export function createAuthorizedComputePreview(policy, request, { now = () => new Date() } = {}) {
  validateInitialStatefulAuthorization(policy);
  const createdAtDate = validNow(now());
  exactKeys(request, ["accountId", "region", "repositoryId", "ref", "profileId", "operation", "workloadDigest", "costControls", "telegramGate", "temporaryCompute"], "temporary compute request");
  if (request.accountId !== policy.authorizedAccountId || request.region !== policy.authorizedRegion || request.repositoryId !== policy.authorizedRepositoryId || request.ref !== policy.authorizedRef) throw new Error("temporary compute identity is outside authorization");
  if (request.operation !== "launch-temporary-compute" || !SHA256.test(request.workloadDigest)) throw new Error("temporary compute target is outside authorization");
  if (!policy.scope.temporaryCompute.standalonePurposes.includes(request.temporaryCompute?.purpose)) throw new Error("temporary compute purpose requires a durable generation preview");
  validateCostControlGate(request.costControls, createdAtDate);
  validateTelegramGate(request.telegramGate, policy.authorizedAccountId, policy.authorizedRegion, createdAtDate);
  validateTemporaryComputeRequest(policy.scope.temporaryCompute, request.temporaryCompute, request.profileId, policy.authorizedAccountId, createdAtDate);
  const createdAt = createdAtDate.toISOString();
  const payload = { ...structuredClone(request), authorizationPolicyDigest: digest(policy), createdAt, expiresAt: new Date(Date.parse(createdAt) + 30 * 60 * 1000).toISOString() };
  const previewId = digest(payload);
  return Object.freeze({
    schema: "eacl-demo.temporary-compute-execution-preview.v1",
    previewId,
    ...payload,
    confirmation: `EXECUTE:${request.operation}:${request.profileId}:${request.workloadDigest}:${previewId}`,
    cleanup: {
      terminateBy: "launch-result-instance-id",
      noninteractive: true,
      verify: [...policy.requiredAfterTemporaryCompute]
    }
  });
}

export function authorizePreviewExecution(policy, preview, confirmation, { now = () => new Date() } = {}) {
  validateInitialStatefulAuthorization(policy);
  if (!preview || preview.schema !== "eacl-demo.stateful-execution-preview.v1" || !SHA256.test(preview.previewId)) throw new Error("stateful preview is invalid");
  if (preview.authorizationPolicyDigest !== digest(policy)) throw new Error("stateful preview authorization policy changed");
  const { schema: _schema, previewId, confirmation: expectedConfirmation, cleanup: _cleanup, ...payload } = preview;
  if (digest(payload) !== previewId) throw new Error("stateful preview was modified");
  if (Date.parse(preview.expiresAt) <= now().getTime()) throw new Error("stateful preview expired");
  if (confirmation !== expectedConfirmation) throw new Error("stateful execution confirmation does not match the exact preview");
  createAuthorizedPreview(policy, requestFromPreview(preview), { now: () => new Date(preview.createdAt) });
  return Object.freeze({ authorized: true, previewId, accountId: preview.accountId, region: preview.region, profileId: preview.profileId, operation: preview.operation, tableName: preview.tableName, generationId: preview.generationId, cleanup: preview.cleanup });
}

export function authorizeComputePreviewExecution(policy, preview, confirmation, { now = () => new Date() } = {}) {
  validateInitialStatefulAuthorization(policy);
  if (!preview || preview.schema !== "eacl-demo.temporary-compute-execution-preview.v1" || !SHA256.test(preview.previewId)) throw new Error("temporary compute preview is invalid");
  if (preview.authorizationPolicyDigest !== digest(policy)) throw new Error("temporary compute preview authorization policy changed");
  const { schema: _schema, previewId, confirmation: expectedConfirmation, cleanup: _cleanup, ...payload } = preview;
  if (digest(payload) !== previewId) throw new Error("temporary compute preview was modified");
  if (Date.parse(preview.expiresAt) <= now().getTime()) throw new Error("temporary compute preview expired");
  if (confirmation !== expectedConfirmation) throw new Error("temporary compute execution confirmation does not match the exact preview");
  createAuthorizedComputePreview(policy, computeRequestFromPreview(preview), { now: () => new Date(preview.createdAt) });
  return Object.freeze({ authorized: true, previewId, accountId: preview.accountId, region: preview.region, profileId: preview.profileId, operation: preview.operation, workloadDigest: preview.workloadDigest, cleanup: preview.cleanup });
}

function requestFromPreview(preview) {
  return Object.fromEntries(["accountId", "region", "repositoryId", "ref", "profileId", "operation", "tableName", "generationId", "fixtureManifestDigest", "logicalResourceCount", "costControls", "telegramGate", "temporaryCompute", "executionArtifacts"].map((key) => [key, structuredClone(preview[key])]));
}

function computeRequestFromPreview(preview) {
  return Object.fromEntries(["accountId", "region", "repositoryId", "ref", "profileId", "operation", "workloadDigest", "costControls", "telegramGate", "temporaryCompute"].map((key) => [key, structuredClone(preview[key])]));
}

function validateTemporaryComputePolicy(value) {
  exactKeys(value, ["purposes", "profilePurposes", "standalonePurposes", "maximumConcurrentInstances", "maximumVcpus", "maximumMemoryGiB", "maximumRuntimeMinutes", "maximumRootVolumeGiB", "maximumForecastUsdPerRun", "requireNoInboundRules", "requireImdsV2", "requireNoElasticIp", "requireTerminationByExactInstanceId"], "temporary compute policy");
  if (!Array.isArray(value.purposes) || value.purposes.join(",") !== "datahike-seed,datomic-seed,datomic-transactor,jank-build") throw new Error("temporary compute purposes expanded");
  exactKeys(value.profilePurposes, ["datahike-dynamodb", "datomic-dynamodb", "jank-memory"], "temporary compute profile purposes");
  if (value.profilePurposes["datahike-dynamodb"].join(",") !== "datahike-seed" || value.profilePurposes["datomic-dynamodb"].join(",") !== "datomic-seed,datomic-transactor" || value.profilePurposes["jank-memory"].join(",") !== "jank-build") throw new Error("temporary compute profile purposes expanded");
  if (!Array.isArray(value.standalonePurposes) || value.standalonePurposes.join(",") !== "jank-build") throw new Error("standalone temporary compute purposes expanded");
  for (const field of ["maximumConcurrentInstances", "maximumVcpus", "maximumMemoryGiB", "maximumRuntimeMinutes", "maximumRootVolumeGiB", "maximumForecastUsdPerRun"]) if (!Number.isFinite(value[field]) || value[field] <= 0) throw new Error("temporary compute bound is invalid");
  if (value.maximumConcurrentInstances !== 1 || value.maximumVcpus > 8 || value.maximumMemoryGiB > 32 || value.maximumRuntimeMinutes > 360 || value.maximumRootVolumeGiB > 80 || value.maximumForecastUsdPerRun > 15) throw new Error("temporary compute policy exceeds authorization");
  for (const field of ["requireNoInboundRules", "requireImdsV2", "requireNoElasticIp", "requireTerminationByExactInstanceId"]) if (value[field] !== true) throw new Error("temporary compute safety requirement is disabled");
}

function validateTemporaryComputeRequest(policy, value, profileId, accountId, now) {
  exactKeys(value, ["purpose", "amiId", "instanceType", "vcpus", "memoryGiB", "runtimeMinutes", "rootVolumeGiB", "forecastUsd", "subnetId", "securityGroupId", "instanceProfileArn", "inboundRules", "metadataTokens", "associatePublicIpAddress", "elasticIpAllocationId", "expiresAtTag"], "temporary compute request");
  if (!policy.purposes.includes(value.purpose) || !policy.profilePurposes[profileId]?.includes(value.purpose)) throw new Error("temporary compute purpose is outside the profile authorization");
  if (!/^ami-[0-9a-f]{8,32}$/u.test(value.amiId) || !/^[a-z0-9.]+$/u.test(value.instanceType) || !/^subnet-[0-9a-f]{8,32}$/u.test(value.subnetId) || !/^sg-[0-9a-f]{8,32}$/u.test(value.securityGroupId) || !new RegExp(`^arn:[a-z0-9-]+:iam::${accountId}:instance-profile\\/[A-Za-z0-9+=,.@_/-]+$`, "u").test(value.instanceProfileArn)) throw new Error("temporary compute target is invalid");
  if (!Number.isSafeInteger(value.vcpus) || value.vcpus < 1 || value.vcpus > policy.maximumVcpus || !Number.isFinite(value.memoryGiB) || value.memoryGiB <= 0 || value.memoryGiB > policy.maximumMemoryGiB || !Number.isSafeInteger(value.runtimeMinutes) || value.runtimeMinutes < 1 || value.runtimeMinutes > policy.maximumRuntimeMinutes || !Number.isSafeInteger(value.rootVolumeGiB) || value.rootVolumeGiB < 8 || value.rootVolumeGiB > policy.maximumRootVolumeGiB || !Number.isFinite(value.forecastUsd) || value.forecastUsd < 0 || value.forecastUsd > policy.maximumForecastUsdPerRun) throw new Error("temporary compute request exceeds a bound");
  const expiry = Date.parse(value.expiresAtTag);
  if (!Array.isArray(value.inboundRules) || value.inboundRules.length !== 0 || value.metadataTokens !== "required" || value.associatePublicIpAddress !== false || value.elasticIpAllocationId !== null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.expiresAtTag) || !Number.isFinite(expiry) || expiry <= now.getTime() || expiry > now.getTime() + value.runtimeMinutes * 60 * 1000) throw new Error("temporary compute safety topology is invalid");
}

function validateExecutionArtifacts(value, profileId, operation, generationId) {
  if (profileId !== "datomic-dynamodb" || operation !== "seed") {
    if (value !== null) throw new Error("stateful execution artifacts are outside authorization");
    return;
  }
  exactKeys(value, ["artifactBucket", "seedArtifactKey", "seedArtifactVersion", "seedArtifactSha256", "fixtureStreamKey", "fixtureStreamVersion", "fixtureStreamSha256", "seedEvidenceKey", "datomicDistributionUrl", "datomicDistributionSha256", "datomicDistributionBytes", "datomicDistributionRoot"], "Datomic seed execution artifacts");
  const seed = /^artifacts\/datomic-dynamodb\/seed\/([a-f0-9]{64})\/seed\.jar$/u.exec(value.seedArtifactKey);
  const stream = /^artifacts\/datomic-dynamodb\/fixtures\/([a-f0-9]{64})\/fixture-1000000\.batches\.jsonl\.gz$/u.exec(value.fixtureStreamKey);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value.artifactBucket) || !seed || seed[1] !== value.seedArtifactSha256 || !stream || stream[1] !== value.fixtureStreamSha256 || !S3_VERSION.test(value.seedArtifactVersion) || !S3_VERSION.test(value.fixtureStreamVersion)) throw new Error("Datomic seed S3 artifacts are invalid");
  if (value.seedEvidenceKey !== `evidence/datomic-dynamodb/${generationId}/seed-evidence.jsonl`) throw new Error("Datomic seed evidence target is invalid");
  if (value.datomicDistributionUrl !== "https://datomic-pro-downloads.s3.amazonaws.com/1.0.7705/datomic-pro-1.0.7705.zip" || value.datomicDistributionSha256 !== "a17c2603b893dfb0d998a35a032a7295736d234d32937222c8ec21d81a1b8c7e" || value.datomicDistributionBytes !== 272642957 || value.datomicDistributionRoot !== "datomic-pro-1.0.7705") throw new Error("Datomic distribution identity changed");
}

function validateCostControlGate(value, now) {
  exactKeys(value, ["verified", "evidenceId", "verifiedAt", "capPolicyDigest"], "cost controls");
  if (!SHA256.test(value.capPolicyDigest)) throw new Error("cost controls are not bound to a cap policy");
  validateSafetyGate(value, "cost controls", now);
}

function validateTelegramGate(value, accountId, region, now) {
  exactKeys(value, ["verified", "evidenceId", "verifiedAt", "notificationTopicArn"], "Telegram gate");
  const match = /^arn:[a-z0-9-]+:sns:([a-z0-9-]+):([0-9]{12}):[A-Za-z0-9_-]+$/u.exec(value.notificationTopicArn);
  if (!match || match[1] !== region || match[2] !== accountId) throw new Error("Telegram gate notification topic is outside authorization");
  validateSafetyGate(value, "Telegram gate", now);
}

function validateSafetyGate(value, name, now) {
  const verifiedAt = Date.parse(value.verifiedAt);
  const age = now.getTime() - verifiedAt;
  if (value.verified !== true || !SHA256.test(value.evidenceId) || !validTimestamp(value.verifiedAt) || !Number.isFinite(verifiedAt) || age < 0 || age > 30 * 60 * 1000) throw new Error(`${name} is not freshly verified`);
}

function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const canonical = new Date(Date.parse(value)).toISOString();
  return value.includes(".") ? canonical === value : canonical.replace(".000Z", "Z") === value;
}

function validNow(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError("authorization clock returned an invalid time");
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(`${stableJson(value)}\n`).digest("hex")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}
