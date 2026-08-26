import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { verifyProfilePublication } from "../../packages/explorer-state/src/profile-publication.mjs";
import { runMergeSmoke } from "../../packages/qualification/src/merge-smoke.mjs";
import { runProductionRecheck } from "../../packages/qualification/src/production-recheck.mjs";
import {
  assertTrustedCloudFrontOrigin,
  createHttpQualificationTransport,
  qualificationTarget,
  reportableTarget
} from "../../packages/qualification/src/targets.mjs";

const ACCOUNT = /^[0-9]{12}$/u;
const REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-[1-9][0-9]?$/u;
const BUCKET = /^(?!.*\.\.)(?!.*\.-)(?!.*-\.)(?:[a-z0-9][a-z0-9.-]{1,61}[a-z0-9])$/u;
const FUNCTION = /^[A-Za-z0-9-_]{1,64}$/u;
const DISTRIBUTION = /^[A-Z0-9]{8,32}$/u;
const CACHE_POLICY = /^[0-9a-f-]{16,64}$/iu;
const VERSION = /^[1-9][0-9]*$/u;
const REVISION = /^[A-Za-z0-9+=,.@_-]{1,256}$/u;
const VERSION_ID = /^.{1,1024}$/us;
const ETAG = /^"[0-9a-f]{32}(?:-[1-9][0-9]*)?"$/u;
const PUBLICATION_ID = /^sha256:[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAXIMUM_STATUS_BYTES = 65_536;
const IDENTITY_ENVIRONMENT = Object.freeze(["EACL_ARTIFACT_SHA256", "EACL_CORE_SHA", "EACL_DEMO_SHA", "EACL_DEPLOYMENT_ID"]);
const RUNTIMES = Object.freeze({
  "datahike-s3": { runtime: "java25", architecture: "arm64", handler: "eacl_demo.datahike_s3.LambdaHandler::handleRequest", snapStart: "None" },
  "datahike-dynamodb": { runtime: "java25", architecture: "arm64", handler: "eacl_demo.datahike_dynamodb.LambdaHandler::handleRequest", snapStart: "None" },
  "datomic-dynamodb": { runtime: "java25", architecture: "x86_64", handler: "eacl_demo.datomic_dynamodb.LambdaHandler::handleRequest", snapStart: "None" },
  "datalevin-memory": { runtime: "java25", architecture: "arm64", handler: "eacl_demo.datalevin_memory.LambdaHandler::handleRequest", snapStart: "PublishedVersions" }
});

export function createServerAwsAdapter({
  root,
  accountId,
  region,
  profileId,
  functionName,
  artifactBucket,
  statusBucket,
  stagedDistributionId,
  productionDistributionId,
  stagedApiCachePolicyId,
  productionApiCachePolicyId,
  stagedApiOriginRequestPolicyId,
  productionApiOriginRequestPolicyId,
  stagedApiViewerRequestFunctionArn,
  productionApiViewerRequestFunctionArn,
  stagedLambdaOriginAccessControlId,
  productionLambdaOriginAccessControlId,
  stagedSecurityHeadersPolicyId,
  productionSecurityHeadersPolicyId,
  stagedOrigin,
  productionOrigin,
  profileDefinitions,
  baseRegistry,
  runAws = defaultRunAws,
  fetchImpl = globalThis.fetch
}) {
  validateCoordinates({ root, accountId, region, profileId, functionName, artifactBucket, statusBucket, stagedDistributionId, productionDistributionId, stagedApiCachePolicyId, productionApiCachePolicyId, stagedApiOriginRequestPolicyId, productionApiOriginRequestPolicyId, stagedApiViewerRequestFunctionArn, productionApiViewerRequestFunctionArn, stagedLambdaOriginAccessControlId, productionLambdaOriginAccessControlId, stagedSecurityHeadersPolicyId, productionSecurityHeadersPolicyId, stagedOrigin, productionOrigin, fetchImpl });
  const definition = profileDefinitions?.profiles?.find(({ id }) => id === profileId);
  const catalogProfile = baseRegistry?.profiles?.find(({ id }) => id === profileId);
  if (!definition || !catalogProfile) throw new Error("server AWS adapter profile is outside the closed catalog");
  const runtime = RUNTIMES[profileId];
  const staged = exactHttpsOrigin(stagedOrigin, "staged");
  const production = exactHttpsOrigin(productionOrigin, "production");
  const base = ["--region", region, "--output", "json", "--no-cli-pager", "--cli-auto-prompt", "off"];

  const adapter = {
    async assertFoundation(plan) {
      if (plan?.profileId !== profileId) throw new Error("server AWS adapter target mismatch");
      const caller = awsJson(["sts", "get-caller-identity", ...base], "AWS caller identity");
      if (caller.Account !== accountId || caller.Arn?.includes(":root")) throw new Error("server deployment assumed the wrong or root AWS identity");
      assertBucket(artifactBucket, "artifacts");
      assertBucket(statusBucket, "static");
      const configuration = latestConfiguration();
      validateFunctionConfiguration(configuration, { qualifier: "$LATEST", requireIdentity: false });
      const tags = awsJson(["lambda", "list-tags", "--resource", configuration.FunctionArn, ...base], "Lambda function tags").Tags ?? {};
      if (tags.Project !== "eacl-demo" || tags.Profile !== profileId) throw new Error("Lambda function identity tags are invalid");
      assertCloudFrontRoute({ distributionId: stagedDistributionId, cachePolicyId: stagedApiCachePolicyId, originRequestPolicyId: stagedApiOriginRequestPolicyId, viewerRequestFunctionArn: stagedApiViewerRequestFunctionArn, originAccessControlId: stagedLambdaOriginAccessControlId, responseHeadersPolicyId: stagedSecurityHeadersPolicyId, trustedOrigin: staged, aliasName: "candidate" });
      assertCloudFrontRoute({ distributionId: productionDistributionId, cachePolicyId: productionApiCachePolicyId, originRequestPolicyId: productionApiOriginRequestPolicyId, viewerRequestFunctionArn: productionApiViewerRequestFunctionArn, originAccessControlId: productionLambdaOriginAccessControlId, responseHeadersPolicyId: productionSecurityHeadersPolicyId, trustedOrigin: production, aliasName: "live" });
    },

    async readProfileState() {
      const candidateAlias = getAlias("candidate");
      const liveAlias = getAlias("live");
      const liveVersion = getVersion(liveAlias.functionVersion);
      const status = await readProfileStatus();
      return Object.freeze({ candidateAlias, liveAlias, liveVersion, status });
    },

    async putRuntimeArtifact(plan) {
      const bytes = await readFile(plan.runtimeArtifact.source);
      if (bytes.length !== plan.runtimeArtifact.bytes || sha256(bytes) !== plan.runtimeArtifact.sha256) throw new Error("runtime artifact changed after handoff verification");
      const args = [
        "s3api", "put-object", "--bucket", artifactBucket, "--key", plan.runtimeArtifact.key, "--body", plan.runtimeArtifact.source,
        "--content-type", "application/java-archive", "--cache-control", "public,max-age=31536000,immutable",
        "--metadata", `eacl-demo-sha256=${plan.runtimeArtifact.sha256},eacl-demo-handoff-sha256=${plan.handoffArtifactSha256},eacl-demo-profile=${profileId}`,
        "--checksum-algorithm", "SHA256", "--checksum-sha256", base64Sha256(plan.runtimeArtifact.sha256),
        "--server-side-encryption", "AES256", "--expected-bucket-owner", accountId, "--if-none-match", "*", ...base
      ];
      const result = awsResult(args, "content-addressed runtime artifact");
      let output = null;
      if (result.ok) output = parseJson(result.stdout, "content-addressed runtime artifact");
      const head = headObject(artifactBucket, plan.runtimeArtifact.key);
      validateArtifactHead(head, plan);
      if (output && output.VersionId !== head.VersionId) throw new Error("runtime artifact version changed during upload");
      return Object.freeze({ bucket: artifactBucket, key: plan.runtimeArtifact.key, versionId: head.VersionId, sha256: plan.runtimeArtifact.sha256 });
    },

    async publishVersion({ plan, artifact, dataManifestSha256 }) {
      if (artifact?.bucket !== artifactBucket || artifact?.key !== plan.runtimeArtifact.key || artifact?.sha256 !== plan.runtimeArtifact.sha256 || !VERSION_ID.test(artifact?.versionId ?? "") || !SHA256.test(dataManifestSha256)) throw new Error("runtime artifact publication coordinates are invalid");
      const beforeCode = latestConfiguration();
      validateFunctionConfiguration(beforeCode, { qualifier: "$LATEST", requireIdentity: false });
      awsJson([
        "lambda", "update-function-code", "--function-name", functionName,
        "--s3-bucket", artifactBucket, "--s3-key", artifact.key, "--s3-object-version", artifact.versionId,
        "--no-publish", "--revision-id", beforeCode.RevisionId, ...base
      ], "Lambda code update");
      waitForFunctionUpdate();
      const afterCode = latestConfiguration();
      if (decodeCodeSha256(afterCode.CodeSha256) !== plan.runtimeArtifact.sha256) throw new Error("Lambda $LATEST code digest does not match the runtime artifact");

      const environment = { ...(afterCode.Environment?.Variables ?? {}) };
      if (afterCode.Environment?.Error || IDENTITY_ENVIRONMENT.some((name) => typeof environment[name] !== "string" || environment[name].length < 1)) throw new Error("Lambda identity environment is incomplete");
      Object.assign(environment, {
        EACL_ARTIFACT_SHA256: plan.runtimeArtifact.sha256,
        EACL_CORE_SHA: plan.source.eaclSha,
        EACL_DEMO_SHA: plan.source.demoSha,
        EACL_DEPLOYMENT_ID: plan.deploymentId
      });
      const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-server-environment-"));
      const environmentPath = path.join(temporary, "environment.json");
      try {
        await writeFile(environmentPath, `${JSON.stringify({ Variables: environment })}\n`, { mode: 0o600, flag: "wx" });
        awsJson([
          "lambda", "update-function-configuration", "--function-name", functionName,
          "--environment", `file://${environmentPath}`, "--revision-id", afterCode.RevisionId, ...base
        ], "Lambda identity configuration update");
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      waitForFunctionUpdate();
      const configured = latestConfiguration();
      validateFunctionConfiguration(configured, { qualifier: "$LATEST", requireIdentity: true, plan });
      const published = awsJson([
        "lambda", "publish-version", "--function-name", functionName,
        "--code-sha256", configured.CodeSha256, "--revision-id", configured.RevisionId,
        "--description", `${plan.deploymentId} sha256:${plan.runtimeArtifact.sha256}`, ...base
      ], "immutable Lambda version publication");
      if (!VERSION.test(published.Version ?? "")) throw new Error("Lambda did not publish an immutable numeric version");
      validateFunctionConfiguration(published, { qualifier: published.Version, requireIdentity: true, plan });
      const observed = getVersion(published.Version);
      validateVersionIdentity(observed, plan);
      return Object.freeze({ version: published.Version, runtimeArtifactSha256: observed.codeSha256 });
    },

    async moveAlias({ currentAlias, toVersion, description }) {
      validateAliasCoordinate(currentAlias);
      if (currentAlias.functionName !== functionName || !VERSION.test(toVersion) || typeof description !== "string" || description.length < 1 || description.length > 256) throw new Error("alias promotion input is invalid");
      const result = awsResult([
        "lambda", "update-alias", "--function-name", functionName, "--name", currentAlias.aliasName,
        "--function-version", toVersion, "--description", description, "--revision-id", currentAlias.revisionId, ...base
      ], `${currentAlias.aliasName} alias promotion`);
      if (result.ok) {
        try { return aliasCoordinate(parseJson(result.stdout, `${currentAlias.aliasName} alias promotion`)); }
        catch { /* Reconcile a successful remote update with a lost or malformed response. */ }
      }
      const observed = getAlias(currentAlias.aliasName);
      if (observed.functionVersion === toVersion && observed.revisionId !== currentAlias.revisionId) return observed;
      if (observed.functionVersion === currentAlias.functionVersion && observed.revisionId === currentAlias.revisionId) throw new Error(`${currentAlias.aliasName} alias promotion failed without mutation`);
      throw new Error(`a newer ${currentAlias.aliasName} alias revision prevents ambiguous-update recovery`);
    },

    async restoreAlias({ currentAlias, priorAlias }) {
      validateAliasCoordinate(currentAlias);
      validateAliasCoordinate(priorAlias);
      if (currentAlias.functionName !== functionName || priorAlias.functionName !== functionName || currentAlias.aliasName !== priorAlias.aliasName) throw new Error("alias rollback target is invalid");
      const observed = getAlias(currentAlias.aliasName);
      if (observed.functionVersion !== currentAlias.functionVersion || observed.revisionId !== currentAlias.revisionId) throw new Error("a newer alias revision prevents rollback");
      const result = awsResult([
        "lambda", "update-alias", "--function-name", functionName, "--name", currentAlias.aliasName,
        "--function-version", priorAlias.functionVersion, "--description", `restored ${priorAlias.functionVersion}`,
        "--revision-id", observed.revisionId, ...base
      ], `${currentAlias.aliasName} alias rollback`);
      let restored = null;
      if (result.ok) {
        try { restored = aliasCoordinate(parseJson(result.stdout, `${currentAlias.aliasName} alias rollback`)); }
        catch { /* Reconcile below. */ }
      }
      if (!restored) {
        const reconciled = getAlias(currentAlias.aliasName);
        if (reconciled.functionVersion === priorAlias.functionVersion && reconciled.revisionId !== observed.revisionId) restored = reconciled;
        else if (reconciled.functionVersion === currentAlias.functionVersion && reconciled.revisionId === currentAlias.revisionId) throw new Error(`${currentAlias.aliasName} alias rollback failed without mutation`);
        else throw new Error(`a newer ${currentAlias.aliasName} alias revision prevents ambiguous-rollback recovery`);
      }
      if (restored.functionVersion !== priorAlias.functionVersion) throw new Error("alias rollback did not restore the exact prior version");
      return restored;
    },

    async smokeCandidate({ plan, deployment }) {
      return smoke({ kind: "staged-cloudfront", origin: staged.href, plan, deployment, merge: true });
    },

    async smokeProduction({ plan, deployment }) {
      return smoke({ kind: "production-cloudfront", origin: production.href, plan, deployment, merge: false });
    },

    async putProfileStatus({ publicationPlan, publication, body, priorStatus }) {
      validateStatusWrite(publicationPlan, publication, body, priorStatus);
      const current = await readProfileStatus();
      if (current.versionId !== priorStatus.versionId || current.etag !== priorStatus.etag || current.publicationId !== priorStatus.publicationId) throw new Error("a newer profile status prevents publication");
      return writeStatus({ body, publication, ifMatch: current.etag, priorStatus, label: "profile status publication" });
    },

    async restoreProfileStatusIfCurrent({ attempt, priorStatus }) {
      if (!attempt || !PUBLICATION_ID.test(attempt.publicationId ?? "") || !SHA256.test(attempt.bodySha256 ?? "")) throw new Error("profile status rollback attempt is invalid");
      validateStatusRecord(priorStatus);
      const observed = await readProfileStatus();
      if (observed.publicationId === priorStatus.publicationId && observed.etag === priorStatus.etag && observed.body === priorStatus.body) return observed;
      if (observed.publicationId !== attempt.publicationId || sha256(Buffer.from(observed.body)) !== attempt.bodySha256) throw new Error("a newer profile status prevents rollback");
      const restored = await writeStatus({ body: priorStatus.body, publication: priorStatus.publication, ifMatch: observed.etag, priorStatus: observed, label: "profile status rollback" });
      if (restored.publicationId !== priorStatus.publicationId || restored.body !== priorStatus.body) throw new Error("profile status rollback did not restore the exact prior body");
      await verifyPublicPublication(priorStatus.publication);
      return restored;
    },

    async verifyPublicStatus({ plan, publication, status }) {
      if (plan.profileId !== profileId || status.publicationId !== publication.publicationId) throw new Error("public profile status verification input is invalid");
      await verifyPublicPublication(publication);
    }
  };
  return Object.freeze(adapter);

  function awsResult(args, label) {
    if (!Array.isArray(args) || args.some((value) => typeof value !== "string" || value.includes("\0"))) throw new Error("AWS argument closure is invalid");
    const result = runAws(args);
    if (!result || typeof result.ok !== "boolean" || typeof result.stdout !== "string") throw new Error(`${label} runner returned an invalid result`);
    return result;
  }

  function awsJson(args, label, { allowEmpty = false } = {}) {
    const result = awsResult(args, label);
    if (!result.ok) throw new Error(`${label} failed`);
    if (allowEmpty && result.stdout.trim() === "") return {};
    return parseJson(result.stdout, label);
  }

  function assertBucket(bucket, component) {
    const versioning = awsJson(["s3api", "get-bucket-versioning", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], `${component} bucket versioning`);
    if (versioning.Status !== "Enabled") throw new Error(`${component} bucket versioning is not enabled`);
    const access = awsJson(["s3api", "get-public-access-block", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], `${component} public access block`).PublicAccessBlockConfiguration;
    if (!access || ["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"].some((key) => access[key] !== true)) throw new Error(`${component} bucket public access block is incomplete`);
    const ownership = awsJson(["s3api", "get-bucket-ownership-controls", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], `${component} bucket ownership`);
    if (JSON.stringify(ownership.OwnershipControls?.Rules) !== JSON.stringify([{ ObjectOwnership: "BucketOwnerEnforced" }])) throw new Error(`${component} bucket ownership is invalid`);
    const encryption = awsJson(["s3api", "get-bucket-encryption", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], `${component} bucket encryption`);
    const algorithms = encryption.ServerSideEncryptionConfiguration?.Rules?.map((rule) => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm);
    if (JSON.stringify(algorithms) !== JSON.stringify(["AES256"])) throw new Error(`${component} bucket must use SSE-S3 only`);
    const tags = Object.fromEntries((awsJson(["s3api", "get-bucket-tagging", "--bucket", bucket, "--expected-bucket-owner", accountId, ...base], `${component} bucket tags`).TagSet ?? []).map(({ Key, Value }) => [Key, Value]));
    if (tags.Project !== "eacl-demo" || tags.Component !== component) throw new Error(`${component} bucket identity tags are invalid`);
  }

  function assertCloudFrontRoute({ distributionId, cachePolicyId, originRequestPolicyId, viewerRequestFunctionArn, originAccessControlId, responseHeadersPolicyId, trustedOrigin, aliasName }) {
    const url = awsJson(["lambda", "get-function-url-config", "--function-name", functionName, "--qualifier", aliasName, ...base], `${aliasName} Function URL`);
    const functionUrl = new URL(url.FunctionUrl);
    if (url.AuthType !== "AWS_IAM" || url.InvokeMode !== "BUFFERED" || functionUrl.protocol !== "https:" || functionUrl.pathname !== "/" || functionUrl.search || functionUrl.hash) throw new Error(`${aliasName} Function URL is not the exact IAM-only buffered origin`);
    const distribution = awsJson(["cloudfront", "get-distribution", "--id", distributionId, "--no-cli-pager"], `${aliasName} CloudFront distribution`).Distribution;
    const config = distribution?.DistributionConfig;
    const domains = new Set([distribution?.DomainName, ...(config?.Aliases?.Items ?? [])]);
    if (distribution?.Id !== distributionId || distribution.Status !== "Deployed" || config?.Enabled !== true || !domains.has(trustedOrigin.hostname)) throw new Error(`${aliasName} CloudFront distribution identity is invalid`);
    const behavior = config.CacheBehaviors?.Items?.find(({ PathPattern }) => PathPattern === `api/v1/${profileId}/*`);
    const allowedMethods = [...(behavior?.AllowedMethods?.Items ?? [])].sort();
    const cachedMethods = [...(behavior?.AllowedMethods?.CachedMethods?.Items ?? [])].sort();
    const functions = behavior?.FunctionAssociations;
    if (!behavior || behavior.CachePolicyId !== cachePolicyId || behavior.OriginRequestPolicyId !== originRequestPolicyId || behavior.ResponseHeadersPolicyId !== responseHeadersPolicyId || behavior.ViewerProtocolPolicy !== "redirect-to-https" || behavior.Compress !== false || JSON.stringify(allowedMethods) !== JSON.stringify(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]) || JSON.stringify(cachedMethods) !== JSON.stringify(["GET", "HEAD"]) || functions?.Quantity !== 1 || functions.Items?.length !== 1 || functions.Items[0]?.EventType !== "viewer-request" || functions.Items[0]?.FunctionARN !== viewerRequestFunctionArn) throw new Error(`${aliasName} CloudFront behavior is not the exact non-cached profile route`);
    const origin = config.Origins?.Items?.find(({ Id }) => Id === behavior.TargetOriginId);
    if (!origin || origin.DomainName !== functionUrl.hostname || origin.OriginPath !== "" || origin.OriginAccessControlId !== originAccessControlId || origin.OriginCustomHeaders?.Quantity !== 0 || origin.CustomOriginConfig?.OriginProtocolPolicy !== "https-only" || JSON.stringify(origin.CustomOriginConfig?.OriginSslProtocols?.Items) !== JSON.stringify(["TLSv1.2"])) throw new Error(`${aliasName} CloudFront route does not target the exact alias Function URL`);
  }

  function latestConfiguration() {
    return awsJson(["lambda", "get-function-configuration", "--function-name", functionName, ...base], "Lambda $LATEST configuration");
  }

  function waitForFunctionUpdate() {
    awsJson(["lambda", "wait", "function-updated-v2", "--function-name", functionName, ...base], "Lambda update wait", { allowEmpty: true });
  }

  function validateFunctionConfiguration(configuration, { qualifier, requireIdentity, plan = null }) {
    if (configuration.FunctionName !== functionName || configuration.Runtime !== runtime.runtime || configuration.Handler !== runtime.handler || configuration.PackageType !== "Zip" || JSON.stringify(configuration.Architectures) !== JSON.stringify([runtime.architecture]) || configuration.State !== "Active" || configuration.LastUpdateStatus !== "Successful" || configuration.SnapStart?.ApplyOn !== runtime.snapStart || !REVISION.test(configuration.RevisionId ?? "")) throw new Error(`Lambda ${qualifier} topology/configuration is invalid`);
    if (qualifier !== "$LATEST" && configuration.Version !== qualifier) throw new Error("published Lambda version identity is invalid");
    if (requireIdentity) {
      const variables = configuration.Environment?.Variables;
      if (configuration.Environment?.Error || !variables || variables.EACL_ARTIFACT_SHA256 !== plan.runtimeArtifact.sha256 || variables.EACL_CORE_SHA !== plan.source.eaclSha || variables.EACL_DEMO_SHA !== plan.source.demoSha || variables.EACL_DEPLOYMENT_ID !== plan.deploymentId || decodeCodeSha256(configuration.CodeSha256) !== plan.runtimeArtifact.sha256) throw new Error(`Lambda ${qualifier} immutable identity is invalid`);
    }
  }

  function getAlias(name) {
    return aliasCoordinate(awsJson(["lambda", "get-alias", "--function-name", functionName, "--name", name, ...base], `${name} alias`));
  }

  function getVersion(version) {
    if (!VERSION.test(version)) throw new Error("Lambda version qualifier is invalid");
    const configuration = awsJson(["lambda", "get-function-configuration", "--function-name", functionName, "--qualifier", version, ...base], `Lambda version ${version}`);
    validateFunctionConfiguration(configuration, { qualifier: version, requireIdentity: false });
    const environment = Object.fromEntries(IDENTITY_ENVIRONMENT.map((key) => [key, configuration.Environment?.Variables?.[key] ?? null]));
    if (Object.values(environment).some((value) => typeof value !== "string" || value.length < 1)) throw new Error("published Lambda version lacks identity environment");
    return Object.freeze({ functionName, functionVersion: version, codeSha256: decodeCodeSha256(configuration.CodeSha256), environment: Object.freeze(environment) });
  }

  function validateVersionIdentity(version, plan) {
    if (version.codeSha256 !== plan.runtimeArtifact.sha256 || version.environment.EACL_ARTIFACT_SHA256 !== plan.runtimeArtifact.sha256 || version.environment.EACL_CORE_SHA !== plan.source.eaclSha || version.environment.EACL_DEMO_SHA !== plan.source.demoSha || version.environment.EACL_DEPLOYMENT_ID !== plan.deploymentId) throw new Error("published Lambda version does not contain the exact deployment identity");
  }

  async function readProfileStatus() {
    const key = `registry/profiles/${profileId}.json`;
    const head = headObject(statusBucket, key);
    validateStatusHead(head, key);
    const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-profile-status-"));
    const output = path.join(temporary, `${profileId}.json`);
    try {
      const result = awsJson(["s3api", "get-object", "--bucket", statusBucket, "--key", key, "--version-id", head.VersionId, "--checksum-mode", "ENABLED", "--expected-bucket-owner", accountId, output, ...base], "profile status body");
      const bytes = await readFile(output);
      const digest = sha256(bytes);
      if (bytes.length < 1 || bytes.length > MAXIMUM_STATUS_BYTES || bytes.length !== head.ContentLength || result.VersionId !== head.VersionId || digest !== decodeChecksum(result.ChecksumSHA256 ?? head.ChecksumSHA256) || digest !== head.Metadata?.["eacl-demo-sha256"]) throw new Error("profile status body identity is invalid");
      const body = bytes.toString("utf8");
      const publication = parseJson(body, "profile status body");
      await verifyProfilePublication(publication, definition, catalogProfile);
      const publicationId = head.Metadata?.["eacl-demo-publication-id"];
      if (publicationId !== publication.publicationId) throw new Error("profile status publication metadata is invalid");
      return Object.freeze({ bucket: statusBucket, key, etag: head.ETag, versionId: head.VersionId, publicationId, body, publication });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async function writeStatus({ body, publication, ifMatch, priorStatus, label }) {
    const bytes = Buffer.from(body);
    if (bytes.length < 1 || bytes.length > MAXIMUM_STATUS_BYTES || !ETAG.test(ifMatch) || publication.profile.id !== profileId || publication.publicationId !== publicationIdFromBody(body)) throw new Error(`${label} input is invalid`);
    const key = `registry/profiles/${profileId}.json`;
    const digest = sha256(bytes);
    const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-profile-status-write-"));
    const source = path.join(temporary, `${profileId}.json`);
    try {
      await writeFile(source, bytes, { mode: 0o600, flag: "wx" });
      const result = awsResult([
        "s3api", "put-object", "--bucket", statusBucket, "--key", key, "--body", source,
        "--content-type", "application/json; charset=utf-8", "--cache-control", "no-cache,max-age=0,must-revalidate",
        "--metadata", `eacl-demo-publication-id=${publication.publicationId},eacl-demo-sha256=${digest},eacl-demo-profile=${profileId}`,
        "--checksum-algorithm", "SHA256", "--checksum-sha256", base64Sha256(digest), "--server-side-encryption", "AES256",
        "--expected-bucket-owner", accountId, "--if-match", ifMatch, ...base
      ], label);
      let output = null;
      if (result.ok) output = parseJson(result.stdout, label);
      const current = await readProfileStatus();
      if (current.publicationId === publication.publicationId && current.body === body) {
        if (output && output.VersionId !== current.versionId) throw new Error(`${label} was superseded before verification`);
        return current;
      }
      if (!result.ok) throw new Error(`${label} failed`);
      if (current.versionId === priorStatus.versionId) throw new Error(`${label} did not create a new version`);
      throw new Error(`${label} was superseded before verification`);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async function smoke({ kind, origin, plan, deployment, merge }) {
    const target = qualificationTarget({ kind, baseUrl: `${origin.replace(/\/$/u, "")}${plan.route}`, profileId });
    assertTrustedCloudFrontOrigin(target, origin);
    const identity = { profileId, demoSha: deployment.demoSha, eaclSha: deployment.eaclSha, artifactSha256: deployment.artifact.sha256, deploymentId: deployment.deploymentId, dataManifestSha256: deployment.dataManifestSha256 };
    const transport = createHttpQualificationTransport(target, { fetchImpl, requestIdPrefix: `ordinary-${profileId}` });
    try {
      if (!merge) return runProductionRecheck({ transport, expectedIdentity: identity, target: reportableTarget(target) });
      const exemplars = parseJson(await readFile(path.join(root, "fixtures", "exemplars.v1.json"), "utf8"), "merge smoke exemplars");
      return runMergeSmoke({ transport, expectedIdentity: identity, target: reportableTarget(target), allowedDemand: demand(exemplars, "direct-owner-allow", true), deniedDemand: demand(exemplars, "direct-owner-deny", false) });
    } finally {
      await transport.release();
    }
  }

  async function verifyPublicPublication(publication) {
    const url = new URL(`/registry/profiles/${profileId}.json`, production);
    const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    if (!response?.ok || response.status !== 200 || response.redirected === true || (response.url && response.url !== url.href)) throw new Error("public profile status request failed");
    const contentType = response.headers?.get?.("content-type") ?? "";
    const cacheControl = (response.headers?.get?.("cache-control") ?? "").toLowerCase().replaceAll(" ", "");
    if (contentType.toLowerCase() !== "application/json; charset=utf-8" || cacheControl !== "no-cache,max-age=0,must-revalidate") throw new Error("public profile status headers are invalid");
    const declared = response.headers?.get?.("content-length");
    if (declared && (!/^[0-9]{1,5}$/u.test(declared) || Number(declared) > MAXIMUM_STATUS_BYTES)) throw new Error("public profile status exceeded its byte bound");
    const bytes = await readBoundedResponse(response, MAXIMUM_STATUS_BYTES);
    if (bytes.length < 1) throw new Error("public profile status body is empty");
    const observed = parseJson(bytes.toString("utf8"), "public profile status");
    await verifyProfilePublication(observed, definition, catalogProfile);
    if (observed.publicationId !== publication.publicationId || JSON.stringify(observed) !== JSON.stringify(publication)) throw new Error("public profile status identity mismatch");
  }

  function headObject(bucket, key) {
    if (!BUCKET.test(bucket) || !/^[A-Za-z0-9._/-]+$/u.test(key) || key.startsWith("/") || key.split("/").includes("..")) throw new Error("S3 object coordinate is invalid");
    return awsJson(["s3api", "head-object", "--bucket", bucket, "--key", key, "--checksum-mode", "ENABLED", "--expected-bucket-owner", accountId, ...base], `S3 object head ${key}`);
  }
}

function validateCoordinates(input) {
  const functionArn = new RegExp(`^arn:aws:cloudfront::${input.accountId}:function/[A-Za-z0-9-_]{1,64}$`, "u");
  if (typeof input.root !== "string" || !path.isAbsolute(input.root) || !ACCOUNT.test(input.accountId) || !REGION.test(input.region) || !RUNTIMES[input.profileId] || !FUNCTION.test(input.functionName) || !BUCKET.test(input.artifactBucket) || !BUCKET.test(input.statusBucket) || !DISTRIBUTION.test(input.stagedDistributionId) || !DISTRIBUTION.test(input.productionDistributionId) || !CACHE_POLICY.test(input.stagedApiCachePolicyId) || !CACHE_POLICY.test(input.productionApiCachePolicyId) || !CACHE_POLICY.test(input.stagedApiOriginRequestPolicyId) || !CACHE_POLICY.test(input.productionApiOriginRequestPolicyId) || !functionArn.test(input.stagedApiViewerRequestFunctionArn ?? "") || !functionArn.test(input.productionApiViewerRequestFunctionArn ?? "") || !DISTRIBUTION.test(input.stagedLambdaOriginAccessControlId) || !DISTRIBUTION.test(input.productionLambdaOriginAccessControlId) || !CACHE_POLICY.test(input.stagedSecurityHeadersPolicyId) || !CACHE_POLICY.test(input.productionSecurityHeadersPolicyId) || typeof input.fetchImpl !== "function") throw new Error("server AWS adapter coordinates are invalid");
}

function exactHttpsOrigin(value, label) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password || url.port) throw new Error(`${label} CloudFront origin is invalid`);
  return url;
}

function aliasCoordinate(value) {
  const coordinate = { functionName: value?.FunctionName, aliasName: value?.Name, functionVersion: value?.FunctionVersion, revisionId: value?.RevisionId };
  validateAliasCoordinate(coordinate);
  return Object.freeze(coordinate);
}

function validateAliasCoordinate(value) {
  if (!value || !FUNCTION.test(value.functionName ?? "") || !/^(?:candidate|live)$/u.test(value.aliasName ?? "") || !VERSION.test(value.functionVersion ?? "") || !REVISION.test(value.revisionId ?? "")) throw new Error("Lambda alias coordinates are invalid");
}

function validateArtifactHead(head, plan) {
  if (!VERSION_ID.test(head?.VersionId ?? "") || head.ContentLength !== plan.runtimeArtifact.bytes || head.Metadata?.["eacl-demo-sha256"] !== plan.runtimeArtifact.sha256 || head.Metadata?.["eacl-demo-handoff-sha256"] !== plan.handoffArtifactSha256 || head.Metadata?.["eacl-demo-profile"] !== plan.profileId || head.ServerSideEncryption !== "AES256" || head.ContentType?.toLowerCase() !== "application/java-archive" || head.CacheControl?.toLowerCase() !== "public,max-age=31536000,immutable" || decodeChecksum(head.ChecksumSHA256) !== plan.runtimeArtifact.sha256) throw new Error("runtime artifact S3 identity is invalid");
}

function validateStatusHead(head, key) {
  if (!VERSION_ID.test(head?.VersionId ?? "") || !ETAG.test(head?.ETag ?? "") || !Number.isSafeInteger(head.ContentLength) || head.ContentLength < 1 || head.ContentLength > MAXIMUM_STATUS_BYTES || head.ServerSideEncryption !== "AES256" || head.ContentType?.toLowerCase() !== "application/json; charset=utf-8" || head.CacheControl?.toLowerCase().replaceAll(" ", "") !== "no-cache,max-age=0,must-revalidate" || !PUBLICATION_ID.test(head.Metadata?.["eacl-demo-publication-id"] ?? "") || !SHA256.test(head.Metadata?.["eacl-demo-sha256"] ?? "") || head.Metadata?.["eacl-demo-profile"] !== key.split("/").at(-1).replace(/\.json$/u, "")) throw new Error("profile status S3 identity is invalid");
}

function validateStatusRecord(status) {
  if (!status || !BUCKET.test(status.bucket ?? "") || !/^registry\/profiles\/[a-z0-9-]+\.json$/u.test(status.key ?? "") || !ETAG.test(status.etag ?? "") || !VERSION_ID.test(status.versionId ?? "") || !PUBLICATION_ID.test(status.publicationId ?? "") || typeof status.body !== "string" || !status.publication) throw new Error("profile status rollback record is invalid");
}

function validateStatusWrite(plan, publication, body, priorStatus) {
  validateStatusRecord(priorStatus);
  if (plan?.schema !== "eacl-demo.profile-publication-plan.v2" || plan.profileId !== publication?.profile?.id || plan.profileId !== priorStatus.publication.profile.id || plan.publicObject.bodySha256 !== sha256(Buffer.from(body)) || plan.preconditions.statusObject.ifMatch !== priorStatus.etag || plan.promotion.statusObject.key !== priorStatus.key || plan.promotion.statusObject.bucket !== priorStatus.bucket) throw new Error("profile status write does not match its closed publication plan");
}

function demand(exemplars, id, allowed) {
  const exemplar = exemplars?.cases?.find((candidate) => candidate.id === id);
  if (exemplar?.kind !== "decision" || exemplar.expected?.allowed !== allowed || !exemplar.demand) throw new Error(`canonical merge-smoke exemplar is invalid: ${id}`);
  return exemplar.demand;
}

function publicationIdFromBody(body) {
  try { return JSON.parse(body).publicationId; }
  catch { return null; }
}

function decodeCodeSha256(value) {
  if (typeof value !== "string") throw new Error("Lambda code digest is missing");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) throw new Error("Lambda code digest is invalid");
  return bytes.toString("hex");
}

function decodeChecksum(value) {
  if (typeof value !== "string") throw new Error("S3 checksum is missing");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value) throw new Error("S3 checksum is invalid");
  return bytes.toString("hex");
}

function base64Sha256(hex) { return Buffer.from(hex, "hex").toString("base64"); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function parseJson(source, label) {
  try { return JSON.parse(source); }
  catch { throw new Error(`${label} returned invalid JSON`); }
}

function defaultRunAws(args) {
  const result = spawnSync("aws", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return { ok: result.status === 0 && result.signal === null, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function readBoundedResponse(response, maximumBytes) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) throw new Error("public profile status exceeded its byte bound");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel("public profile status exceeded its byte bound");
        throw new Error("public profile status exceeded its byte bound");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}
