import { createHash } from "node:crypto";

const SIGNALS = Object.freeze([
  "requests", "errors", "duration", "initialization", "restore",
  "throttles", "timeouts", "oom", "storage"
]);
const ALARMS = Object.freeze([
  "duration", "errors", "health", "initialization", "oom", "throttles",
  "timeouts"
]);
const SYNTHETICS = Object.freeze(["bootstrap", "exemplar", "health"]);
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DOCUMENT_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@/#-]{0,255}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

export function createObservabilityReadiness(input) {
  const value = structuredClone(input);
  exactKeys(value, [
    "schema", "identity", "route", "completedAt", "logs", "signals", "alarms",
    "dashboard", "synthetics", "runbook"
  ], "observability readiness input");
  value.evidenceId = evidenceId(value);
  return validateObservabilityReadiness(value);
}

export function validateObservabilityReadiness(value, expectedIdentity = null, deployment = null, expectedRoute = null) {
  exactKeys(value, [
    "schema", "identity", "route", "completedAt", "logs", "signals", "alarms",
    "dashboard", "synthetics", "runbook", "evidenceId"
  ], "observability readiness");
  invariant(value.schema === "eacl-demo.observability-readiness.v1", "observability readiness schema is invalid");
  validateIdentity(value.identity);
  validateRoute(value.route, value.identity.profileId, "observability route");
  const completedAt = timestamp(value.completedAt, "observability completion time");
  invariant(value.evidenceId === evidenceId(withoutEvidenceId(value)), "observability evidence digest is invalid");

  exactKeys(value.logs, ["structured", "redactionAudit", "retentionDays"], "observability logs");
  invariant(value.logs.structured === true, "structured logging is not ready");
  invariant(value.logs.redactionAudit === "passed", "log redaction audit did not pass");
  invariant(Number.isSafeInteger(value.logs.retentionDays)
    && value.logs.retentionDays >= 1 && value.logs.retentionDays <= 30,
  "log retention must be bounded to 1-30 days");

  validateNamedStatuses(value.signals, SIGNALS, "signal");
  validateNamedStatuses(value.alarms, ALARMS, "alarm", (entry) => {
    exactKeys(entry, ["name", "status", "state", "actionsEnabled", "notificationPath", "scope"], `alarm ${entry.name}`);
    invariant(entry.state === "OK", `alarm ${entry.name} is not OK`);
    invariant(entry.actionsEnabled === true, `alarm ${entry.name} actions are disabled`);
    invariant(entry.notificationPath === "sns-telegram", `alarm ${entry.name} does not use the Telegram path`);
    exactKeys(entry.scope, ["profileId", "resourceIdentifier"], `alarm ${entry.name} scope`);
    invariant(entry.scope.profileId === value.identity.profileId, `alarm ${entry.name} profile scope is invalid`);
    invariant(IDENTIFIER.test(entry.scope.resourceIdentifier), `alarm ${entry.name} resource scope is invalid`);
  });

  exactKeys(value.dashboard, ["status", "identifier"], "observability dashboard");
  invariant(value.dashboard.status === "ready", "profile dashboard is not ready");
  invariant(IDENTIFIER.test(value.dashboard.identifier), "profile dashboard identifier is invalid");
  validateNamedStatuses(value.synthetics, SYNTHETICS, "synthetic", (entry) => {
    exactKeys(entry, ["name", "status", "target", "checkedAt", "observedIdentity"], `synthetic ${entry.name}`);
    exactKeys(entry.target, ["kind", "baseUrl"], `synthetic ${entry.name} target`);
    invariant(entry.target.kind === "staged-cloudfront", `synthetic ${entry.name} did not traverse staged CloudFront`);
    validateProfileRoute(entry.target.baseUrl, value.route, `synthetic ${entry.name}`);
    const checkedAt = timestamp(entry.checkedAt, `synthetic ${entry.name} check time`);
    invariant(checkedAt <= completedAt, `synthetic ${entry.name} postdates observability completion`);
    validateIdentity(entry.observedIdentity);
    invariant(sameIdentity(entry.observedIdentity, value.identity), `synthetic ${entry.name} observed the wrong identity`);
  });

  exactKeys(value.runbook, ["status", "identifier"], "observability runbook");
  invariant(value.runbook.status === "ready", "profile runbook is not ready");
  invariant(DOCUMENT_REFERENCE.test(value.runbook.identifier), "profile runbook identifier is invalid");

  if (expectedIdentity !== null) invariant(sameIdentity(value.identity, expectedIdentity), "observability identity does not match qualification");
  if (expectedRoute !== null) invariant(normalizeRoute(value.route) === normalizeRoute(expectedRoute), "observability route does not match profile");
  if (deployment !== null) {
    invariant(deploymentMatches(value.identity, deployment), "observability identity does not match deployment");
    const deployedAt = timestamp(deployment.deployedAt, "deployment time");
    invariant(completedAt >= deployedAt, "observability evidence predates deployment");
    for (const synthetic of value.synthetics) {
      invariant(timestamp(synthetic.checkedAt, `synthetic ${synthetic.name} check time`) >= deployedAt,
        `synthetic ${synthetic.name} predates deployment`);
    }
  }
  return value;
}

function validateNamedStatuses(entries, expectedNames, label, validateEntry = null) {
  invariant(Array.isArray(entries), `observability ${label}s must be an array`);
  const actualNames = entries.map(({ name }) => name).sort();
  invariant(JSON.stringify(actualNames) === JSON.stringify([...expectedNames].sort()),
    `observability ${label}s must be the exact required set`);
  for (const entry of entries) {
    if (validateEntry) validateEntry(entry);
    else exactKeys(entry, ["name", "status"], `${label} ${entry.name}`);
    invariant(entry.status === "ready" || entry.status === "passed", `${label} ${entry.name} is not ready`);
  }
}

function validateIdentity(identity) {
  exactKeys(identity, [
    "profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId",
    "dataManifestSha256"
  ], "observability identity");
  invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(identity.profileId), "observability profile ID is invalid");
  invariant(SHA1.test(identity.demoSha) && SHA1.test(identity.eaclSha), "observability source identity is invalid");
  invariant(SHA256.test(identity.artifactSha256) && SHA256.test(identity.dataManifestSha256), "observability digest identity is invalid");
  invariant(IDENTIFIER.test(identity.deploymentId), "observability deployment ID is invalid");
}

function sameIdentity(left, right) {
  return left && right && [
    "profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId",
    "dataManifestSha256"
  ].every((key) => left[key] === right[key]);
}

function deploymentMatches(identity, deployment) {
  return identity.demoSha === deployment?.demoSha
    && identity.eaclSha === deployment?.eaclSha
    && identity.artifactSha256 === deployment?.artifact?.sha256
    && identity.deploymentId === deployment?.deploymentId
    && identity.dataManifestSha256 === deployment?.dataManifestSha256;
}

function validateProfileRoute(baseUrl, expectedRoute, label) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError(`${label} target URL is invalid`);
  }
  invariant(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash,
    `${label} target URL is not a clean HTTPS route`);
  invariant(normalizeRoute(url.pathname) === normalizeRoute(expectedRoute), `${label} target route does not match the profile`);
}

function validateRoute(route, profileId, label) {
  invariant(typeof route === "string" && (
    normalizeRoute(route) === `/api/v1/${profileId}`
      || (profileId === "datascript-browser-memory" && normalizeRoute(route) === "/datascript")
  ), `${label} is invalid`);
}

function normalizeRoute(route) {
  return route === "/" ? route : route.replace(/\/$/u, "");
}

function timestamp(value, label) {
  invariant(typeof value === "string" && TIMESTAMP.test(value), `${label} is invalid`);
  const parsed = Date.parse(value);
  invariant(!Number.isNaN(parsed), `${label} is invalid`);
  return parsed;
}

function withoutEvidenceId(value) {
  const result = structuredClone(value);
  delete result.evidenceId;
  return result;
}

function evidenceId(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  invariant(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), `${label} fields are invalid`);
}

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}
