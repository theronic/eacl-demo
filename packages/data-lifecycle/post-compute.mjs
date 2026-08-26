import { createHash } from "node:crypto";

import { createAuthorizedComputePreview, createAuthorizedPreview, validateInitialStatefulAuthorization } from "./authorization.mjs";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const INSTANCE_ID = /^i-[0-9a-f]{8,32}$/u;
const VOLUME_ID = /^vol-[0-9a-f]{8,32}$/u;
const ROLE_ARN = /^arn:[a-z0-9-]+:iam::([0-9]{12}):role\/[A-Za-z0-9+=,.@_/-]+$/u;
const INSTANCE_PROFILE_ARN = /^arn:[a-z0-9-]+:iam::([0-9]{12}):instance-profile\/[A-Za-z0-9+=,.@_/-]+$/u;
const SNS_ARN = /^arn:[a-z0-9-]+:sns:([a-z0-9-]+):([0-9]{12}):[A-Za-z0-9_-]+$/u;
const REQUIRED_SEED_ALARMS = ["read-cap-70", "read-cap-90", "write-cap-70", "write-cap-90", "read-throttle", "write-throttle", "read-cap-drift", "write-cap-drift"];

export function verifyPostTemporaryComputeEvidence(policy, capPolicy, preview, launchResult, evidence, { now = () => new Date() } = {}) {
  validateInitialStatefulAuthorization(policy);
  validateCapPolicy(capPolicy);
  validatePreview(policy, preview);
  const compute = preview.temporaryCompute;
  if (!compute) throw new Error("post-compute verification requires a temporary-compute preview");
  validateLaunchResult(policy, preview, launchResult);
  validateEvidenceEnvelope(policy, preview, launchResult, evidence, validNow(now()));

  const durable = policy.scope.durableGenerations.find(({ profileId }) => profileId === preview.profileId);
  if (preview.costControls.capPolicyDigest !== digest(capPolicy)) throw new Error("post-compute cap policy differs from the authorized preflight policy");
  if (durable) validateTableEvidence(capPolicy, durable, preview.telegramGate.notificationTopicArn, evidence.tableCostControls);
  else if (evidence.tableCostControls.length !== 0) throw new Error("standalone compute evidence contains an unrelated table");
  validateCleanupEvidence(preview, launchResult, evidence.cleanup, evidence.collectedAt);

  return Object.freeze({
    schema: "eacl-demo.post-temporary-compute-verification.v1",
    verified: true,
    previewId: preview.previewId,
    instanceId: launchResult.instanceId,
    evidenceDigest: digest(evidence),
    verifiedAt: evidence.collectedAt
  });
}

function validatePreview(policy, preview) {
  if (!preview || !["eacl-demo.stateful-execution-preview.v1", "eacl-demo.temporary-compute-execution-preview.v1"].includes(preview.schema) || !SHA256.test(preview.previewId)) throw new Error("temporary-compute preview is invalid");
  if (preview.authorizationPolicyDigest !== digest(policy)) throw new Error("temporary-compute preview authorization policy changed");
  const { schema: _schema, previewId, confirmation, cleanup, ...payload } = preview;
  if (digest(payload) !== previewId) throw new Error("temporary-compute preview was modified");
  const expectedConfirmation = preview.schema === "eacl-demo.stateful-execution-preview.v1"
    ? `EXECUTE:${preview.operation}:${preview.tableName}:${preview.generationId}:${previewId}`
    : `EXECUTE:${preview.operation}:${preview.profileId}:${preview.workloadDigest}:${previewId}`;
  if (confirmation !== expectedConfirmation) throw new Error("temporary-compute confirmation binding is invalid");
  if (!cleanup || cleanup.terminateBy !== "launch-result-instance-id" || cleanup.noninteractive !== true || JSON.stringify(cleanup.verify) !== JSON.stringify(policy.requiredAfterTemporaryCompute)) throw new Error("temporary-compute cleanup contract changed");
  const recreated = preview.schema === "eacl-demo.stateful-execution-preview.v1"
    ? createAuthorizedPreview(policy, pick(preview, ["accountId", "region", "repositoryId", "ref", "profileId", "operation", "tableName", "generationId", "fixtureManifestDigest", "logicalResourceCount", "costControls", "telegramGate", "temporaryCompute", "executionArtifacts"]), { now: () => new Date(preview.createdAt) })
    : createAuthorizedComputePreview(policy, pick(preview, ["accountId", "region", "repositoryId", "ref", "profileId", "operation", "workloadDigest", "costControls", "telegramGate", "temporaryCompute"]), { now: () => new Date(preview.createdAt) });
  if (stableJson(recreated) !== stableJson(preview)) throw new Error("temporary-compute preview was not produced by the authorization policy");
}

function validateLaunchResult(policy, preview, value) {
  exactKeys(value, ["schema", "previewId", "accountId", "region", "instanceId", "rootVolumeId", "elasticIpAllocationId", "temporaryRoleArn", "instanceProfileArn", "launchedAt", "tags"], "temporary-compute launch result");
  if (value.schema !== "eacl-demo.temporary-compute-launch-result.v1" || value.previewId !== preview.previewId || value.accountId !== preview.accountId || value.region !== preview.region) throw new Error("temporary-compute launch identity mismatch");
  if (!INSTANCE_ID.test(value.instanceId) || !VOLUME_ID.test(value.rootVolumeId) || value.elasticIpAllocationId !== null) throw new Error("temporary-compute launch resources are invalid");
  if (!ROLE_ARN.test(value.temporaryRoleArn) || ROLE_ARN.exec(value.temporaryRoleArn)[1] !== policy.authorizedAccountId || value.instanceProfileArn !== preview.temporaryCompute.instanceProfileArn || INSTANCE_PROFILE_ARN.exec(value.instanceProfileArn)?.[1] !== policy.authorizedAccountId || arnLeaf(value.temporaryRoleArn) !== arnLeaf(value.instanceProfileArn)) throw new Error("temporary-compute launch role is invalid");
  exactKeys(value.tags, ["Project", "Lifecycle", "ManagedBy", "Owner", "Purpose", "AuthorizationId", "ExpiresAt"], "temporary-compute launch tags");
  if (value.tags.Project !== "eacl-demo" || value.tags.Lifecycle !== "temporary" || value.tags.ManagedBy !== "eacl-demo-temp-watchdog" || value.tags.Owner !== "theronic/eacl-demo" || value.tags.Purpose !== preview.temporaryCompute.purpose || value.tags.AuthorizationId !== preview.previewId || value.tags.ExpiresAt !== preview.temporaryCompute.expiresAtTag) throw new Error("temporary-compute launch tags are invalid");
  if (!validTimestamp(value.launchedAt) || Date.parse(value.launchedAt) < Date.parse(preview.createdAt) || Date.parse(value.launchedAt) > Date.parse(preview.temporaryCompute.expiresAtTag)) throw new Error("temporary-compute launch time is invalid");
}

function validateEvidenceEnvelope(policy, preview, launchResult, evidence, now) {
  exactKeys(evidence, ["schema", "previewId", "accountId", "region", "collectedAt", "tableCostControls", "cleanup"], "post-compute evidence");
  if (evidence.schema !== "eacl-demo.post-temporary-compute-evidence.v1" || evidence.previewId !== preview.previewId || evidence.accountId !== policy.authorizedAccountId || evidence.region !== policy.authorizedRegion) throw new Error("post-compute evidence identity mismatch");
  if (!validTimestamp(evidence.collectedAt)) throw new Error("post-compute evidence time is invalid");
  const collected = Date.parse(evidence.collectedAt);
  if (collected < Date.parse(launchResult.launchedAt) || collected > now.getTime() || now.getTime() - collected > 15 * 60 * 1000) throw new Error("post-compute evidence is stale or out of sequence");
  if (!Array.isArray(evidence.tableCostControls) || evidence.tableCostControls.length > 1) throw new Error("post-compute table evidence scope is invalid");
}

function validateTableEvidence(capPolicy, durable, authorizedTopicArn, tables) {
  if (tables.length !== 1) throw new Error("applicable DynamoDB table evidence is missing");
  const value = tables[0];
  exactKeys(value, ["profileId", "tableName", "phase", "billingMode", "tableStatus", "maxReadRequestUnits", "maxWriteRequestUnits", "deletionProtectionEnabled", "pointInTimeRecoveryStatus", "alarmTopicArn", "alarms"], "DynamoDB table cost-control evidence");
  if (value.profileId !== durable.profileId || value.tableName !== durable.tableName || !["seed", "serving"].includes(value.phase) || value.billingMode !== "PAY_PER_REQUEST" || value.tableStatus !== "ACTIVE" || value.deletionProtectionEnabled !== true || value.pointInTimeRecoveryStatus !== "ENABLED") throw new Error("DynamoDB table controls are not active on the authorized target");
  const expectedCaps = capPolicy.profiles[durable.profileId][value.phase];
  if (value.maxReadRequestUnits !== expectedCaps.maxReadRequestUnits || value.maxWriteRequestUnits !== expectedCaps.maxWriteRequestUnits) throw new Error("DynamoDB table cap differs from the reviewed policy");
  const topic = SNS_ARN.exec(value.alarmTopicArn);
  if (!topic || value.alarmTopicArn !== authorizedTopicArn) throw new Error("DynamoDB alarms are not routed through the verified Telegram topic");
  const required = value.phase === "serving" ? [...REQUIRED_SEED_ALARMS, "unexpected-serving-write"] : REQUIRED_SEED_ALARMS;
  if (!Array.isArray(value.alarms) || value.alarms.length !== required.length) throw new Error("DynamoDB alarm evidence is incomplete");
  const kinds = [];
  for (const alarm of value.alarms) {
    exactKeys(alarm, ["kind", "alarmName", "stateValue", "actionsEnabled", "alarmActions", "okActions"], "DynamoDB alarm evidence");
    kinds.push(alarm.kind);
    if (!required.includes(alarm.kind) || alarm.alarmName !== `${value.tableName}-${alarm.kind}` || alarm.stateValue !== "OK" || alarm.actionsEnabled !== true || JSON.stringify(alarm.alarmActions) !== JSON.stringify([value.alarmTopicArn]) || JSON.stringify(alarm.okActions) !== "[]") throw new Error("DynamoDB alarm is missing, unhealthy, noisy, or misrouted");
  }
  if (JSON.stringify([...kinds].sort()) !== JSON.stringify([...required].sort()) || new Set(kinds).size !== kinds.length) throw new Error("DynamoDB alarm kinds are not exact");
}

function validateCleanupEvidence(preview, launch, value, collectedAt) {
  exactKeys(value, ["terminationRequestedForInstanceId", "terminationRequestedAt", "instanceState", "instanceStateObservedAt", "matchingNonterminatedInstanceIds", "rootVolumeId", "rootVolumeState", "matchingBillableVolumeIds", "matchingElasticAddressAllocationIds", "temporaryRoleArn", "instanceProfileArn", "roleSessionsRevokedAt", "temporaryRoleExists", "instanceProfileExists", "temporaryRoleAttachedPolicyCount", "temporaryRoleInlinePolicyCount"], "temporary-compute cleanup evidence");
  if (value.terminationRequestedForInstanceId !== launch.instanceId || value.rootVolumeId !== launch.rootVolumeId || !["terminated", "absent"].includes(value.instanceState) || !["deleted", "absent"].includes(value.rootVolumeState)) throw new Error("exact temporary instance or root volume remains billable");
  for (const timestamp of [value.terminationRequestedAt, value.instanceStateObservedAt, value.roleSessionsRevokedAt]) if (!validTimestamp(timestamp) || Date.parse(timestamp) < Date.parse(launch.launchedAt)) throw new Error("temporary-compute cleanup time is invalid");
  if (Date.parse(value.instanceStateObservedAt) < Date.parse(value.terminationRequestedAt) || Date.parse(value.roleSessionsRevokedAt) < Date.parse(value.terminationRequestedAt)) throw new Error("temporary-compute cleanup ordering is invalid");
  if ([value.terminationRequestedAt, value.instanceStateObservedAt, value.roleSessionsRevokedAt].some((timestamp) => Date.parse(timestamp) > Date.parse(collectedAt))) throw new Error("temporary-compute cleanup evidence claims a future action");
  for (const [field, pattern] of [["matchingNonterminatedInstanceIds", INSTANCE_ID], ["matchingBillableVolumeIds", VOLUME_ID]]) requireEmptyIdentifiers(value[field], pattern, field);
  requireEmptyIdentifiers(value.matchingElasticAddressAllocationIds, /^eipalloc-[0-9a-f]{8,32}$/u, "matchingElasticAddressAllocationIds");
  if (value.temporaryRoleArn !== launch.temporaryRoleArn || value.instanceProfileArn !== launch.instanceProfileArn || value.temporaryRoleExists !== false || value.instanceProfileExists !== false || value.temporaryRoleAttachedPolicyCount !== 0 || value.temporaryRoleInlinePolicyCount !== 0) throw new Error("temporary compute role or instance profile remains active");
  if (launch.elasticIpAllocationId !== null || preview.temporaryCompute.elasticIpAllocationId !== null) throw new Error("temporary compute unexpectedly used an Elastic IP");
}

function validateCapPolicy(value) {
  exactKeys(value, ["schemaVersion", "units", "profiles", "alarmThresholdPercent", "metricPeriodSeconds", "notes"], "DynamoDB cap policy");
  if (value.schemaVersion !== 1 || value.units !== "request-units-per-second" || JSON.stringify(value.alarmThresholdPercent) !== "[70,90]" || value.metricPeriodSeconds !== 60) throw new Error("DynamoDB cap policy metadata changed");
  exactKeys(value.profiles, ["datahike-dynamodb", "datomic-dynamodb"], "DynamoDB cap profiles");
  for (const profile of Object.values(value.profiles)) {
    exactKeys(profile, ["seed", "serving"], "DynamoDB cap phases");
    for (const phase of Object.values(profile)) {
      exactKeys(phase, ["maxReadRequestUnits", "maxWriteRequestUnits"], "DynamoDB cap phase");
      if (!Number.isSafeInteger(phase.maxReadRequestUnits) || phase.maxReadRequestUnits < 1 || phase.maxReadRequestUnits > 250 || !Number.isSafeInteger(phase.maxWriteRequestUnits) || phase.maxWriteRequestUnits < 1 || phase.maxWriteRequestUnits > 200) throw new Error("DynamoDB cap exceeds the reviewed safety ceiling");
    }
  }
  if (!Array.isArray(value.notes) || value.notes.some((item) => typeof item !== "string")) throw new Error("DynamoDB cap policy notes are invalid");
}

function requireEmptyIdentifiers(value, pattern, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !pattern.test(item)) || value.length !== 0) throw new Error(`${field} is not empty`);
}

function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const canonical = new Date(Date.parse(value)).toISOString();
  return value.includes(".") ? canonical === value : canonical.replace(".000Z", "Z") === value;
}

function arnLeaf(value) {
  return value.slice(value.lastIndexOf("/") + 1);
}

function pick(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, structuredClone(value[key])]));
}

function validNow(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError("post-compute verifier clock returned an invalid time");
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
