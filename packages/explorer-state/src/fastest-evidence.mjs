import { sha256Hex } from "../../contracts/src/sha256.mjs";

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const EXPECTED_PROFILES = Object.freeze(["datahike-s3", "datahike-dynamodb"]);
const EXPECTED_OPERATION_WEIGHTS = Object.freeze({ authorize: 40, bootstrap: 5, countObjects: 10, getObject: 10, getSchema: 5, listRelationships: 15, listSubjects: 5, reverseRelationships: 10 });
const COMMON_BINDING_FIELDS = [
  "demoSha", "eaclSha", "serviceCodeDigest", "dataManifestDigest",
  "contractVersion", "region", "runtime", "architecture", "memoryMb",
  "snapStart", "timeoutSeconds", "ephemeralStorageMiB", "workloadDigest",
  "cacheLanesDigest"
];

export function validateFastestEvidence(evidence) {
  exactKeys(evidence, [
    "schema", "evidenceId", "methodVersion", "backend", "profiles", "fixture",
    "workload", "environment", "repetitions", "measuredAt", "expiresAt",
    "candidates", "results", "decision"
  ], "evidence");
  if (evidence.schema !== "eacl-demo.fastest-storage-evidence.v1") throw new Error("unsupported evidence schema");
  if (evidence.methodVersion !== "datahike-storage-million.v1" || evidence.backend !== "datahike" || stableJson(evidence.profiles) !== stableJson(EXPECTED_PROFILES)) throw new Error("unsupported fastest-storage comparison scope");
  if (evidence.evidenceId !== computeEvidenceId(evidence)) throw new Error("evidence ID does not match canonical content");
  if (!Array.isArray(evidence.profiles) || evidence.profiles.length < 2 || new Set(evidence.profiles).size !== evidence.profiles.length) throw new Error("at least two distinct profiles are required");
  if (evidence.profiles.some((id) => !id.startsWith(`${evidence.backend}-`))) throw new Error("every candidate must use the evidence backend");
  validateFixture(evidence.fixture);
  validateWorkload(evidence.workload);
  validateEnvironment(evidence.environment);
  validateRepetitions(evidence.repetitions);

  const measuredAt = parseDate(evidence.measuredAt, "measurement date");
  const expiresAt = parseDate(evidence.expiresAt, "evidence expiry");
  if (expiresAt <= measuredAt || expiresAt - measuredAt > 31 * 24 * 60 * 60 * 1000) throw new Error("evidence expiry must follow measurement by no more than 31 days");

  const candidateIds = validateCandidates(evidence, measuredAt, expiresAt);
  const resultIds = validateResults(evidence.results);
  if (!sameSet(candidateIds, evidence.profiles) || !sameSet(resultIds, evidence.profiles)) throw new Error("candidate bindings and results must exactly match profiles");

  validateDecision(evidence.decision);
  const computed = computeEvidenceDecision(evidence);
  if (stableJson(computed) !== stableJson(evidence.decision)) throw new Error("published fastest decision does not match measurements and method");
  return evidence;
}

export function computeEvidenceId(evidence) {
  const payload = structuredClone(evidence);
  delete payload.evidenceId;
  return `sha256:${sha256Hex(`${stableJson(payload)}\n`)}`;
}

export function sealFastestEvidence(evidenceWithoutId) {
  const evidence = { ...structuredClone(evidenceWithoutId), evidenceId: null };
  evidence.evidenceId = computeEvidenceId(evidence);
  return evidence;
}

export function isEvidenceCurrent(evidence, now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  return Number.isFinite(instant.getTime()) && instant.getTime() >= Date.parse(evidence.measuredAt) && instant.getTime() <= Date.parse(evidence.expiresAt);
}

export function computeEvidenceDecision(evidence) {
  const results = [...evidence.results].sort((left, right) => left.warmWeightedP95Ms - right.warmWeightedP95Ms || left.profileId.localeCompare(right.profileId));
  const best = results[0];
  const runners = results.slice(1);
  const minimumEffect = evidence.decision.minimumEffectFraction;
  const primaryWins = runners.every((runner) => {
    const improvement = runner.warmWeightedP95Ms === 0 ? 0 : (runner.warmWeightedP95Ms - best.warmWeightedP95Ms) / runner.warmWeightedP95Ms;
    return improvement >= minimumEffect && best.warmP95Ci95Ms[1] < runner.warmP95Ci95Ms[0];
  });
  if (primaryWins) return decision("winner", best.profileId, "warm-cache-disabled-p95", minimumEffect);

  const cold = [...results].sort((left, right) => left.coldOrRestoreP95Ms - right.coldOrRestoreP95Ms || left.profileId.localeCompare(right.profileId));
  if (cold[0].coldOrRestoreP95Ms < cold[1].coldOrRestoreP95Ms) {
    return decision("benchmark-tiebreak", cold[0].profileId, "cold-or-restore-p95", minimumEffect);
  }
  const cost = [...results].sort((left, right) => left.projectedMonthlyUsd - right.projectedMonthlyUsd || left.profileId.localeCompare(right.profileId));
  if (cost[0].projectedMonthlyUsd < cost[1].projectedMonthlyUsd) {
    return decision("benchmark-tiebreak", cost[0].profileId, "projected-monthly-cost", minimumEffect);
  }
  return decision("unresolved", null, "none", minimumEffect);
}

function validateFixture(fixture) {
  exactKeys(fixture, ["id", "manifestDigest", "fixtureDigest", "schemaDigest", "logicalResourceCount"], "fixture");
  if (fixture.id !== "eacl-demo-fixture-v1") throw new Error("fixture ID is not canonical");
  for (const field of ["manifestDigest", "fixtureDigest", "schemaDigest"]) if (!SHA256.test(fixture[field])) throw new Error(`fixture ${field} is required`);
  if (fixture.logicalResourceCount !== 1_000_000) throw new Error("comparable storage evidence requires the million-resource cut point");
}

function validateWorkload(workload) {
  exactKeys(workload, ["id", "digest", "requestsPerWave", "operationWeights", "cacheLanesDigest"], "workload");
  if (!SHA256.test(workload.digest) || !SHA256.test(workload.cacheLanesDigest)) throw new Error("workload digests are required");
  if (workload.id !== "datahike-storage-million-v1" || stableJson(workload.operationWeights) !== stableJson(EXPECTED_OPERATION_WEIGHTS)) throw new Error("workload identity or operation weights are invalid");
  if (workload.requestsPerWave !== 100) throw new Error("workload must contain 100 requests per wave");
  const total = Object.values(workload.operationWeights).reduce((sum, value) => sum + value, 0);
  if (total !== 100) throw new Error("operation weights must sum to 100");
}

function validateEnvironment(environment) {
  exactKeys(environment, ["region", "runtime", "architecture", "memoryMb", "snapStart", "timeoutSeconds", "ephemeralStorageMiB", "productionPath"], "environment");
  if (environment.region !== "us-east-1" || environment.runtime !== "java25" || environment.architecture !== "arm64" || !new Set(["None", "PublishedVersions"]).has(environment.snapStart) || environment.productionPath !== "function-url-v2") throw new Error("environment does not match the accepted Datahike benchmark runtime");
  for (const field of ["memoryMb", "timeoutSeconds", "ephemeralStorageMiB"]) if (!Number.isSafeInteger(environment[field]) || environment[field] < 1) throw new Error(`environment ${field} is invalid`);
}

function validateRepetitions(repetitions) {
  exactKeys(repetitions, ["coldOrRestore", "warmWavesPerLane", "concurrency", "bootstrapResamples"], "repetitions");
  if (!Number.isSafeInteger(repetitions.coldOrRestore) || !Number.isSafeInteger(repetitions.warmWavesPerLane) || repetitions.coldOrRestore < 30 || repetitions.warmWavesPerLane < 30 || repetitions.bootstrapResamples !== 10_000) throw new Error("insufficient repetitions");
  if (stableJson(repetitions.concurrency) !== "[1,8]") throw new Error("benchmark concurrency must be exactly 1 and 8");
}

function validateCandidates(evidence, measuredAt, evidenceExpiresAt) {
  if (!Array.isArray(evidence.candidates)) throw new Error("candidate bindings are required");
  const reference = evidence.candidates[0];
  for (const candidate of evidence.candidates) {
    exactKeys(candidate, [
      "profileId", "storage", "demoSha", "eaclSha", "artifactDigest",
      "deploymentId",
      "serviceCodeDigest", "dataLifecycleId", "dataManifestDigest",
      "qualificationEvidenceId", "qualificationExpiresAt", "qualificationPassing",
      "contractVersion", "region", "runtime", "architecture", "memoryMb",
      "snapStart", "timeoutSeconds", "ephemeralStorageMiB", "workloadDigest",
      "cacheLanesDigest"
    ], `candidate ${candidate.profileId}`);
    if (!SHA1.test(candidate.demoSha) || !SHA1.test(candidate.eaclSha)) throw new Error("candidate sources must be exact SHAs");
    if (typeof candidate.deploymentId !== "string" || candidate.deploymentId.length < 1 || candidate.deploymentId.length > 256) throw new Error("candidate deployment ID is invalid");
    if ((candidate.profileId === "datahike-s3" ? candidate.storage !== "s3" : candidate.profileId === "datahike-dynamodb" ? candidate.storage !== "dynamodb" : true)) throw new Error("candidate profile/storage mapping is invalid");
    if (typeof candidate.dataLifecycleId !== "string" || candidate.dataLifecycleId.length < 1 || candidate.dataLifecycleId.length > 256 || candidate.contractVersion !== "explorer.v1") throw new Error("candidate lifecycle or contract identity is invalid");
    for (const field of ["artifactDigest", "serviceCodeDigest", "dataManifestDigest", "qualificationEvidenceId", "workloadDigest", "cacheLanesDigest"]) {
      if (!SHA256.test(candidate[field])) throw new Error(`candidate ${candidate.profileId} has invalid ${field}`);
    }
    if (candidate.qualificationPassing !== true) throw new Error(`candidate ${candidate.profileId} qualification is not passing`);
    const qualificationExpiry = parseDate(candidate.qualificationExpiresAt, "qualification expiry");
    if (qualificationExpiry <= measuredAt || qualificationExpiry < evidenceExpiresAt) throw new Error(`candidate ${candidate.profileId} qualification does not cover evidence lifetime`);
    if (candidate.dataManifestDigest !== evidence.fixture.manifestDigest || candidate.workloadDigest !== evidence.workload.digest || candidate.cacheLanesDigest !== evidence.workload.cacheLanesDigest) throw new Error("candidate fixture or workload binding is incomparable");
    for (const field of ["region", "runtime", "architecture", "memoryMb", "snapStart", "timeoutSeconds", "ephemeralStorageMiB"]) {
      if (candidate[field] !== evidence.environment[field]) throw new Error(`candidate environment differs at ${field}`);
    }
    for (const field of COMMON_BINDING_FIELDS) {
      if (candidate[field] !== reference[field]) throw new Error(`candidate configurations are incomparable at ${field}`);
    }
  }
  return evidence.candidates.map(({ profileId }) => profileId);
}

function validateResults(results) {
  if (!Array.isArray(results)) throw new Error("benchmark results are required");
  for (const result of results) {
    exactKeys(result, ["profileId", "warmWeightedP95Ms", "coldOrRestoreP95Ms", "warmP95Ci95Ms", "coldP95Ci95Ms", "errorRate", "projectedMonthlyUsd", "warmSamples", "coldSamples"], `result ${result.profileId}`);
    for (const field of ["warmWeightedP95Ms", "coldOrRestoreP95Ms", "projectedMonthlyUsd"]) if (typeof result[field] !== "number" || result[field] < 0 || !Number.isFinite(result[field])) throw new Error(`result ${result.profileId} has invalid ${field}`);
    for (const field of ["warmP95Ci95Ms", "coldP95Ci95Ms"]) if (!Array.isArray(result[field]) || result[field].length !== 2 || result[field].some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0) || result[field][0] > result[field][1]) throw new Error(`result ${result.profileId} has invalid ${field}`);
    if (result.errorRate !== 0) throw new Error(`result ${result.profileId} has correctness or availability errors`);
    if (!Number.isSafeInteger(result.warmSamples) || !Number.isSafeInteger(result.coldSamples) || result.warmSamples < 6_000 || result.coldSamples < 30) throw new Error(`result ${result.profileId} has insufficient samples`);
  }
  return results.map(({ profileId }) => profileId);
}

function validateDecision(value) {
  exactKeys(value, ["outcome", "defaultProfileId", "selectionBasis", "primaryMetric", "minimumEffectFraction", "tieBreakOrder"], "decision");
  if (!new Set(["winner", "benchmark-tiebreak", "unresolved"]).has(value.outcome)
    || (value.defaultProfileId !== null && !EXPECTED_PROFILES.includes(value.defaultProfileId))
    || !new Set(["warm-cache-disabled-p95", "cold-or-restore-p95", "projected-monthly-cost", "none"]).has(value.selectionBasis)
    || value.primaryMetric !== "operation-weighted-warm-cache-disabled-service-p95-ms"
    || value.minimumEffectFraction !== 0.05
    || stableJson(value.tieBreakOrder) !== stableJson(["cold-or-restore-p95-ms", "projected-monthly-usd"])) throw new Error("benchmark decision rule is invalid");
}

function decision(outcome, defaultProfileId, selectionBasis, minimumEffectFraction) {
  return {
    outcome,
    defaultProfileId,
    selectionBasis,
    primaryMetric: "operation-weighted-warm-cache-disabled-service-p95-ms",
    minimumEffectFraction,
    tieBreakOrder: ["cold-or-restore-p95-ms", "projected-monthly-usd"]
  };
}

function parseDate(value, name) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} is invalid`);
  return parsed;
}

function sameSet(left, right) {
  return stableJson([...left].sort()) === stableJson([...right].sort());
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || stableJson(Object.keys(value).sort()) !== stableJson([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) throw new TypeError("evidence JSON requires finite unambiguous numbers");
  return JSON.stringify(value);
}
