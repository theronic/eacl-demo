import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { authorizePreviewExecution, createAuthorizedPreview } from "../packages/data-lifecycle/authorization.mjs";

const root = new URL("../", import.meta.url);
const policy = JSON.parse(await readFile(new URL("infra/data/authorized-initial-stateful-operations.v1.json", root), "utf8"));
const capPolicy = JSON.parse(await readFile(new URL("infra/data/dynamodb-cap-policy.v1.json", root), "utf8"));
const command = process.argv[2];

if (command === "preview") {
  const suppliedRequest = process.env.EACL_REQUEST_JSON
    ? JSON.parse(required("EACL_REQUEST_JSON"))
    : null;
  const accountId = suppliedRequest?.accountId ?? required("EACL_ACCOUNT_ID");
  const request = suppliedRequest ?? {
    accountId,
    region: required("EACL_AWS_REGION"),
    repositoryId: required("EACL_REPOSITORY_ID"),
    ref: required("EACL_REF"),
    profileId: "datomic-dynamodb",
    operation: "seed",
    tableName: "eacl-demo-datomic-fixture-v1-green",
    generationId: "fixture-v1-green",
    fixtureManifestDigest: required("EACL_FIXTURE_MANIFEST_DIGEST"),
    logicalResourceCount: 1_000_000,
    costControls: {
      verified: true,
      evidenceId: required("EACL_COST_EVIDENCE_ID"),
      verifiedAt: required("EACL_COST_VERIFIED_AT"),
      capPolicyDigest: digest(capPolicy)
    },
    telegramGate: {
      verified: true,
      evidenceId: required("EACL_TELEGRAM_EVIDENCE_ID"),
      verifiedAt: required("EACL_TELEGRAM_VERIFIED_AT"),
      notificationTopicArn: required("EACL_ALARM_TOPIC_ARN")
    },
    executionArtifacts: {
      artifactBucket: required("EACL_ARTIFACT_BUCKET"),
      seedArtifactKey: required("EACL_SEED_ARTIFACT_KEY"),
      seedArtifactVersion: required("EACL_SEED_ARTIFACT_VERSION"),
      seedArtifactSha256: required("EACL_SEED_ARTIFACT_SHA256"),
      fixtureStreamKey: required("EACL_FIXTURE_STREAM_KEY"),
      fixtureStreamVersion: required("EACL_FIXTURE_STREAM_VERSION"),
      fixtureStreamSha256: required("EACL_FIXTURE_STREAM_SHA256"),
      seedEvidenceKey: "evidence/datomic-dynamodb/fixture-v1-green/seed-evidence.jsonl",
      datomicDistributionUrl: "https://datomic-pro-downloads.s3.amazonaws.com/1.0.7705/datomic-pro-1.0.7705.zip",
      datomicDistributionSha256: "a17c2603b893dfb0d998a35a032a7295736d234d32937222c8ec21d81a1b8c7e",
      datomicDistributionBytes: 272642957,
      datomicDistributionRoot: "datomic-pro-1.0.7705"
    },
    temporaryCompute: {
      purpose: "datomic-transactor",
      amiId: required("EACL_AMI_ID"),
      instanceType: required("EACL_INSTANCE_TYPE"),
      vcpus: integer("EACL_VCPUS"),
      memoryGiB: number("EACL_MEMORY_GIB"),
      runtimeMinutes: integer("EACL_RUNTIME_MINUTES"),
      rootVolumeGiB: integer("EACL_ROOT_VOLUME_GIB"),
      forecastUsd: number("EACL_FORECAST_USD"),
      subnetId: required("EACL_SUBNET_ID"),
      securityGroupId: required("EACL_SECURITY_GROUP_ID"),
      instanceProfileArn: `arn:aws:iam::${accountId}:instance-profile/eacl-demo-datomic-seed-fixture-v1-green`,
      inboundRules: [],
      metadataTokens: "required",
      associatePublicIpAddress: false,
      elasticIpAllocationId: null,
      expiresAtTag: required("EACL_EXPIRES_AT")
    }
  };
  request.costControls.capPolicyDigest = digest(capPolicy);
  process.stdout.write(`${JSON.stringify(createAuthorizedPreview(policy, request))}\n`);
} else if (command === "authorize") {
  const preview = JSON.parse(required("EACL_PREVIEW_JSON"));
  const result = authorizePreviewExecution(
    policy,
    preview,
    required("EACL_CONFIRMATION")
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  throw new Error("usage: node scripts/datomic-seed-authorization.mjs preview|authorize");
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384) throw new Error(`${name} is missing or oversized`);
  return value;
}

function integer(name) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function number(name) {
  const value = Number(required(name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
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
