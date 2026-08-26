import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";

import { verifyCheckedOutIdentity } from "./lib/checked-out-identity.mjs";
import { verifyOrdinaryArtifact } from "./lib/ordinary-artifact.mjs";
import { ordinaryTargetDefinitions } from "./lib/ordinary-workflow.mjs";
import { createStaticPublicationPlan, executeStaticPublication } from "./lib/static-publication.mjs";
import { createStaticS3Storage } from "./lib/static-s3-storage.mjs";
import { createServerAwsAdapter } from "./lib/server-aws-adapter.mjs";
import { createServerPublicationPlan, executeServerPublication } from "./lib/server-publication.mjs";

const root = path.resolve(import.meta.dirname, "..");
const [target, input] = process.argv.slice(2);
if (!ordinaryTargetDefinitions[target] || !input || path.isAbsolute(input)) throw new Error("usage: node scripts/deploy-ordinary-target.mjs <registered-target> <repository-relative-artifact-directory>");
const directory = path.resolve(root, input);
if (!directory.startsWith(`${root}${path.sep}`)) throw new Error("ordinary deployment artifact directory escapes the repository");
const identity = verifyCheckedOutIdentity(root, required("GITHUB_SHA"));
const artifactManifest = await verifyOrdinaryArtifact({
  directory,
  expectedTarget: target,
  expectedDemoSha: identity.demoSha,
  expectedEaclSha: identity.eaclSha,
  expectedArtifactSha256: required("EACL_EXPECTED_ARTIFACT_SHA256")
});
const runId = positiveInteger(required("GITHUB_RUN_ID"), "GITHUB_RUN_ID");
const runAttempt = positiveInteger(required("GITHUB_RUN_ATTEMPT"), "GITHUB_RUN_ATTEMPT");
if (target === "static") await deployStatic({ directory, artifactManifest, runId, runAttempt });
else await deployServer({ directory, artifactManifest, runId, runAttempt });

async function deployStatic({ directory: artifactDirectory, artifactManifest: manifest, runId: githubRunId, runAttempt: githubRunAttempt }) {
  const plan = await createStaticPublicationPlan({ artifactDirectory, artifactManifest: manifest });
  const origin = required("PRODUCTION_CLOUDFRONT_ORIGIN");
  const storage = createStaticS3Storage({
    accountId: required("AWS_ACCOUNT_ID"), region: required("AWS_REGION"), bucket: required("STATIC_BUCKET"),
    distributionId: required("CLOUDFRONT_DISTRIBUTION_ID"), origin, artifactSha256: manifest.artifactSha256
  });
  const result = await executeStaticPublication({ plan, deployedAt: new Date().toISOString(), runId: githubRunId, runAttempt: githubRunAttempt, storage, smokeOptions: { origin } });
  process.stdout.write(`${JSON.stringify({ target, deploymentId: result.status.deploymentId, artifactSha256: manifest.artifactSha256, statusVersionId: result.statusVersionId })}\n`);
}

async function deployServer({ directory: artifactDirectory, artifactManifest: manifest, runId: githubRunId, runAttempt: githubRunAttempt }) {
  if (!new Set(["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory"]).has(target)) throw new Error(`ordinary deployment transaction is not implemented for ${target}`);
  const [profileDefinitions, baseRegistry] = await Promise.all([
    readJson(path.join(root, "packages", "contracts", "profiles.v1.json")),
    readJson(path.join(root, "registry", "profile-registry.v1.json"))
  ]);
  const deploymentId = `github:${githubRunId}:${githubRunAttempt}:${manifest.artifactSha256.slice(0, 16)}`;
  const plan = createServerPublicationPlan({ target, artifactDirectory, artifactManifest: manifest, deploymentId, deployedAt: new Date().toISOString() });
  const adapter = createServerAwsAdapter({
    root,
    accountId: required("AWS_ACCOUNT_ID"),
    region: required("AWS_REGION"),
    profileId: target,
    functionName: required("PROFILE_FUNCTION_NAME"),
    artifactBucket: required("ARTIFACT_BUCKET"),
    statusBucket: required("STATIC_BUCKET"),
    stagedDistributionId: required("STAGED_CLOUDFRONT_DISTRIBUTION_ID"),
    productionDistributionId: required("PRODUCTION_CLOUDFRONT_DISTRIBUTION_ID"),
    stagedApiCachePolicyId: required("STAGED_API_CACHE_POLICY_ID"),
    productionApiCachePolicyId: required("PRODUCTION_API_CACHE_POLICY_ID"),
    stagedApiOriginRequestPolicyId: required("STAGED_API_ORIGIN_REQUEST_POLICY_ID"),
    productionApiOriginRequestPolicyId: required("PRODUCTION_API_ORIGIN_REQUEST_POLICY_ID"),
    stagedApiViewerRequestFunctionArn: required("STAGED_API_VIEWER_REQUEST_FUNCTION_ARN"),
    productionApiViewerRequestFunctionArn: required("PRODUCTION_API_VIEWER_REQUEST_FUNCTION_ARN"),
    stagedLambdaOriginAccessControlId: required("STAGED_LAMBDA_ORIGIN_ACCESS_CONTROL_ID"),
    productionLambdaOriginAccessControlId: required("PRODUCTION_LAMBDA_ORIGIN_ACCESS_CONTROL_ID"),
    stagedSecurityHeadersPolicyId: required("STAGED_SECURITY_HEADERS_POLICY_ID"),
    productionSecurityHeadersPolicyId: required("PRODUCTION_SECURITY_HEADERS_POLICY_ID"),
    stagedOrigin: required("STAGED_CLOUDFRONT_ORIGIN"),
    productionOrigin: required("PRODUCTION_CLOUDFRONT_ORIGIN"),
    profileDefinitions,
    baseRegistry
  });
  const result = await executeServerPublication({ plan, adapter, profileDefinitions, baseRegistry });
  process.stdout.write(`${JSON.stringify({ target, deploymentId, artifactSha256: result.deployment.artifact.sha256, version: result.deployment.artifact.version, publicationId: result.publicationId, statusVersionId: result.statusVersionId })}\n`);
}

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 || value.includes("\0")) throw new Error(`${name} is required and bounded`);
  return value;
}

function positiveInteger(value, name) {
  if (!/^[1-9][0-9]{0,19}$/u.test(value)) throw new Error(`${name} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} exceeds the safe integer bound`);
  return parsed;
}
