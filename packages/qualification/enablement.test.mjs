import assert from "node:assert/strict";
import test from "node:test";

import { enableInitiallyQualifiedProfile, evaluateInitialEnablement } from "./src/enablement.mjs";
import { createObservabilityReadiness } from "./src/observability-readiness.mjs";

const identity = { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deploy-1", dataManifestSha256: "d".repeat(64) };
const deployment = { demoSha: identity.demoSha, eaclSha: identity.eaclSha, artifact: { kind: "lambda-version", sha256: identity.artifactSha256, version: "7" }, deploymentId: identity.deploymentId, dataManifestSha256: identity.dataManifestSha256, deployedAt: "2026-08-25T12:00:00Z" };
const categories = ["identity", "contract", "authorization", "relationship", "pagination-cursor", "cache", "consistency", "consistency-failure", "failure-redaction", "cleanup"];

function profile() {
  return { id: identity.profileId, backend: "datahike", storage: "s3", state: "qualifying", reason: "Initial qualification remains incomplete.", route: "/", deployment: null, lastOutcome: {} };
}

function qualification() {
  return {
    schema: "eacl-demo.qualification-report.v1", result: "pass",
    startedAt: "2026-08-25T12:00:01Z", completedAt: "2026-08-25T12:01:00Z",
    target: { kind: "direct-function-url", origin: "https://abc.lambda-url.us-east-1.on.aws", path: "/", profileId: identity.profileId },
    identity, descriptorIdentity: identity, releaseOutcome: "released",
    counts: { passed: categories.length, failed: 0, unsupported: 0 },
    cases: categories.map((category) => ({ id: `${category}-case`, category, status: "passed", durationMs: 1, reason: null, details: {} }))
  };
}

const workloadCriteria = {
  requiredPhases: ["cold", "warm"], concurrency: 2, maximumErrorRate: 0,
  minimumMemoryHeadroomPercent: 20,
  repetitions: { cold: 2, restore: 2, warm: 4 },
  minimumSamples: { cold: 2, restore: 2, warm: 4 },
  maximumP95Ms: { cold: 10_000, restore: 10_000, warm: 1_000 }
};
const passingPhase = (phase, samples) => ({
  phase, status: "passed", reason: null, samples, errors: 0, errorRate: 0,
  latencyMs: { p50: 10, p95: 20, maximumP95: workloadCriteria.maximumP95Ms[phase] },
  memory: { minimumHeadroomPercent: 30, requiredHeadroomPercent: 20 }
});
const workload = {
  schema: "eacl-demo.qualification-workload.v1", result: "pass", profileId: identity.profileId,
  dataset: { fixtureId: "eacl-demo-fixture-v1", logicalResourceCount: 1_000_000, manifestSha256: identity.dataManifestSha256 },
  cacheStates: ["bypass", "warm"], concurrency: 2, criteria: workloadCriteria,
  phases: [
    passingPhase("cold", 2),
    { phase: "restore", status: "unsupported", reason: "SnapStart is disabled.", samples: 0, errors: 0, latencyMs: null, memory: null },
    passingPhase("warm", 4)
  ]
};
const named = (names, status = "ready") => names.map((name) => ({ name, status }));

function observability() {
  return createObservabilityReadiness({
    schema: "eacl-demo.observability-readiness.v1",
    identity,
    route: "/",
    completedAt: "2026-08-25T12:02:00Z",
    logs: { structured: true, redactionAudit: "passed", retentionDays: 14 },
    signals: named(["requests", "errors", "duration", "initialization", "restore", "throttles", "timeouts", "oom", "storage"]),
    alarms: ["duration", "errors", "health", "initialization", "oom", "throttles", "timeouts"].map((name) => ({
      name, status: "ready", state: "OK", actionsEnabled: true, notificationPath: "sns-telegram",
      scope: { profileId: identity.profileId, resourceIdentifier: `eacl-demo-${identity.profileId}` }
    })),
    dashboard: { status: "ready", identifier: "eacl-demo-datahike-s3" },
    synthetics: ["bootstrap", "exemplar", "health"].map((name) => ({
      name, status: "passed",
      target: { kind: "staged-cloudfront", baseUrl: "https://staging.demo.eacl.dev/" },
      checkedAt: "2026-08-25T12:01:30Z",
      observedIdentity: identity
    })),
    runbook: { status: "ready", identifier: "docs/operator-runbook.md#profile-incidents" }
  });
}

test("a complete exact production-path qualification can enable a profile", () => {
  const original = { profiles: [profile()] };
  const result = enableInitiallyQualifiedProfile({ registry: original, profileId: identity.profileId, deployment, qualification: qualification(), workload, observability: observability() });
  assert.equal(result.registry.profiles[0].state, "enabled");
  assert.equal(result.registry.profiles[0].deployment.artifact.sha256, identity.artifactSha256);
  assert.match(result.evidenceId, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(original.profiles[0].state, "qualifying");
});

test("unit/local evidence, identity drift, missing categories, workload failure, and absent alarms fail closed", () => {
  const variants = [
    { mutate(report) { report.target.kind = "local"; }, argument: {} },
    { mutate(report) { report.identity.artifactSha256 = "e".repeat(64); }, argument: {} },
    { mutate(report) { report.cases.pop(); }, argument: {} },
    { mutate() {}, argument: { workload: { ...workload, result: "fail" } } },
    { mutate() {}, argument: { observability: null } }
  ];
  for (const variant of variants) {
    const report = structuredClone(qualification());
    variant.mutate(report);
    const gate = evaluateInitialEnablement({ profile: profile(), deployment, qualification: report, workload, observability: observability(), ...variant.argument });
    assert.equal(gate.allowed, false, JSON.stringify(gate.reasons));
    assert.throws(() => enableInitiallyQualifiedProfile({ registry: { profiles: [profile()] }, profileId: identity.profileId, deployment, qualification: report, workload, observability: observability(), ...variant.argument }), (error) => error.code === "initial-qualification-incomplete");
  }
});

test("empty, under-sampled, high-error, low-memory, or wrong-dataset workload claims fail closed", () => {
  const variants = [
    { ...workload, phases: [] },
    (() => { const value = structuredClone(workload); value.phases[0].samples = 1; return value; })(),
    (() => { const value = structuredClone(workload); value.phases[0].errors = 1; value.phases[0].errorRate = 0.5; return value; })(),
    (() => { const value = structuredClone(workload); value.phases[0].memory.minimumHeadroomPercent = 19; return value; })(),
    (() => { const value = structuredClone(workload); value.dataset.manifestSha256 = "e".repeat(64); return value; })(),
    (() => { const value = structuredClone(workload); value.dataset.logicalResourceCount = 10_000; return value; })(),
    (() => { const value = structuredClone(workload); value.criteria.concurrency = 1; return value; })()
  ];
  for (const candidate of variants) {
    const gate = evaluateInitialEnablement({
      profile: profile(), deployment, qualification: qualification(), workload: candidate,
      observability: observability()
    });
    assert.equal(gate.allowed, false, JSON.stringify(gate.reasons));
    assert.match(gate.reasons.join(" "), /workload/u);
  }
});

test("qualification from before deployment and unreleased transport remain disabled", () => {
  const report = qualification();
  report.completedAt = "2026-08-25T11:59:59Z";
  report.releaseOutcome = "not-created";
  const gate = evaluateInitialEnablement({ profile: profile(), deployment, qualification: report, workload, observability: observability() });
  assert.equal(gate.allowed, false);
  assert.match(gate.reasons.join(" "), /predates|not released/u);
});

test("inconsistent counts, duplicate cases, unsupported mandatory cases, and target drift fail closed", () => {
  const variants = [
    (() => { const report = qualification(); report.counts.passed -= 1; return report; })(),
    (() => { const report = qualification(); report.cases[1].id = report.cases[0].id; return report; })(),
    (() => {
      const report = qualification();
      report.cases.find(({ category }) => category === "authorization").status = "unsupported";
      report.cases.find(({ category }) => category === "authorization").reason = "Operation omitted.";
      report.counts.passed -= 1;
      report.counts.unsupported += 1;
      return report;
    })(),
    (() => { const report = qualification(); report.target.profileId = "datomic-dynamodb"; return report; })(),
    (() => { const report = qualification(); report.target.path = "/"; return report; })()
  ];
  for (const report of variants) {
    const gate = evaluateInitialEnablement({
      profile: profile(), deployment, qualification: report, workload,
      observability: observability()
    });
    assert.equal(gate.allowed, false, JSON.stringify(gate.reasons));
    assert.match(gate.reasons.join(" "), /qualification/u);
  }
});

test("a boolean, stale identity, disabled alarm, missing synthetic, or unbounded logs cannot enable a profile", () => {
  const variants = [
    true,
    (() => { const value = structuredClone(observability()); value.identity.artifactSha256 = "e".repeat(64); return value; })(),
    (() => { const value = structuredClone(observability()); value.identity.dataManifestSha256 = "e".repeat(64); return value; })(),
    (() => { const value = structuredClone(observability()); value.alarms[0].actionsEnabled = false; return value; })(),
    (() => { const value = structuredClone(observability()); value.synthetics.pop(); return value; })(),
    (() => { const value = structuredClone(observability()); value.logs.retentionDays = 365; return value; })()
  ];
  for (const candidate of variants) {
    const gate = evaluateInitialEnablement({
      profile: profile(), deployment, qualification: qualification(), workload,
      observability: candidate
    });
    assert.equal(gate.allowed, false, JSON.stringify(gate.reasons));
    assert.match(gate.reasons.join(" "), /observability/u);
  }
});

test("synthetics must traverse the staged profile route after deployment and observe its exact identity", () => {
  const variants = [
    (() => { const value = structuredClone(observability()); value.synthetics[0].target.kind = "direct-origin"; return value; })(),
    (() => { const value = structuredClone(observability()); value.synthetics[0].target.baseUrl = "https://staging.demo.eacl.dev/"; return value; })(),
    (() => { const value = structuredClone(observability()); value.synthetics[0].checkedAt = "2026-08-25T11:59:59Z"; return value; })(),
    (() => { const value = structuredClone(observability()); value.synthetics[0].observedIdentity = { ...identity, deploymentId: "deploy-2" }; return value; })()
  ];
  for (const candidate of variants) {
    const gate = evaluateInitialEnablement({
      profile: profile(), deployment, qualification: qualification(), workload,
      observability: candidate
    });
    assert.equal(gate.allowed, false, JSON.stringify(gate.reasons));
    assert.match(gate.reasons.join(" "), /observability/u);
  }
});

test("enablement evidence binds deployment and observability, not only qualification and workload", () => {
  const first = evaluateInitialEnablement({
    profile: profile(), deployment, qualification: qualification(), workload,
    observability: observability()
  });
  const replacement = observability();
  replacement.completedAt = "2026-08-25T12:03:00Z";
  replacement.evidenceId = createObservabilityReadiness({
    schema: replacement.schema,
    identity: replacement.identity,
    route: replacement.route,
    completedAt: replacement.completedAt,
    logs: replacement.logs,
    signals: replacement.signals,
    alarms: replacement.alarms,
    dashboard: replacement.dashboard,
    synthetics: replacement.synthetics,
    runbook: replacement.runbook
  }).evidenceId;
  const second = evaluateInitialEnablement({
    profile: profile(), deployment, qualification: qualification(), workload,
    observability: replacement
  });
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.notEqual(first.evidenceId, second.evidenceId);
});
