import { createHash } from "node:crypto";
import path from "node:path";

import { verifyProfilePublication } from "../../packages/explorer-state/src/profile-publication.mjs";
import {
  createFailedDeploymentPublication,
  createOrdinaryDeploymentPublication
} from "../../packages/qualification/src/publication-gates.mjs";
import { validateMergeSmoke } from "../../packages/qualification/src/merge-smoke.mjs";
import { validateProductionRecheck } from "../../packages/qualification/src/production-recheck.mjs";
import { createServerProfilePublicationPlan } from "./profile-publication-plan.mjs";

const SERVER_TARGETS = new Set(["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory"]);
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const VERSION = /^[1-9][0-9]*$/u;
const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

export function createServerPublicationPlan({ target, artifactDirectory, artifactManifest, deploymentId, deployedAt }) {
  if (!SERVER_TARGETS.has(target)) throw new Error("ordinary server target is not registered");
  if (typeof artifactDirectory !== "string" || !path.isAbsolute(artifactDirectory)) throw new Error("ordinary server artifact directory must be absolute");
  if (artifactManifest?.schema !== "eacl-demo.ordinary-artifact.v1" || artifactManifest.target !== target) throw new Error("server publication requires the verified same-target ordinary artifact");
  if (!SHA1.test(artifactManifest.demoSha) || !SHA1.test(artifactManifest.eaclSha) || !SHA256.test(artifactManifest.artifactSha256)) throw new Error("ordinary server artifact identity is invalid");
  if (!DEPLOYMENT_ID.test(deploymentId)) throw new Error("ordinary server deployment ID is invalid");
  if (!isCanonicalTimestamp(deployedAt)) throw new Error("ordinary server deployment timestamp is invalid");
  if (!Array.isArray(artifactManifest.files) || artifactManifest.files.length !== 1) throw new Error("ordinary server handoff must contain exactly one runtime artifact");
  const file = artifactManifest.files[0];
  if (file?.path !== "payload/function.jar" || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !SHA256.test(file.sha256)) throw new Error("ordinary server handoff must contain one content-addressed function.jar");
  const source = path.join(artifactDirectory, "payload", "function.jar");
  return Object.freeze({
    schema: "eacl-demo.server-publication-plan.v1",
    profileId: target,
    route: "/",
    source: Object.freeze({ demoSha: artifactManifest.demoSha, eaclSha: artifactManifest.eaclSha }),
    handoffArtifactSha256: artifactManifest.artifactSha256,
    runtimeArtifact: Object.freeze({
      source,
      bytes: file.bytes,
      sha256: file.sha256,
      key: `artifacts/${target}/${artifactManifest.demoSha}/${file.sha256}.jar`
    }),
    deploymentId,
    deployedAt
  });
}

export async function executeServerPublication({ plan, adapter, profileDefinitions, baseRegistry, clock = () => new Date().toISOString() }) {
  validatePlan(plan);
  validateAdapter(adapter);
  const definition = profileDefinitions?.profiles?.find(({ id }) => id === plan.profileId);
  const catalogProfile = baseRegistry?.profiles?.find(({ id }) => id === plan.profileId);
  if (!definition || !catalogProfile) throw new Error("ordinary server profile is outside the closed catalog");

  await adapter.assertFoundation(plan);
  const baseline = await validatedState(await adapter.readProfileState(plan.profileId), { definition, catalogProfile });
  assertEnabledBaseline(baseline, plan);
  const originalCandidate = structuredClone(baseline.candidateAlias);
  const originalLive = structuredClone(baseline.liveAlias);
  let candidateAfter = null;
  let liveAfter = null;
  let statusAfter = null;
  let statusAttempt = null;
  let deployment = null;

  try {
    const artifact = await adapter.putRuntimeArtifact(plan);
    const published = await adapter.publishVersion({
      plan,
      artifact,
      dataManifestSha256: baseline.status.publication.profile.deployment.dataManifestSha256
    });
    if (!VERSION.test(published?.version) || published.runtimeArtifactSha256 !== plan.runtimeArtifact.sha256) throw new Error("published Lambda version identity is invalid");
    deployment = Object.freeze({
      demoSha: plan.source.demoSha,
      eaclSha: plan.source.eaclSha,
      artifact: Object.freeze({ kind: "lambda-version", sha256: plan.runtimeArtifact.sha256, version: published.version }),
      deploymentId: plan.deploymentId,
      dataManifestSha256: baseline.status.publication.profile.deployment.dataManifestSha256,
      deployedAt: plan.deployedAt
    });

    candidateAfter = await adapter.moveAlias({ currentAlias: baseline.candidateAlias, toVersion: published.version, description: `candidate ${plan.deploymentId}` });
    assertMovedAlias(candidateAfter, baseline.candidateAlias, published.version, "candidate");
    const smoke = await adapter.smokeCandidate({ plan, deployment });
    validateMergeSmoke(smoke, { profile: { id: plan.profileId, route: plan.route }, deployment });

    const beforePromotion = await validatedState(await adapter.readProfileState(plan.profileId), { definition, catalogProfile });
    assertUnchangedBaseline(beforePromotion, baseline, candidateAfter);
    liveAfter = await adapter.moveAlias({ currentAlias: beforePromotion.liveAlias, toVersion: published.version, description: `live ${plan.deploymentId}` });
    assertMovedAlias(liveAfter, beforePromotion.liveAlias, published.version, "live");
    const productionRecheck = await adapter.smokeProduction({ plan, deployment });
    validateProductionRecheck(productionRecheck, { profile: { id: plan.profileId, route: plan.route }, deployment });

    const publishedAt = clock();
    const publication = await createOrdinaryDeploymentPublication({
      baseRegistry: { profiles: [structuredClone(baseline.status.publication.profile)] },
      profileDefinitions,
      profileId: plan.profileId,
      deployment,
      smoke,
      productionRecheck,
      publishedAt
    }, { now: publishedAt });
    const body = publicationBody(publication);
    const publicationPlan = createServerProfilePublicationPlan({
      publication,
      activeAlias: liveAfter,
      rollbackAlias: originalLive,
      currentStatus: statusCoordinates(baseline.status),
      bodySha256: sha256Text(body)
    });
    statusAttempt = Object.freeze({ publicationId: publication.publicationId, bodySha256: publicationPlan.publicObject.bodySha256 });
    statusAfter = await adapter.putProfileStatus({ publicationPlan, publication, body, priorStatus: baseline.status });
    await adapter.verifyPublicStatus({ plan, publication, status: statusAfter });
    return Object.freeze({
      profileId: plan.profileId,
      deployment,
      stagedSmokeEvidenceId: smoke.evidenceId,
      productionRecheckEvidenceId: productionRecheck.evidenceId,
      publicationId: publication.publicationId,
      statusVersionId: statusAfter.versionId
    });
  } catch (error) {
    const rollbackErrors = [];
    let expectedStatus = baseline.status;
    let expectedLive = originalLive;
    let expectedCandidate = originalCandidate;
    if (statusAttempt) await attempt(rollbackErrors, "profile status rollback", async () => { expectedStatus = await adapter.restoreProfileStatusIfCurrent({ attempt: statusAttempt, priorStatus: baseline.status }); });
    if (liveAfter) await attempt(rollbackErrors, "live alias rollback", async () => { expectedLive = await adapter.restoreAlias({ currentAlias: liveAfter, priorAlias: originalLive }); });
    if (candidateAfter) await attempt(rollbackErrors, "candidate alias rollback", async () => { expectedCandidate = await adapter.restoreAlias({ currentAlias: candidateAfter, priorAlias: originalCandidate }); });

    if (rollbackErrors.length === 0) {
      await attempt(rollbackErrors, "failed-attempt status publication", async () => {
        const restored = await validatedState(await adapter.readProfileState(plan.profileId), { definition, catalogProfile });
        assertFailurePublicationBase(restored, { status: expectedStatus, liveAlias: expectedLive, candidateAlias: expectedCandidate });
        const failedAt = clock();
        const failed = await createFailedDeploymentPublication({
          baseRegistry: { profiles: [structuredClone(baseline.status.publication.profile)] },
          profileDefinitions,
          profileId: plan.profileId,
          attemptedIdentity: {
            demoSha: plan.source.demoSha,
            eaclSha: plan.source.eaclSha,
            artifactSha256: plan.runtimeArtifact.sha256
          },
          failedAt,
          publishedAt: failedAt,
          message: safeFailureMessage(error)
        }, { now: failedAt });
        const body = publicationBody(failed);
        const failedPlan = createServerProfilePublicationPlan({
          publication: failed,
          activeAlias: restored.liveAlias,
          rollbackAlias: null,
          currentStatus: statusCoordinates(restored.status),
          bodySha256: sha256Text(body)
        });
        const failedStatus = await adapter.putProfileStatus({ publicationPlan: failedPlan, publication: failed, body, priorStatus: restored.status });
        await adapter.verifyPublicStatus({ plan, publication: failed, status: failedStatus });
      });
    }
    if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], "ordinary server publication failed and cleanup/reporting was incomplete");
    throw error;
  }
}

async function validatedState(state, { definition, catalogProfile }) {
  exactKeys(state, ["candidateAlias", "liveAlias", "liveVersion", "status"], "server profile state");
  validateAlias(state.candidateAlias);
  validateAlias(state.liveAlias);
  if (state.candidateAlias.functionName !== state.liveAlias.functionName || state.candidateAlias.aliasName !== "candidate" || state.liveAlias.aliasName !== "live") throw new Error("server aliases are not the exact candidate/live pair");
  exactKeys(state.liveVersion, ["functionName", "functionVersion", "codeSha256", "environment"], "live Lambda version");
  if (state.liveVersion.functionName !== state.liveAlias.functionName || state.liveVersion.functionVersion !== state.liveAlias.functionVersion || !SHA256.test(state.liveVersion.codeSha256)) throw new Error("live Lambda version does not match the live alias");
  validateStatus(state.status, definition.id);
  await verifyProfilePublication(state.status.publication, definition, catalogProfile);
  if (state.status.publication.publicationId !== state.status.publicationId) throw new Error("profile status metadata does not match its publication body");
  return state;
}

function assertEnabledBaseline(state, plan) {
  const profile = state.status.publication.profile;
  if (profile.id !== plan.profileId || profile.route !== plan.route || profile.state !== "enabled" || !profile.deployment) throw new Error("ordinary server deployment cannot perform initial enablement");
  if (profile.deployment.artifact.kind !== "lambda-version" || profile.deployment.artifact.version !== state.liveAlias.functionVersion) throw new Error("current profile status does not match the live alias");
  const expected = {
    EACL_DEMO_SHA: profile.deployment.demoSha,
    EACL_CORE_SHA: profile.deployment.eaclSha,
    EACL_ARTIFACT_SHA256: profile.deployment.artifact.sha256,
    EACL_DEPLOYMENT_ID: profile.deployment.deploymentId
  };
  for (const [key, value] of Object.entries(expected)) if (state.liveVersion.environment?.[key] !== value) throw new Error(`live Lambda identity does not match profile status: ${key}`);
  if (state.liveVersion.codeSha256 !== profile.deployment.artifact.sha256) throw new Error("live Lambda code digest does not match profile status");
}

function assertUnchangedBaseline(current, baseline, candidateAfter) {
  if (current.status.versionId !== baseline.status.versionId || current.status.etag !== baseline.status.etag || current.status.publicationId !== baseline.status.publicationId) throw new Error("profile status changed before alias promotion");
  if (current.liveAlias.functionVersion !== baseline.liveAlias.functionVersion || current.liveAlias.revisionId !== baseline.liveAlias.revisionId) throw new Error("live alias changed before promotion");
  if (current.candidateAlias.functionVersion !== candidateAfter.functionVersion || current.candidateAlias.revisionId !== candidateAfter.revisionId) throw new Error("candidate alias changed before promotion");
}

function assertFailurePublicationBase(current, expected) {
  if (current.status.publicationId !== expected.status.publicationId || current.status.etag !== expected.status.etag || current.status.versionId !== expected.status.versionId || current.status.body !== expected.status.body) throw new Error("a newer profile status prevents failed-attempt publication");
  if (current.liveAlias.functionVersion !== expected.liveAlias.functionVersion || current.liveAlias.revisionId !== expected.liveAlias.revisionId) throw new Error("the prior live alias was not restored or changed after restoration");
  if (current.candidateAlias.functionVersion !== expected.candidateAlias.functionVersion || current.candidateAlias.revisionId !== expected.candidateAlias.revisionId) throw new Error("the prior candidate alias was not restored or changed after restoration");
}

function assertMovedAlias(actual, previous, toVersion, label) {
  validateAlias(actual);
  if (actual.functionName !== previous.functionName || actual.aliasName !== previous.aliasName || actual.functionVersion !== toVersion || actual.revisionId === previous.revisionId) throw new Error(`${label} alias promotion did not produce the exact new revision`);
}

function validatePlan(plan) {
  exactKeys(plan, ["schema", "profileId", "route", "source", "handoffArtifactSha256", "runtimeArtifact", "deploymentId", "deployedAt"], "server publication plan");
  if (plan.schema !== "eacl-demo.server-publication-plan.v1" || !SERVER_TARGETS.has(plan.profileId) || plan.route !== "/") throw new Error("server publication plan identity is invalid");
  exactKeys(plan.source, ["demoSha", "eaclSha"], "server publication source");
  exactKeys(plan.runtimeArtifact, ["source", "bytes", "sha256", "key"], "server runtime artifact");
  const expectedKey = `artifacts/${plan.profileId}/${plan.source.demoSha}/${plan.runtimeArtifact.sha256}.jar`;
  if (!SHA1.test(plan.source.demoSha) || !SHA1.test(plan.source.eaclSha) || !SHA256.test(plan.handoffArtifactSha256) || !SHA256.test(plan.runtimeArtifact.sha256) || !Number.isSafeInteger(plan.runtimeArtifact.bytes) || plan.runtimeArtifact.bytes < 1 || typeof plan.runtimeArtifact.source !== "string" || !path.isAbsolute(plan.runtimeArtifact.source) || path.basename(plan.runtimeArtifact.source) !== "function.jar" || plan.runtimeArtifact.key !== expectedKey || !DEPLOYMENT_ID.test(plan.deploymentId) || !isCanonicalTimestamp(plan.deployedAt)) throw new Error("server publication plan values are invalid");
}

function validateAdapter(adapter) {
  for (const method of ["assertFoundation", "readProfileState", "putRuntimeArtifact", "publishVersion", "moveAlias", "restoreAlias", "smokeCandidate", "smokeProduction", "putProfileStatus", "restoreProfileStatusIfCurrent", "verifyPublicStatus"]) {
    if (typeof adapter?.[method] !== "function") throw new Error(`server publication adapter is missing ${method}`);
  }
}

function validateAlias(alias) {
  exactKeys(alias, ["functionName", "aliasName", "functionVersion", "revisionId"], "Lambda alias");
  if (![alias.functionName, alias.aliasName, alias.revisionId].every((value) => typeof value === "string" && value.length > 0) || !VERSION.test(alias.functionVersion)) throw new Error("Lambda alias coordinates are invalid");
}

function validateStatus(status, profileId) {
  exactKeys(status, ["bucket", "key", "etag", "versionId", "publicationId", "body", "publication"], "profile status");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(status.bucket ?? "") || status.key !== `registry/profiles/${profileId}.json` || !/^"[0-9a-f]{32}(?:-[1-9][0-9]*)?"$/u.test(status.etag ?? "") || typeof status.versionId !== "string" || status.versionId.length < 1 || status.versionId.length > 1024 || !/^sha256:[0-9a-f]{64}$/u.test(status.publicationId ?? "") || typeof status.body !== "string" || Buffer.byteLength(status.body) < 1 || Buffer.byteLength(status.body) > 65_536 || status.publication?.publicationId !== status.publicationId) throw new Error("profile status rollback coordinates are incomplete");
}

function statusCoordinates(status) {
  return { exists: true, bucket: status.bucket, key: status.key, etag: status.etag, versionId: status.versionId, publicationId: status.publicationId };
}

function publicationBody(publication) { return `${JSON.stringify(publication, null, 2)}\n`; }

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function attempt(errors, label, operation) {
  try { await operation(); }
  catch (error) { errors.push(new Error(`${label} failed`, { cause: error })); }
}

function safeFailureMessage(error) {
  const message = String(error?.message ?? "Candidate deployment failed; the prior healthy profile was retained.")
    .replace(/https?:\/\/\S+|\/(?:Users|home|var|tmp)\/\S+/giu, "[redacted]")
    .replace(/[A-Za-z0-9+/]{32,}={0,2}/gu, "[redacted]")
    .trim();
  return (message || "Candidate deployment failed; the prior healthy profile was retained.").slice(0, 320);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${label} has unknown or missing fields`);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const canonical = new Date(milliseconds).toISOString();
  return value === canonical || (canonical.endsWith(".000Z") && value === canonical.replace(".000Z", "Z"));
}
