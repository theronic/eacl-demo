import { validateMergeSmoke } from "../../packages/qualification/src/merge-smoke.mjs";

const AWS_NAME = /^[A-Za-z0-9][A-Za-z0-9-_]{0,63}$/u;
const VERSION = /^(?:0|[1-9][0-9]*)$/u;
const REVISION = /^[A-Za-z0-9+=,.@_-]{1,256}$/u;
const BUCKET = /^(?!.*\.\.)(?!.*\.-)(?!.*-\.)(?:[a-z0-9][a-z0-9.-]{1,61}[a-z0-9])$/u;
const ETAG = /^"?[0-9a-f]{32}(?:-[1-9][0-9]*)?"?$/u;
const VERSION_ID = /^[A-Za-z0-9._~+/=-]{1,1024}$/u;
const PUBLICATION_ID = /^sha256:[0-9a-f]{64}$/u;

export function createServerAliasPromotionPlan({ profile, deployment, smoke, currentAlias }) {
  validateServerProfile(profile);
  validateAlias(currentAlias);
  validateMergeSmoke(smoke, { profile, deployment });
  const candidateVersion = deployment?.artifact?.version;
  if (!VERSION.test(candidateVersion) || deployment.artifact.kind !== "lambda-version") throw new Error("alias promotion requires an immutable Lambda version");
  if (candidateVersion === currentAlias.functionVersion) throw new Error("candidate version is already active");
  return Object.freeze({
    schema: "eacl-demo.alias-promotion-plan.v1",
    profileId: profile.id,
    evidenceId: smoke.evidenceId,
    deployment: structuredClone(deployment),
    preconditions: { alias: structuredClone(currentAlias) },
    promotion: {
      alias: {
        functionName: currentAlias.functionName,
        aliasName: currentAlias.aliasName,
        fromVersion: currentAlias.functionVersion,
        toVersion: candidateVersion,
        revisionId: currentAlias.revisionId
      }
    },
    rollback: {
      alias: {
        functionName: currentAlias.functionName,
        aliasName: currentAlias.aliasName,
        restoreVersion: currentAlias.functionVersion,
        onlyIfCurrentVersion: candidateVersion,
        capturePostPromotionRevisionId: true
      }
    },
    verifyAfterPromotion: { route: profile.route, deployment: structuredClone(deployment), kind: "production-cloudfront" }
  });
}

export function createServerProfilePublicationPlan({ publication, activeAlias, rollbackAlias, currentStatus, bodySha256 }) {
  const profile = publication?.profile;
  validateServerProfile(profile);
  if (typeof publication.publicationId !== "string" || !PUBLICATION_ID.test(publication.publicationId)) throw new Error("profile publication must be verified before planning");
  if (typeof bodySha256 !== "string" || !/^[0-9a-f]{64}$/u.test(bodySha256)) throw new Error("serialized publication body digest is invalid");
  validateAlias(activeAlias);
  validateStatus(currentStatus, profile.id);
  if (!currentStatus.exists) throw new Error("ordinary profile publication requires an existing rollbackable status object");
  const succeeded = profile.lastOutcome.outcome === "succeeded";
  const failed = profile.lastOutcome.outcome === "failed";
  if (!succeeded && !failed) throw new Error("automatic publication supports only succeeded or failed deployment outcomes");
  if (succeeded && publication.gate.kind === "failure-outcome") throw new Error("successful publication lacks a passing gate");
  if (failed && publication.gate.kind !== "failure-outcome") throw new Error("failed publication cannot claim a passing gate");
  if (profile.deployment?.artifact.version !== activeAlias.functionVersion) throw new Error("publication deployment does not match the observed active alias version");
  if (succeeded && !VERSION.test(profile.deployment?.artifact.version)) throw new Error("successful server publication requires an immutable Lambda version");
  if (succeeded) validateRollbackAlias(rollbackAlias, activeAlias);
  else if (rollbackAlias !== null) throw new Error("failed publication cannot carry a pending alias rollback");

  const key = `registry/profiles/${profile.id}.json`;
  const statusCondition = { ifMatch: currentStatus.etag, ifNoneMatch: null };
  const aliasRollback = succeeded ? {
    functionName: activeAlias.functionName,
    aliasName: activeAlias.aliasName,
    restoreVersion: rollbackAlias.functionVersion,
    onlyIfCurrentVersion: activeAlias.functionVersion,
    revisionId: activeAlias.revisionId
  } : null;
  return Object.freeze({
    schema: "eacl-demo.profile-publication-plan.v2",
    profileId: profile.id,
    outcome: profile.lastOutcome.outcome,
    publicObject: {
      bucket: currentStatus.bucket,
      key,
      contentType: "application/json",
      cacheControl: "no-cache, max-age=0, must-revalidate",
      publicationId: publication.publicationId,
      bodySha256
    },
    preconditions: { alias: structuredClone(activeAlias), statusObject: statusCondition },
    promotion: {
      alias: null,
      statusObject: { bucket: currentStatus.bucket, key, ...statusCondition },
      verifyBeforeWrite: { route: profile.route, deployment: structuredClone(profile.deployment), kind: "production-cloudfront" },
      verifyAfterWrite: { route: profile.route, deployment: structuredClone(profile.deployment), kind: "production-cloudfront" }
    },
    rollback: {
      alias: aliasRollback,
      statusObject: { bucket: currentStatus.bucket, key, versionId: currentStatus.versionId, etag: currentStatus.etag, publicationId: currentStatus.publicationId }
    }
  });
}

function validateServerProfile(profile) {
  if (!profile || profile.id === "datascript-browser-memory" || !profile.route?.startsWith("/api/v1/")) throw new Error("server publication requires one closed server profile");
}

function validateAlias(alias) {
  exactKeys(alias, ["functionName", "aliasName", "functionVersion", "revisionId"], "alias");
  if (![alias.functionName, alias.aliasName, alias.functionVersion, alias.revisionId].every((value) => typeof value === "string") || !AWS_NAME.test(alias.functionName) || !AWS_NAME.test(alias.aliasName) || !VERSION.test(alias.functionVersion) || !REVISION.test(alias.revisionId)) throw new Error("alias coordinates are invalid");
}

function validateRollbackAlias(rollbackAlias, activeAlias) {
  validateAlias(rollbackAlias);
  if (rollbackAlias.functionName !== activeAlias.functionName || rollbackAlias.aliasName !== activeAlias.aliasName || rollbackAlias.functionVersion === activeAlias.functionVersion) throw new Error("rollback alias does not identify the prior version of the same profile alias");
}

function validateStatus(status, profileId) {
  exactKeys(status, ["exists", "bucket", "key", "etag", "versionId", "publicationId"], "current status object");
  if (typeof status.bucket !== "string" || typeof status.key !== "string" || !BUCKET.test(status.bucket) || status.key !== `registry/profiles/${profileId}.json`) throw new Error("status object is outside the exact profile key");
  if (status.exists) {
    if (![status.etag, status.versionId, status.publicationId].every((value) => typeof value === "string") || !ETAG.test(status.etag) || !VERSION_ID.test(status.versionId) || !PUBLICATION_ID.test(status.publicationId)) throw new Error("existing status rollback coordinates are incomplete");
  } else if ([status.etag, status.versionId, status.publicationId].some((value) => value !== null)) {
    throw new Error("missing status object cannot carry rollback coordinates");
  }
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}
