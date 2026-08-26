import { createHash } from "node:crypto";

import { validateObservabilityReadiness } from "./observability-readiness.mjs";

const REQUIRED_CATEGORIES = Object.freeze([
  "identity", "contract", "authorization", "relationship", "pagination-cursor",
  "cache", "consistency", "consistency-failure", "failure-redaction", "cleanup"
]);
const MUST_PASS_CATEGORIES = new Set([
  "identity", "contract", "authorization", "relationship", "pagination-cursor",
  "consistency", "failure-redaction"
]);
const WORKLOAD_PHASES = Object.freeze(["cold", "restore", "warm"]);
const PROFILE_RESOURCE_COUNTS = Object.freeze({
  "datahike-s3": 1_000_000,
  "datahike-dynamodb": 1_000_000,
  "datomic-dynamodb": 1_000_000,
  "datalevin-memory": 10_000,
  "jank-memory": 10_000,
  "datascript-browser-memory": 10_000
});
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

export function evaluateInitialEnablement({ profile, deployment, qualification, workload, observability }) {
  const reasons = [];
  captureReason(reasons, "profile or deployment is invalid", () => validateProfileAndDeployment(profile, deployment));
  captureReason(reasons, "qualification report is invalid", () => validateQualificationEvidence(qualification));
  captureReason(reasons, "representative workload report is invalid", () => validateWorkloadEvidence(workload, qualification?.identity ?? null));
  try {
    validateObservabilityReadiness(observability, qualification?.identity ?? null, deployment, profile?.route ?? null);
  } catch (error) {
    reasons.push(`profile observability is not ready: ${error.message}`);
  }
  if (reasons.length > 0) return verdict(false, reasons, deployment, qualification, workload, observability);

  if (qualification.target?.kind !== "staged-cloudfront") reasons.push("qualification did not traverse staged CloudFront");
  if (!sameRoute(qualification.target?.path, profile.route)) reasons.push("qualification target does not match the profile production route");
  if (qualification.target?.profileId !== profile.id) reasons.push("qualification target profile does not match the registry profile");
  if (workload.profileId !== profile.id) reasons.push("representative workload did not pass for this profile");
  if (qualification.identity?.profileId !== profile.id || qualification.descriptorIdentity?.profileId !== profile.id) reasons.push("qualification profile identity does not match");
  if (!sameIdentity(qualification.identity, qualification.descriptorIdentity)) reasons.push("qualified and descriptor identities differ");
  if (!deploymentMatches(qualification.identity, deployment)) reasons.push("qualification identity does not match the immutable deployment");
  if (qualification.releaseOutcome !== "released" && qualification.releaseOutcome !== "already-released") reasons.push("qualification transport was not released");
  if (timestamp(qualification.completedAt, "qualification completion time") < timestamp(deployment.deployedAt, "deployment time")) reasons.push("qualification predates the immutable deployment");

  return verdict(reasons.length === 0, reasons, deployment, qualification, workload, observability);
}

export function enableInitiallyQualifiedProfile({ registry, profileId, deployment, qualification, workload, observability }) {
  const result = structuredClone(registry);
  const index = result?.profiles?.findIndex(({ id }) => id === profileId) ?? -1;
  if (index < 0) throw new Error(`unknown profile: ${profileId}`);
  const gate = evaluateInitialEnablement({ profile: result.profiles[index], deployment, qualification, workload, observability });
  if (!gate.allowed) throw Object.assign(new Error(`profile remains disabled: ${gate.reasons.join("; ")}`), { code: "initial-qualification-incomplete", reasons: gate.reasons });
  result.profiles[index] = { ...result.profiles[index], state: "enabled", reason: null, deployment: structuredClone(deployment) };
  return { registry: result, evidenceId: gate.evidenceId };
}

function verdict(allowed, reasons, deployment, qualification, workload, observability) {
  const evidenceId = deployment && qualification && workload && observability
    ? `sha256:${createHash("sha256").update(canonicalJson({ deployment, qualification, workload, observability })).digest("hex")}`
    : null;
  return Object.freeze({ allowed, reasons: Object.freeze([...reasons]), evidenceId });
}

function deploymentMatches(identity, deployment) {
  return identity?.demoSha === deployment.demoSha
    && identity?.eaclSha === deployment.eaclSha
    && identity?.artifactSha256 === deployment.artifact?.sha256
    && identity?.deploymentId === deployment.deploymentId
    && identity?.dataManifestSha256 === deployment.dataManifestSha256;
}

function sameIdentity(left, right) {
  return left && right && ["profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId", "dataManifestSha256"].every((key) => left[key] === right[key]);
}

function sameRoute(actualRoute, expectedRoute) {
  if (typeof actualRoute !== "string" || typeof expectedRoute !== "string") return false;
  const actual = actualRoute.replace(/\/$/u, "") || "/";
  const expected = expectedRoute.replace(/\/$/u, "") || "/";
  return actual === expected;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function validateProfileAndDeployment(profile, deployment) {
  invariant(profile && typeof profile === "object", "profile is missing");
  invariant(new Set(["disabled", "qualifying", "unavailable"]).has(profile.state), "profile must be non-enabled before initial enablement");
  invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(profile.id), "profile ID is invalid");
  invariant(typeof profile.route === "string" && profile.route.startsWith("/"), "profile route is invalid");
  invariant(deployment && typeof deployment === "object", "immutable deployment identity is missing");
  invariant(SHA1.test(deployment.demoSha) && SHA1.test(deployment.eaclSha), "deployment source identity is invalid");
  invariant(IDENTIFIER.test(deployment.deploymentId), "deployment ID is invalid");
  invariant(SHA256.test(deployment.dataManifestSha256), "deployment data manifest identity is invalid");
  timestamp(deployment.deployedAt, "deployment time");
  invariant(deployment.artifact && typeof deployment.artifact === "object", "deployment artifact is missing");
  invariant(new Set(["static", "lambda-version", "browser-worker"]).has(deployment.artifact.kind), "deployment artifact kind is invalid");
  invariant(SHA256.test(deployment.artifact.sha256) && typeof deployment.artifact.version === "string" && deployment.artifact.version.length > 0,
    "deployment artifact identity is invalid");
}

function validateQualificationEvidence(report) {
  invariant(report && report.schema === "eacl-demo.qualification-report.v1", "qualification schema is invalid");
  validateIdentity(report.identity, "qualified");
  validateIdentity(report.descriptorIdentity, "descriptor");
  const startedAt = timestamp(report.startedAt, "qualification start time");
  const completedAt = timestamp(report.completedAt, "qualification completion time");
  invariant(startedAt <= completedAt, "qualification completion predates its start");
  invariant(report.target && typeof report.target === "object" && typeof report.target.origin === "string" && typeof report.target.path === "string"
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(report.target.profileId), "qualification target is invalid");
  invariant(new Set(["local", "staged-origin", "staged-cloudfront"]).has(report.target.kind), "qualification target kind is invalid");
  const origin = new URL(report.target.origin);
  invariant(!origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === "/", "qualification target origin is invalid");
  invariant(report.target.kind === "local" || origin.protocol === "https:", "staged qualification target must use HTTPS");
  invariant(Array.isArray(report.cases) && report.cases.length >= REQUIRED_CATEGORIES.length, "qualification cases are incomplete");
  invariant(report.counts && typeof report.counts === "object", "qualification counts are missing");
  const actual = { passed: 0, failed: 0, unsupported: 0 };
  const categories = new Set();
  const caseIds = new Set();
  for (const entry of report.cases) {
    invariant(entry && typeof entry === "object" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id), "qualification case ID is invalid");
    invariant(!caseIds.has(entry.id), `qualification case is duplicated: ${entry.id}`);
    caseIds.add(entry.id);
    invariant(REQUIRED_CATEGORIES.includes(entry.category), `qualification category is invalid: ${entry.category}`);
    invariant(new Set(["passed", "failed", "unsupported"]).has(entry.status), `qualification case status is invalid: ${entry.id}`);
    invariant(Number.isFinite(entry.durationMs) && entry.durationMs >= 0, `qualification case duration is invalid: ${entry.id}`);
    if (entry.status === "unsupported") invariant(typeof entry.reason === "string" && entry.reason.length > 0, `unsupported qualification case lacks a reason: ${entry.id}`);
    if (MUST_PASS_CATEGORIES.has(entry.category)) invariant(entry.status === "passed", `mandatory qualification case did not pass: ${entry.id}`);
    actual[entry.status] += 1;
    categories.add(entry.category);
  }
  for (const category of REQUIRED_CATEGORIES) invariant(categories.has(category), `qualification category is missing: ${category}`);
  for (const status of Object.keys(actual)) invariant(Number.isSafeInteger(report.counts[status]) && report.counts[status] === actual[status], "qualification counts are inconsistent");
  invariant(report.result === "pass" && actual.failed === 0, "production-path qualification did not pass");
  invariant(new Set(["released", "already-released"]).has(report.releaseOutcome), "qualification transport was not released");
}

function validateWorkloadEvidence(report, expectedIdentity) {
  invariant(report && report.schema === "eacl-demo.qualification-workload.v1", "workload schema is invalid");
  invariant(report.result === "pass" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(report.profileId), "workload result or profile is invalid");
  invariant(report.dataset && typeof report.dataset.fixtureId === "string" && report.dataset.fixtureId.length > 0
    && SHA256.test(report.dataset.manifestSha256), "workload dataset is invalid");
  if (expectedIdentity) invariant(report.dataset.manifestSha256 === expectedIdentity.dataManifestSha256, "workload data manifest does not match qualification");
  if (expectedIdentity) invariant(report.dataset.fixtureId === "eacl-demo-fixture-v1"
    && report.dataset.logicalResourceCount === PROFILE_RESOURCE_COUNTS[expectedIdentity.profileId],
  "workload dataset cut point does not match the profile");
  invariant(Array.isArray(report.cacheStates) && report.cacheStates.length > 0
    && new Set(report.cacheStates).size === report.cacheStates.length
    && report.cacheStates.every((state) => new Set(["cold", "warm", "bypass"]).has(state)), "workload cache states are invalid");
  invariant(Number.isSafeInteger(report.concurrency) && report.concurrency >= 1, "workload concurrency is invalid");
  const criteria = report.criteria;
  invariant(criteria && Number.isSafeInteger(criteria.concurrency) && criteria.concurrency === report.concurrency
    && Array.isArray(criteria.requiredPhases)
    && new Set(criteria.requiredPhases).size === criteria.requiredPhases.length
    && criteria.requiredPhases.every((phase) => WORKLOAD_PHASES.includes(phase))
    && criteria.requiredPhases.includes("cold") && criteria.requiredPhases.includes("warm"), "workload required phases are invalid");
  invariant(Number.isFinite(criteria.maximumErrorRate) && criteria.maximumErrorRate >= 0 && criteria.maximumErrorRate <= 1,
    "workload maximum error rate is invalid");
  invariant(Number.isFinite(criteria.minimumMemoryHeadroomPercent) && criteria.minimumMemoryHeadroomPercent >= 20 && criteria.minimumMemoryHeadroomPercent <= 100,
    "workload memory criterion is invalid");
  invariant(Array.isArray(report.phases) && report.phases.length === WORKLOAD_PHASES.length, "workload phases are incomplete");
  const phaseNames = new Set(report.phases.map(({ phase }) => phase));
  invariant(phaseNames.size === WORKLOAD_PHASES.length && WORKLOAD_PHASES.every((phase) => phaseNames.has(phase)), "workload phases are invalid");
  for (const phase of WORKLOAD_PHASES) {
    invariant(Number.isSafeInteger(criteria.repetitions?.[phase]) && criteria.repetitions[phase] >= 1
      && Number.isSafeInteger(criteria.minimumSamples?.[phase]) && criteria.minimumSamples[phase] >= 1
      && criteria.minimumSamples[phase] <= criteria.repetitions[phase]
      && Number.isFinite(criteria.maximumP95Ms?.[phase]) && criteria.maximumP95Ms[phase] > 0,
    `workload ${phase} criteria are invalid`);
    const evidence = report.phases.find((entry) => entry.phase === phase);
    invariant(new Set(["passed", "failed", "unsupported"]).has(evidence.status), `workload ${phase} status is invalid`);
    if (criteria.requiredPhases.includes(phase)) invariant(evidence.status === "passed", `required workload phase did not pass: ${phase}`);
    invariant(evidence.status !== "failed", `workload phase failed: ${phase}`);
    if (evidence.status === "passed") {
      invariant(Number.isSafeInteger(evidence.samples) && evidence.samples === criteria.repetitions[phase]
        && evidence.samples >= criteria.minimumSamples[phase],
        `workload ${phase} sample count is invalid`);
      invariant(Number.isSafeInteger(evidence.errors) && evidence.errors >= 0 && evidence.errors <= evidence.samples,
        `workload ${phase} error count is invalid`);
      invariant(Number.isFinite(evidence.errorRate) && evidence.errorRate === evidence.errors / evidence.samples
        && evidence.errorRate <= criteria.maximumErrorRate, `workload ${phase} error rate is invalid`);
      invariant(evidence.latencyMs && Number.isFinite(evidence.latencyMs.p95) && evidence.latencyMs.p95 >= 0
        && evidence.latencyMs.p95 <= criteria.maximumP95Ms[phase]
        && evidence.latencyMs.maximumP95 === criteria.maximumP95Ms[phase],
        `workload ${phase} latency is invalid`);
      invariant(evidence.memory && Number.isFinite(evidence.memory.minimumHeadroomPercent)
        && evidence.memory.minimumHeadroomPercent >= criteria.minimumMemoryHeadroomPercent
        && evidence.memory.minimumHeadroomPercent <= 100
        && evidence.memory.requiredHeadroomPercent === criteria.minimumMemoryHeadroomPercent,
      `workload ${phase} memory headroom is invalid`);
    } else {
      invariant(!criteria.requiredPhases.includes(phase) && evidence.samples === 0 && evidence.errors === 0,
        `unsupported workload phase is not safely optional: ${phase}`);
    }
  }
}

function validateIdentity(identity, label) {
  invariant(identity && typeof identity === "object", `${label} identity is missing`);
  invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(identity.profileId), `${label} profile ID is invalid`);
  invariant(SHA1.test(identity.demoSha) && SHA1.test(identity.eaclSha), `${label} source identity is invalid`);
  invariant(SHA256.test(identity.artifactSha256) && SHA256.test(identity.dataManifestSha256), `${label} digest identity is invalid`);
  invariant(IDENTIFIER.test(identity.deploymentId), `${label} deployment ID is invalid`);
}

function timestamp(value, label) {
  invariant(typeof value === "string" && TIMESTAMP.test(value), `${label} is invalid`);
  const parsed = Date.parse(value);
  invariant(!Number.isNaN(parsed), `${label} is invalid`);
  return parsed;
}

function captureReason(reasons, prefix, check) {
  try {
    check();
  } catch (error) {
    reasons.push(`${prefix}: ${error.message}`);
  }
}

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}
