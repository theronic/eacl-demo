import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { assertEnvelope, assertIdentity, successfulData } from "./runner.mjs";

export async function runProductionRecheck({ transport, expectedIdentity, target, clock = () => new Date().toISOString() }) {
  if (!transport || typeof transport.request !== "function") throw new TypeError("production recheck transport is required");
  validateTarget(target, expectedIdentity?.profileId);
  const startedAt = clock();
  const cases = [];
  await recheckCase(cases, "health", async () => {
    const response = assertEnvelope(await transport.request("health", {}), "health");
    const health = successfulData(response, "health");
    assertIdentity(health.identity, expectedIdentity);
    if (health.ready !== true || health.status !== "ready") throw new Error("production profile health is not ready");
  });
  await recheckCase(cases, "bootstrap-identity", async () => {
    const response = assertEnvelope(await transport.request("bootstrap", {}), "bootstrap");
    const bootstrap = successfulData(response, "bootstrap");
    assertIdentity(bootstrap.identity, expectedIdentity);
  });
  const failed = cases.filter(({ status }) => status === "failed").length;
  const report = {
    schema: "eacl-demo.production-recheck.v1",
    evidenceId: null,
    result: failed === 0 ? "pass" : "fail",
    startedAt,
    completedAt: clock(),
    target: structuredClone(target),
    identity: { ...expectedIdentity },
    counts: { passed: cases.length - failed, failed },
    cases
  };
  report.evidenceId = productionRecheckEvidenceId(report);
  return report;
}

export function validateProductionRecheck(report, { profile, deployment, requirePassing = true } = {}) {
  exactKeys(report, ["schema", "evidenceId", "result", "startedAt", "completedAt", "target", "identity", "counts", "cases"], "production recheck report");
  if (report.schema !== "eacl-demo.production-recheck.v1" || report.evidenceId !== productionRecheckEvidenceId(report)) throw new Error("production recheck is not content-addressed");
  validateTarget(report.target, profile?.id ?? report.identity?.profileId);
  const startedAt = Date.parse(report.startedAt);
  const completedAt = Date.parse(report.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) throw new Error("production recheck timestamps are invalid");
  const ids = ["health", "bootstrap-identity"];
  if (!Array.isArray(report.cases) || report.cases.length !== ids.length || JSON.stringify(report.cases.map(({ id }) => id)) !== JSON.stringify(ids)) throw new Error("production recheck cases are not the closed bounded set");
  const counts = { passed: 0, failed: 0 };
  for (const entry of report.cases) {
    exactKeys(entry, ["id", "status", "durationMs", "reason"], `production recheck case ${entry.id}`);
    if (!new Set(["passed", "failed"]).has(entry.status) || !Number.isFinite(entry.durationMs) || entry.durationMs < 0) throw new Error(`production recheck case is invalid: ${entry.id}`);
    if (entry.status === "passed" ? entry.reason !== null : typeof entry.reason !== "string" || entry.reason.length === 0 || entry.reason.length > 320) throw new Error(`production recheck case reason is invalid: ${entry.id}`);
    counts[entry.status] += 1;
  }
  if (JSON.stringify(report.counts) !== JSON.stringify(counts) || report.result !== (counts.failed === 0 ? "pass" : "fail")) throw new Error("production recheck result counts are inconsistent");
  if (requirePassing && report.result !== "pass") throw new Error("production recheck did not pass");
  if (profile && (report.target.profileId !== profile.id || normalizePath(report.target.path) !== normalizePath(profile.route))) throw new Error("production recheck target does not match the profile");
  if (deployment) {
    const expected = { profileId: profile.id, demoSha: deployment.demoSha, eaclSha: deployment.eaclSha, artifactSha256: deployment.artifact.sha256, deploymentId: deployment.deploymentId, dataManifestSha256: deployment.dataManifestSha256 };
    if (Object.entries(expected).some(([key, value]) => report.identity?.[key] !== value)) throw new Error("production recheck identity does not match the deployment");
    if (completedAt < Date.parse(deployment.deployedAt)) throw new Error("production recheck predates the deployment");
  }
  return report;
}

export function productionRecheckEvidenceId(report) {
  const payload = structuredClone(report);
  delete payload.evidenceId;
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

async function recheckCase(results, id, run) {
  const started = performance.now();
  try {
    await run();
    results.push({ id, status: "passed", durationMs: round(performance.now() - started), reason: null });
  } catch (error) {
    results.push({ id, status: "failed", durationMs: round(performance.now() - started), reason: safeMessage(error) });
  }
}

function validateTarget(target, profileId) {
  exactKeys(target, ["kind", "origin", "path", "profileId"], "production recheck target");
  if (target.kind !== "production-cloudfront" || target.profileId !== profileId) throw new Error("production recheck must target the exact live CloudFront profile");
  const origin = new URL(target.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("production recheck origin must be an HTTPS origin without credentials or state");
  if (target.path !== "/") throw new Error("production recheck profile path is invalid");
}

function safeMessage(error) {
  return String(error?.message ?? "production recheck failed").replace(/https?:\/\/\S+|\/(?:Users|home|var|tmp)\/\S+/giu, "[redacted]").slice(0, 320);
}

function normalizePath(value) { return value.replace(/\/$/u, "") || "/"; }
function round(value) { return Math.round(value * 1000) / 1000; }

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
