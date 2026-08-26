import { createHash } from "node:crypto";

import { createProfilePublication } from "../../explorer-state/src/profile-publication.mjs";
import { validateProfileEntry } from "../../explorer-state/src/profile-entry.mjs";
import { evaluateInitialEnablement } from "./enablement.mjs";
import { validateMergeSmoke } from "./merge-smoke.mjs";
import { validateProductionRecheck } from "./production-recheck.mjs";

export async function createInitialEnablementPublication({ baseRegistry, profileDefinitions, profileId, deployment, qualification, workload, observability, publishedAt }, options = {}) {
  const { profile, definition } = resolveProfile(baseRegistry, profileDefinitions, profileId);
  const gate = evaluateInitialEnablement({ profile, deployment, qualification, workload, observability });
  if (!gate.allowed) throw Object.assign(new Error(`profile remains disabled: ${gate.reasons.join("; ")}`), { code: "initial-qualification-incomplete", reasons: gate.reasons });
  const enabled = successfulProfile(profile, deployment, publishedAt, "Initial production-path qualification and observability gates passed.");
  return createProfilePublication({ profile: enabled, definition, publishedAt, gate: { kind: "initial-qualification", evidenceId: gate.evidenceId } }, options);
}

export async function createOrdinaryDeploymentPublication({ baseRegistry, profileDefinitions, profileId, deployment, smoke, productionRecheck, publishedAt }, options = {}) {
  const { profile, definition } = resolveProfile(baseRegistry, profileDefinitions, profileId);
  validateProfileEntry(profile, definition);
  if (profile.state !== "enabled" || !profile.deployment) throw new Error("ordinary merge publication cannot perform initial enablement");
  validateMergeSmoke(smoke, { profile, deployment });
  validateProductionRecheck(productionRecheck, { profile, deployment });
  if (Date.parse(productionRecheck.startedAt) < Date.parse(smoke.completedAt)) throw new Error("production recheck began before the candidate staging smoke completed");
  const enabled = successfulProfile(profile, deployment, productionRecheck.completedAt, "The candidate staging smoke and post-promotion production identity recheck passed.");
  return createProfilePublication({ profile: enabled, definition, publishedAt, gate: { kind: "merge-smoke", evidenceId: ordinaryDeploymentEvidenceId({ deployment, smoke, productionRecheck }) } }, options);
}

export function ordinaryDeploymentEvidenceId({ deployment, smoke, productionRecheck }) {
  const payload = {
    schema: "eacl-demo.ordinary-deployment-evidence.v1",
    deployment,
    stagedSmokeEvidenceId: smoke.evidenceId,
    productionRecheckEvidenceId: productionRecheck.evidenceId
  };
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

export async function createFailedDeploymentPublication({ baseRegistry, profileDefinitions, profileId, attemptedDeployment = null, attemptedIdentity = null, failedAt, publishedAt, message }, options = {}) {
  const { profile, definition } = resolveProfile(baseRegistry, profileDefinitions, profileId);
  validateProfileEntry(profile, definition);
  const attempt = attemptedDeployment === null ? validateAttemptedIdentity(attemptedIdentity) : identityFromAttemptedDeployment(attemptedDeployment, failedAt);
  if (attemptedDeployment !== null && attemptedIdentity !== null) throw new Error("failed deployment accepts one attempted identity source");
  const boundedMessage = String(message ?? "The candidate deployment failed; the prior profile state was retained.").trim();
  if (boundedMessage.length === 0 || boundedMessage.length > 320) throw new Error("failed deployment message must be 1..320 characters");
  const failed = {
    ...structuredClone(profile),
    lastOutcome: {
      outcome: "failed",
      attemptedDemoSha: attempt.demoSha,
      attemptedEaclSha: attempt.eaclSha,
      artifactSha256: attempt.artifactSha256,
      at: failedAt,
      message: boundedMessage
    }
  };
  validateProfileEntry(failed, definition);
  return createProfilePublication({ profile: failed, definition, publishedAt, gate: { kind: "failure-outcome", evidenceId: null } }, options);
}

function successfulProfile(profile, deployment, completedAt, message) {
  return {
    ...structuredClone(profile),
    state: "enabled",
    reason: null,
    deployment: structuredClone(deployment),
    lastOutcome: {
      outcome: "succeeded",
      attemptedDemoSha: deployment.demoSha,
      attemptedEaclSha: deployment.eaclSha,
      artifactSha256: deployment.artifact.sha256,
      at: completedAt,
      message
    }
  };
}

function resolveProfile(baseRegistry, profileDefinitions, profileId) {
  const profile = baseRegistry?.profiles?.find(({ id }) => id === profileId);
  const definition = profileDefinitions?.profiles?.find(({ id }) => id === profileId);
  if (!profile || !definition) throw new Error(`unknown profile: ${profileId}`);
  return { profile, definition };
}

function validateAttemptedDeployment(deployment, failedAt) {
  const probe = {
    id: "datahike-s3", backend: "datahike", storage: "s3", state: "enabled", reason: null, route: "/api/v1/datahike-s3",
    deployment: structuredClone(deployment),
    lastOutcome: { outcome: "succeeded", attemptedDemoSha: deployment?.demoSha, attemptedEaclSha: deployment?.eaclSha, artifactSha256: deployment?.artifact?.sha256, at: failedAt, message: "Candidate identity validation probe." }
  };
  validateProfileEntry(probe, { id: "datahike-s3", backend: "datahike", storage: "s3" });
}

function identityFromAttemptedDeployment(deployment, failedAt) {
  validateAttemptedDeployment(deployment, failedAt);
  return { demoSha: deployment.demoSha, eaclSha: deployment.eaclSha, artifactSha256: deployment.artifact.sha256 };
}

function validateAttemptedIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity) || JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify(["artifactSha256", "demoSha", "eaclSha"])) throw new Error("failed deployment attempted identity is invalid");
  if (!/^[0-9a-f]{40}$/u.test(identity.demoSha) || !/^[0-9a-f]{40}$/u.test(identity.eaclSha) || !/^[0-9a-f]{64}$/u.test(identity.artifactSha256)) throw new Error("failed deployment attempted identity is invalid");
  return structuredClone(identity);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
