import { performance } from "node:perf_hooks";

import { reportableTarget } from "./targets.mjs";

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export async function runQualification({ target, createTransport, expectedIdentity, cases = [], now = () => new Date().toISOString() }) {
  validateIdentity(expectedIdentity);
  if (typeof createTransport !== "function") throw new TypeError("createTransport is required");
  if (!Array.isArray(cases)) throw new TypeError("qualification cases must be an array");
  const startedAt = now();
  const transport = await createTransport(target);
  const checkedTransport = identityCheckedTransport(transport, expectedIdentity);
  const results = [];
  let descriptor = null;
  let bootstrapPassed = false;
  let releaseOutcome = "not-created";
  try {
    const started = performance.now();
    const response = await checkedTransport.request("bootstrap", {});
    descriptor = successfulData(response, "bootstrap");
    assertIdentity(descriptor.identity, expectedIdentity);
    results.push(passed("bootstrap-identity", "identity", performance.now() - started, { contractRevision: descriptor.contract.revision }));
    bootstrapPassed = true;

    for (const qualificationCase of cases) {
      const applicability = qualificationCase.applies?.(descriptor) ?? { supported: true };
      if (!applicability.supported) {
        results.push(unsupported(qualificationCase, applicability.reason));
        continue;
      }
      const caseStarted = performance.now();
      try {
        const details = await qualificationCase.run({ transport: checkedTransport, descriptor, expectedIdentity });
        if (details?.qualificationStatus === "unsupported") results.push(unsupported(qualificationCase, details.reason));
        else results.push(passed(qualificationCase.id, qualificationCase.category, performance.now() - caseStarted, details ?? {}));
      } catch (error) {
        results.push(failed(qualificationCase, performance.now() - caseStarted, error));
      }
    }
  } catch (error) {
    results.push(failed({ id: bootstrapPassed ? "qualification-runner" : "bootstrap-identity", category: bootstrapPassed ? "harness" : "identity" }, 0, error));
  } finally {
    if (transport && typeof transport.release === "function") releaseOutcome = await transport.release() === false ? "already-released" : "released";
  }

  const counts = results.reduce((accumulator, result) => ({ ...accumulator, [result.status]: accumulator[result.status] + 1 }), { passed: 0, failed: 0, unsupported: 0 });
  return {
    schema: "eacl-demo.qualification-report.v1",
    result: counts.failed === 0 ? "pass" : "fail",
    startedAt,
    completedAt: now(),
    target: reportableTarget(target),
    identity: { ...expectedIdentity },
    descriptorIdentity: descriptor?.identity ?? null,
    releaseOutcome,
    counts,
    cases: results
  };
}

export function unsupportedResult(reason) {
  return Object.freeze({ qualificationStatus: "unsupported", reason });
}

export function successfulData(response, operation) {
  if (!response || response.ok !== true || response.meta?.operation !== operation || !response.data) {
    const code = response?.error?.code ?? "invalid-envelope";
    throw new Error(`${operation} qualification request failed: ${code}`);
  }
  return response.data;
}

export function assertIdentity(actual, expected) {
  validateIdentity(actual);
  for (const key of ["profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId", "dataManifestSha256"]) {
    if (actual[key] !== expected[key]) throw new Error(`qualification ${key} identity mismatch`);
  }
  return true;
}

export function assertEnvelopeIdentity(response, operation, expectedIdentity) {
  if (!response || response.meta?.operation !== operation) throw new Error(`qualification ${operation} response correlation mismatch`);
  assertIdentity(response.meta.identity, expectedIdentity);
  return response;
}

function identityCheckedTransport(transport, expectedIdentity) {
  return Object.freeze({
    async request(operation, input = {}) {
      return assertEnvelopeIdentity(await transport.request(operation, input), operation, expectedIdentity);
    },
    ...(typeof transport.probeCancellationCleanup === "function"
      ? { probeCancellationCleanup: transport.probeCancellationCleanup.bind(transport) }
      : {})
  });
}

function validateIdentity(identity) {
  if (!identity || typeof identity !== "object" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(identity.profileId)
      || !SHA1.test(identity.demoSha) || !SHA1.test(identity.eaclSha)
      || !SHA256.test(identity.artifactSha256) || !SHA256.test(identity.dataManifestSha256)
      || typeof identity.deploymentId !== "string" || identity.deploymentId.length < 1 || identity.deploymentId.length > 256) {
    throw new Error("qualification identity is invalid");
  }
}

function passed(id, category, durationMs, details) {
  return { id, category, status: "passed", durationMs: round(durationMs), reason: null, details: boundedDetails(details) };
}

function unsupported(qualificationCase, reason) {
  return { id: qualificationCase.id, category: qualificationCase.category, status: "unsupported", durationMs: 0, reason: publicText(reason ?? "The descriptor does not advertise this capability."), details: {} };
}

function failed(qualificationCase, durationMs, error) {
  return { id: qualificationCase.id, category: qualificationCase.category, status: "failed", durationMs: round(durationMs), reason: publicText(error?.publicMessage ?? error?.message ?? "Qualification failed."), details: { code: safeCode(error?.code) } };
}

function boundedDetails(value) {
  const entries = Object.entries(value ?? {}).slice(0, 16).map(([key, item]) => [key.slice(0, 64), typeof item === "string" ? item.slice(0, 256) : item]);
  return Object.fromEntries(entries);
}

function publicText(value) {
  const text = String(value).replace(/https?:\/\/\S+|\b(?:token|secret|password|authorization)\b\s*[:=]\s*\S+|\/(?:Users|home|var|tmp)\/\S+/giu, "[redacted]");
  return text.slice(0, 320);
}

function safeCode(value) { return typeof value === "string" && /^[a-z0-9-]{1,64}$/u.test(value) ? value : "qualification-failed"; }
function round(value) { return Math.round(value * 1000) / 1000; }
