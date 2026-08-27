import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { assertEnvelope, assertIdentity, successfulData } from "./runner.mjs";

const MUTATION_DENIAL_CODES = new Set(["route-not-found", "method-not-allowed"]);

export async function runMergeSmoke({ transport, expectedIdentity, target, allowedDemand, deniedDemand, clock = () => new Date().toISOString() }) {
  if (!transport || typeof transport.request !== "function") throw new TypeError("merge smoke transport is required");
  validateTarget(target, expectedIdentity?.profileId);
  const startedAt = clock();
  const cases = [];
  await smokeCase(cases, "health", async () => {
    const response = assertEnvelope(await transport.request("health", {}), "health");
    const health = successfulData(response, "health");
    assertIdentity(health.identity, expectedIdentity);
    if (health.ready !== true || health.status !== "ready") throw new Error("profile health is not ready");
  });
  await smokeCase(cases, "bootstrap-identity", async () => {
    const response = assertEnvelope(await transport.request("bootstrap", {}), "bootstrap");
    const bootstrap = successfulData(response, "bootstrap");
    assertIdentity(bootstrap.identity, expectedIdentity);
  });
  await smokeCase(cases, "allowed-authorization", async () => {
    const input = demandInput(allowedDemand);
    const response = assertEnvelope(await transport.request("check-permission", input), "check-permission");
    const decision = successfulData(response, "check-permission");
    assertDecisionScope(decision, input);
    if (decision.allowed !== true) throw new Error("allowed exemplar was denied");
  });
  await smokeCase(cases, "denied-authorization", async () => {
    const input = demandInput(deniedDemand);
    const response = assertEnvelope(await transport.request("check-permission", input), "check-permission");
    const decision = successfulData(response, "check-permission");
    assertDecisionScope(decision, input);
    if (decision.allowed !== false) throw new Error("denied exemplar was allowed");
  });
  await smokeCase(cases, "mutation-denial", async () => {
    const response = assertEnvelope(await transport.request("seed", {}), "seed");
    if (!response || !("error" in response) || "data" in response || !MUTATION_DENIAL_CODES.has(response.error?.code)) throw new Error("public seed mutation was not route/method denied");
  });
  const failed = cases.filter(({ status }) => status === "failed").length;
  const report = {
    schema: "eacl-demo.merge-smoke.v1",
    evidenceId: null,
    result: failed === 0 ? "pass" : "fail",
    startedAt,
    completedAt: clock(),
    target: structuredClone(target),
    identity: { ...expectedIdentity },
    counts: { passed: cases.length - failed, failed },
    cases
  };
  report.evidenceId = mergeSmokeEvidenceId(report);
  return report;
}

export function validateMergeSmoke(report, { profile, deployment, requirePassing = true } = {}) {
  exactKeys(report, ["schema", "evidenceId", "result", "startedAt", "completedAt", "target", "identity", "counts", "cases"], "merge smoke report");
  if (report.schema !== "eacl-demo.merge-smoke.v1" || report.evidenceId !== mergeSmokeEvidenceId(report)) throw new Error("merge smoke report is not content-addressed");
  validateTarget(report.target, profile?.id ?? report.identity?.profileId);
  const startedAt = Date.parse(report.startedAt);
  const completedAt = Date.parse(report.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) throw new Error("merge smoke timestamps are invalid");
  const ids = ["health", "bootstrap-identity", "allowed-authorization", "denied-authorization", "mutation-denial"];
  if (!Array.isArray(report.cases) || report.cases.length !== ids.length || JSON.stringify(report.cases.map(({ id }) => id)) !== JSON.stringify(ids)) throw new Error("merge smoke cases are not the closed bounded set");
  const counts = { passed: 0, failed: 0 };
  for (const entry of report.cases) {
    exactKeys(entry, ["id", "status", "durationMs", "reason"], `merge smoke case ${entry.id}`);
    if (!new Set(["passed", "failed"]).has(entry.status) || !Number.isFinite(entry.durationMs) || entry.durationMs < 0) throw new Error(`merge smoke case is invalid: ${entry.id}`);
    if (entry.status === "passed" ? entry.reason !== null : typeof entry.reason !== "string" || entry.reason.length === 0 || entry.reason.length > 320) throw new Error(`merge smoke case reason is invalid: ${entry.id}`);
    counts[entry.status] += 1;
  }
  if (JSON.stringify(report.counts) !== JSON.stringify(counts) || report.result !== (counts.failed === 0 ? "pass" : "fail")) throw new Error("merge smoke result counts are inconsistent");
  if (requirePassing && report.result !== "pass") throw new Error("merge smoke did not pass");
  if (profile && (report.target.profileId !== profile.id || normalizePath(report.target.path) !== normalizePath(profile.route))) throw new Error("merge smoke target does not match the profile");
  if (deployment) {
    const expected = { profileId: profile.id, demoSha: deployment.demoSha, eaclSha: deployment.eaclSha, artifactSha256: deployment.artifact.sha256, deploymentId: deployment.deploymentId, dataManifestSha256: deployment.dataManifestSha256 };
    if (Object.entries(expected).some(([key, value]) => report.identity?.[key] !== value)) throw new Error("merge smoke identity does not match the deployment");
    if (completedAt < Date.parse(deployment.deployedAt)) throw new Error("merge smoke predates the deployment");
  }
  return report;
}

export function mergeSmokeEvidenceId(report) {
  const payload = structuredClone(report);
  delete payload.evidenceId;
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

async function smokeCase(results, id, run) {
  const started = performance.now();
  try {
    await run();
    results.push({ id, status: "passed", durationMs: round(performance.now() - started), reason: null });
  } catch (error) {
    results.push({ id, status: "failed", durationMs: round(performance.now() - started), reason: safeMessage(error) });
  }
}

function demandInput(demand) {
  if (!demand?.subject || !demand?.resource || typeof demand.permission !== "string") throw new TypeError("merge smoke demand is invalid");
  return {
    subjectType: demand.subject.type, subjectId: demand.subject.id,
    resourceType: demand.resource.type, resourceId: demand.resource.id,
    permission: demand.permission
  };
}

function assertDecisionScope(decision) {
  if (typeof decision.allowed !== "boolean") throw new Error("authorization response is invalid");
}

function safeMessage(error) {
  return String(error?.message ?? "merge smoke failed").replace(/https?:\/\/\S+|\/(?:Users|home|var|tmp)\/\S+/giu, "[redacted]").slice(0, 320);
}

function validateTarget(target, profileId) {
  exactKeys(target, ["kind", "origin", "path", "profileId"], "merge smoke target");
  if (target.kind !== "staged-cloudfront" || target.profileId !== profileId) throw new Error("merge smoke must target the exact candidate staging CloudFront profile");
  const origin = new URL(target.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("merge smoke origin must be an HTTPS origin without credentials or state");
  if (target.path !== "/") throw new Error("merge smoke profile path is invalid");
}

function normalizePath(value) { return value.replace(/\/$/u, "") || "/"; }

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function round(value) { return Math.round(value * 1000) / 1000; }
