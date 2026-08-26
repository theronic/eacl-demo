import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { assertEnvelopeIdentity, assertIdentity, successfulData } from "./runner.mjs";
import { SERVER_PROFILE_IDS } from "./targets.mjs";

const FAULT_CASES = Object.freeze([
  ["invalid-json", 400, "validation-error"],
  ["oversized-body", 413, "request-too-large"],
  ["unsupported-media-type", 415, "unsupported-media-type"],
  ["wrong-method", 405, "method-not-allowed"],
  ["mutation-route", 404, "route-not-found"],
  ["client-cancel", null, "client-aborted"]
]);
const PROFILE_PLATFORMS = Object.freeze({
  "datahike-s3": { runtime: "java25", architecture: "arm64", snapStart: "optional" },
  "datahike-dynamodb": { runtime: "java25", architecture: "arm64", snapStart: "optional" },
  "datomic-dynamodb": { runtime: "java25", architecture: "x86_64", snapStart: "optional" },
  "datalevin-memory": { runtime: "java25", architecture: "arm64", snapStart: "required" },
  "jank-memory": { runtime: "provided.al2023", architecture: "x86_64", snapStart: "forbidden" }
});

export async function runHttpRuntimeExercise({ kind, transport, target, expectedIdentity, allowedDemand, deniedDemand, requestCount, concurrency, requestTimeoutMs, maximumP95Ms, maximumErrorRate, clock = () => new Date().toISOString() }) {
  if (!new Set(["load", "fault"]).has(kind)) throw new TypeError("HTTP runtime exercise kind is invalid");
  validateTransport(transport);
  validateTarget(target, expectedIdentity?.profileId, kind);
  assertIdentity(expectedIdentity, expectedIdentity);
  const bounds = validateHttpBounds({ kind, requestCount, concurrency, requestTimeoutMs, maximumP95Ms, maximumErrorRate });
  const startedAt = clock();
  const cases = [];
  let load = null;
  try {
    const preflight = [
      await readinessCase(cases, "preflight-health", transport, expectedIdentity, "health", bounds.requestTimeoutMs),
      await readinessCase(cases, "preflight-bootstrap", transport, expectedIdentity, "bootstrap", bounds.requestTimeoutMs)
    ];
    if (preflight.every(Boolean)) {
      if (kind === "load") {
        const workload = await runBoundedLoad({ transport, expectedIdentity, allowedDemand, deniedDemand, ...bounds });
        cases.push(...workload.cases);
        load = workload.summary;
      } else {
        cases.push(...await runFaultCampaign(transport, bounds.requestTimeoutMs));
      }
      await readinessCase(cases, "recovery-health", transport, expectedIdentity, "health", bounds.requestTimeoutMs);
      await readinessCase(cases, "recovery-bootstrap", transport, expectedIdentity, "bootstrap", bounds.requestTimeoutMs);
    }
  } finally {
    await transport.release?.();
  }
  return sealedReport({
    schema: "eacl-demo.manual-runtime-exercise.v1",
    exercise: kind,
    startedAt,
    completedAt: clock(),
    target: structuredClone(target),
    identity: { ...expectedIdentity },
    bounds,
    load,
    memory: null,
    cases
  });
}

export async function runLambdaMemoryExercise({ invoke, target, expectedIdentity, functionConfiguration, allowedDemand, deniedDemand, samples, minimumHeadroomPercent, maximumInitializationMs, maximumRestoreMs, maximumDurationMs, clock = () => new Date().toISOString() }) {
  if (typeof invoke !== "function") throw new TypeError("Lambda memory invocation adapter is required");
  validateTarget(target, expectedIdentity?.profileId, "memory");
  assertIdentity(expectedIdentity, expectedIdentity);
  const bounds = validateMemoryBounds({ samples, minimumHeadroomPercent, maximumInitializationMs, maximumRestoreMs, maximumDurationMs });
  validateFunctionConfiguration(functionConfiguration, expectedIdentity);
  if (target.functionArn !== functionConfiguration.functionArn || target.qualifier !== functionConfiguration.qualifier) throw new Error("Lambda memory target does not match the immutable function configuration");
  const startedAt = clock();
  const cases = [];
  const observations = [];
  for (let index = 0; index < samples; index += 1) {
    const operation = index === 0 ? "health" : (index % 2 === 0 ? "authorize-deny" : "authorize-allow");
    const input = operation === "authorize-allow" ? demandInput(allowedDemand) : operation === "authorize-deny" ? demandInput(deniedDemand) : {};
    const requestOperation = operation.startsWith("authorize") ? "authorize" : operation;
    const started = performance.now();
    try {
      const observation = await invoke({ operation: requestOperation, input, sample: index });
      validateMemoryObservation(observation, functionConfiguration, expectedIdentity, requestOperation, input, operation === "authorize-allow" ? true : operation === "authorize-deny" ? false : null);
      observations.push(observation);
      cases.push(passed(`memory-sample-${index + 1}`, performance.now() - started));
    } catch (error) {
      cases.push(failed(`memory-sample-${index + 1}`, performance.now() - started, error));
      break;
    }
  }
  const memory = summarizeMemory(observations, bounds, functionConfiguration);
  cases.push(memory.result === "pass" ? passed("memory-headroom", 0) : failed("memory-headroom", 0, new Error(memory.reason)));
  return sealedReport({
    schema: "eacl-demo.manual-runtime-exercise.v1",
    exercise: "memory",
    startedAt,
    completedAt: clock(),
    target: structuredClone(target),
    identity: { ...expectedIdentity },
    bounds,
    load: null,
    memory,
    cases
  });
}

export function validateManualRuntimeExercise(report, { requirePassing = true } = {}) {
  exactKeys(report, ["schema", "evidenceId", "result", "exercise", "startedAt", "completedAt", "target", "identity", "bounds", "load", "memory", "counts", "cases"], "manual runtime exercise");
  if (report.schema !== "eacl-demo.manual-runtime-exercise.v1" || report.evidenceId !== manualRuntimeExerciseEvidenceId(report)) throw new Error("manual runtime exercise is not content-addressed");
  if (!new Set(["load", "memory", "fault"]).has(report.exercise)) throw new Error("manual runtime exercise kind is invalid");
  if (report.exercise === "memory") {
    const normalized = validateMemoryBounds(report.bounds);
    if (JSON.stringify(normalized) !== JSON.stringify(report.bounds)) throw new Error("manual memory bounds are not canonical");
  } else {
    const normalized = validateHttpBounds({ kind: report.exercise, ...report.bounds });
    if (JSON.stringify(normalized) !== JSON.stringify(report.bounds)) throw new Error("manual HTTP bounds are not canonical");
  }
  validateTarget(report.target, report.identity?.profileId, report.exercise);
  assertIdentity(report.identity, report.identity);
  const started = Date.parse(report.startedAt);
  const completed = Date.parse(report.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) throw new Error("manual runtime exercise timestamps are invalid");
  if (!Array.isArray(report.cases) || report.cases.length < 1 || report.cases.length > 64) throw new Error("manual runtime exercise cases are invalid");
  const counts = { passed: 0, failed: 0 };
  for (const entry of report.cases) {
    exactKeys(entry, ["id", "status", "durationMs", "reason"], "manual runtime exercise case");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id) || !new Set(["passed", "failed"]).has(entry.status) || !Number.isFinite(entry.durationMs) || entry.durationMs < 0) throw new Error("manual runtime exercise case is invalid");
    if (entry.status === "passed" ? entry.reason !== null : typeof entry.reason !== "string" || entry.reason.length < 1 || entry.reason.length > 320) throw new Error("manual runtime exercise case result is invalid");
    counts[entry.status] += 1;
  }
  validateCaseSet(report);
  if (JSON.stringify(counts) !== JSON.stringify(report.counts) || report.result !== (counts.failed === 0 ? "pass" : "fail")) throw new Error("manual runtime exercise counts are inconsistent");
  if (report.exercise === "load") {
    if (report.load === null ? report.result !== "fail" : !validateLoadSummary(report.load, report.bounds)) throw new Error("manual load evidence is inconsistent");
    if (report.load !== null) validateLoadCaseOutcomes(report);
  }
  else if (report.load !== null) throw new Error("non-load exercise cannot carry load evidence");
  if (report.exercise === "memory" ? !validateMemorySummary(report.memory, report.bounds, report.result, report.identity.profileId, report.target) : report.memory !== null) throw new Error("manual runtime exercise memory evidence is inconsistent");
  if (requirePassing && report.result !== "pass") throw new Error("manual runtime exercise did not pass");
  return report;
}

async function runBoundedLoad({ transport, expectedIdentity, allowedDemand, deniedDemand, requestCount, concurrency, requestTimeoutMs, maximumP95Ms, maximumErrorRate }) {
  const durations = [];
  const outcomes = [];
  let cursor = 0;
  let stopped = false;
  const workers = Array.from({ length: Math.min(concurrency, requestCount) }, async () => {
    while (true) {
      if (stopped) return;
      const index = cursor++;
      if (index >= requestCount) return;
      const allowed = index % 2 === 0;
      const input = demandInput(allowed ? allowedDemand : deniedDemand);
      const started = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new DOMException("manual exercise deadline", "TimeoutError")), requestTimeoutMs);
      try {
        const response = assertEnvelopeIdentity(await transport.request("authorize", input, { signal: controller.signal }), "authorize", expectedIdentity);
        const decision = successfulData(response, "authorize");
        assertDecision(decision, input, allowed);
        outcomes.push({ ok: true });
      } catch (error) {
        outcomes.push({ ok: false, reason: safeMessage(error) });
        stopped = true;
      } finally {
        clearTimeout(timeout);
        durations.push(performance.now() - started);
      }
    }
  });
  await Promise.all(workers);
  const failedCount = outcomes.filter(({ ok }) => !ok).length;
  const attemptedCount = outcomes.length;
  const p95 = percentile(durations, 0.95);
  const errorRate = failedCount / attemptedCount;
  const p50 = percentile(durations, 0.5);
  const cases = [];
  if (failedCount > 0 || attemptedCount !== requestCount) cases.push(failed("load-requests", 0, new Error(`${failedCount} of ${attemptedCount} attempted requests failed; ${requestCount} were requested`)));
  else cases.push(passed("load-requests", 0));
  if (p95 > maximumP95Ms) cases.push(failed("load-p95", 0, new Error(`p95 ${round(p95)}ms exceeds ${maximumP95Ms}ms`)));
  else cases.push(passed("load-p95", 0));
  if (errorRate > maximumErrorRate) cases.push(failed("load-error-rate", 0, new Error(`error rate ${round(errorRate)} exceeds ${maximumErrorRate}`)));
  else cases.push(passed("load-error-rate", 0));
  return { cases, summary: { requestCount, attemptedCount, concurrency, failedCount, errorRate: round(errorRate), latencyMs: { p50: round(p50), p95: round(p95), maximumP95: maximumP95Ms } } };
}

async function runFaultCampaign(transport, requestTimeoutMs) {
  if (typeof transport.probeFault !== "function") throw new TypeError("fault exercise transport must expose closed raw probes");
  const results = [];
  for (const [kind, status, code] of FAULT_CASES) {
    const started = performance.now();
    try {
      const result = await transport.probeFault(kind, { requestTimeoutMs });
      if (kind === "client-cancel") {
        if (result?.aborted !== true) throw new Error("client cancellation was not observed");
      } else if (result?.aborted !== false || result.status !== status || result.envelope?.ok !== false || result.envelope?.error?.code !== code) {
        throw new Error(`${kind} did not return the closed ${status}/${code} failure`);
      }
      results.push(passed(`fault-${kind}`, performance.now() - started));
    } catch (error) {
      results.push(failed(`fault-${kind}`, performance.now() - started, error));
    }
  }
  return results;
}

async function readinessCase(cases, id, transport, expectedIdentity, operation, requestTimeoutMs) {
  const started = performance.now();
  try {
    const response = assertEnvelopeIdentity(await transport.request(operation, {}, { signal: AbortSignal.timeout(requestTimeoutMs) }), operation, expectedIdentity);
    const value = successfulData(response, operation);
    assertIdentity(value.identity, expectedIdentity);
    if (operation === "health" && (value.ready !== true || value.status !== "ready")) throw new Error("profile health is not ready");
    cases.push(passed(id, performance.now() - started));
    return true;
  } catch (error) {
    cases.push(failed(id, performance.now() - started, error));
    return false;
  }
}

function validateLoadSummary(value, bounds) {
  exactKeys(value, ["requestCount", "attemptedCount", "concurrency", "failedCount", "errorRate", "latencyMs"], "manual load summary");
  exactKeys(value.latencyMs, ["p50", "p95", "maximumP95"], "manual load latency summary");
  if (value.requestCount !== bounds.requestCount || !Number.isSafeInteger(value.attemptedCount) || value.attemptedCount < 1 || value.attemptedCount > value.requestCount || value.concurrency !== bounds.concurrency || !Number.isSafeInteger(value.failedCount) || value.failedCount < 0 || value.failedCount > value.attemptedCount || !Number.isFinite(value.errorRate) || value.errorRate !== round(value.failedCount / value.attemptedCount) || !Number.isFinite(value.latencyMs.p50) || !Number.isFinite(value.latencyMs.p95) || value.latencyMs.p50 < 0 || value.latencyMs.p95 < value.latencyMs.p50 || value.latencyMs.maximumP95 !== bounds.maximumP95Ms) throw new Error("manual load summary is inconsistent");
  return true;
}

function validateCaseSet(report) {
  const preflight = ["preflight-health", "preflight-bootstrap"];
  let expected;
  if (report.exercise === "memory") {
    const executed = report.cases.length - 1;
    if (executed < 1 || executed > report.bounds.samples || (executed < report.bounds.samples && (report.result !== "fail" || report.cases.slice(0, -1).every(({ status }) => status === "passed")))) throw new Error("manual memory exercise did not stop on its first failed sample");
    expected = [...Array.from({ length: executed }, (_, index) => `memory-sample-${index + 1}`), "memory-headroom"];
  } else if (report.exercise === "load" && report.load !== null) {
    expected = [...preflight, "load-requests", "load-p95", "load-error-rate", "recovery-health", "recovery-bootstrap"];
  } else if (report.exercise === "fault" && report.cases.length > preflight.length) {
    expected = [...preflight, ...FAULT_CASES.map(([kind]) => `fault-${kind}`), "recovery-health", "recovery-bootstrap"];
  } else {
    expected = preflight;
    if (report.result !== "fail" || report.cases.every(({ status }) => status === "passed")) throw new Error("manual exercise stopped without a failed preflight");
  }
  if (JSON.stringify(report.cases.map(({ id }) => id)) !== JSON.stringify(expected)) throw new Error("manual runtime exercise cases are not the closed ordered set");
}

function validateLoadCaseOutcomes(report) {
  const statuses = Object.fromEntries(report.cases.map(({ id, status }) => [id, status]));
  const expected = {
    "load-requests": report.load.failedCount === 0 && report.load.attemptedCount === report.load.requestCount ? "passed" : "failed",
    "load-p95": report.load.latencyMs.p95 <= report.bounds.maximumP95Ms ? "passed" : "failed",
    "load-error-rate": report.load.errorRate <= report.bounds.maximumErrorRate ? "passed" : "failed"
  };
  if (Object.entries(expected).some(([id, status]) => statuses[id] !== status)) throw new Error("manual load case outcomes do not match the measured summary");
}

function validateMemorySummary(value, bounds, reportResult, profileId, target) {
  exactKeys(value, ["result", "functionName", "qualifier", "runtime", "architecture", "snapStart", "memorySizeMiB", "maxMemoryUsedMiB", "headroomPercent", "maximumDurationMs", "maximumInitializationMs", "maximumRestoreMs", "reason"], "manual memory summary");
  const platform = PROFILE_PLATFORMS[profileId] ?? null;
  if (!new Set(["pass", "fail"]).has(value.result) || value.result !== reportResult || !/^[A-Za-z0-9-_]{1,64}$/u.test(value.functionName) || target.functionArn.split(":").at(-1) !== value.functionName || target.qualifier !== value.qualifier || !/^[1-9][0-9]*$/u.test(value.qualifier) || !platform || value.runtime !== platform.runtime || value.architecture !== platform.architecture || !new Set(["enabled", "disabled"]).has(value.snapStart) || (platform.snapStart === "required" && value.snapStart !== "enabled") || (platform.snapStart === "forbidden" && value.snapStart !== "disabled") || !Number.isSafeInteger(value.memorySizeMiB) || value.memorySizeMiB < 128 || value.memorySizeMiB > 10240) return false;
  if (value.maxMemoryUsedMiB === null) return value.result === "fail" && value.headroomPercent === null && value.maximumDurationMs === null && value.maximumInitializationMs === null && value.maximumRestoreMs === null && typeof value.reason === "string" && value.reason.length > 0 && value.reason.length <= 320;
  if (!Number.isSafeInteger(value.maxMemoryUsedMiB) || value.maxMemoryUsedMiB < 1 || value.maxMemoryUsedMiB > value.memorySizeMiB || value.headroomPercent !== round(((value.memorySizeMiB - value.maxMemoryUsedMiB) / value.memorySizeMiB) * 100) || !Number.isFinite(value.maximumDurationMs) || value.maximumDurationMs < 0 || (value.maximumInitializationMs !== null && (!Number.isFinite(value.maximumInitializationMs) || value.maximumInitializationMs < 0)) || (value.maximumRestoreMs !== null && (!Number.isFinite(value.maximumRestoreMs) || value.maximumRestoreMs < 0))) return false;
  const lifecyclePassed = value.snapStart === "enabled" ? value.maximumRestoreMs !== null && value.maximumRestoreMs <= bounds.maximumRestoreMs && value.maximumInitializationMs === null : value.maximumInitializationMs !== null && value.maximumInitializationMs <= bounds.maximumInitializationMs && value.maximumRestoreMs === null;
  const shouldPass = value.headroomPercent >= bounds.minimumHeadroomPercent && value.maximumDurationMs <= bounds.maximumDurationMs && lifecyclePassed;
  return value.result === (shouldPass ? "pass" : "fail") && (shouldPass ? value.reason === null : typeof value.reason === "string" && value.reason.length > 0 && value.reason.length <= 320);
}

function validateMemoryObservation(value, configuration, expectedIdentity, operation, input, expectedAllowed) {
  exactKeys(value, ["envelope", "memorySizeMiB", "maxMemoryUsedMiB", "durationMs", "billedDurationMs", "initDurationMs", "restoreDurationMs"], "Lambda memory observation");
  const envelope = assertEnvelopeIdentity(value.envelope, operation, expectedIdentity);
  const data = successfulData(envelope, operation);
  if (operation === "health") {
    assertIdentity(data.identity, expectedIdentity);
    if (data.ready !== true || data.status !== "ready") throw new Error("Lambda memory health sample was not ready");
  } else {
    assertDecision(data, input, expectedAllowed);
  }
  if (value.memorySizeMiB !== configuration.memorySizeMiB || !Number.isSafeInteger(value.maxMemoryUsedMiB) || value.maxMemoryUsedMiB < 1 || value.maxMemoryUsedMiB > value.memorySizeMiB) throw new Error("Lambda REPORT memory observation is invalid");
  for (const key of ["durationMs", "billedDurationMs"]) if (!Number.isFinite(value[key]) || value[key] < 0) throw new Error("Lambda REPORT duration observation is invalid");
  if (value.initDurationMs !== null && (!Number.isFinite(value.initDurationMs) || value.initDurationMs < 0)) throw new Error("Lambda REPORT initialization observation is invalid");
  if (value.restoreDurationMs !== null && (!Number.isFinite(value.restoreDurationMs) || value.restoreDurationMs < 0)) throw new Error("Lambda REPORT restore observation is invalid");
  if (configuration.snapStart === "enabled" ? value.initDurationMs !== null : value.restoreDurationMs !== null) throw new Error("Lambda REPORT lifecycle observation contradicts SnapStart configuration");
}

function summarizeMemory(observations, bounds, configuration) {
  if (observations.length !== bounds.samples) return { result: "fail", functionName: configuration.functionName, qualifier: configuration.qualifier, runtime: configuration.runtime, architecture: configuration.architecture, snapStart: configuration.snapStart, memorySizeMiB: configuration.memorySizeMiB, maxMemoryUsedMiB: null, headroomPercent: null, maximumDurationMs: null, maximumInitializationMs: null, maximumRestoreMs: null, reason: `only ${observations.length} of ${bounds.samples} memory samples passed` };
  const maximumUsed = Math.max(...observations.map(({ maxMemoryUsedMiB }) => maxMemoryUsedMiB));
  const maximumDuration = Math.max(...observations.map(({ durationMs }) => durationMs));
  const initializations = observations.flatMap(({ initDurationMs }) => initDurationMs === null ? [] : [initDurationMs]);
  const restores = observations.flatMap(({ restoreDurationMs }) => restoreDurationMs === null ? [] : [restoreDurationMs]);
  const maximumInitialization = initializations.length === 0 ? null : Math.max(...initializations);
  const maximumRestore = restores.length === 0 ? null : Math.max(...restores);
  const headroom = round(((configuration.memorySizeMiB - maximumUsed) / configuration.memorySizeMiB) * 100);
  const reasons = [];
  if (headroom < bounds.minimumHeadroomPercent) reasons.push(`memory headroom ${headroom}% is below ${bounds.minimumHeadroomPercent}%`);
  if (maximumDuration > bounds.maximumDurationMs) reasons.push(`duration ${round(maximumDuration)}ms exceeds ${bounds.maximumDurationMs}ms`);
  if (configuration.snapStart === "enabled") {
    if (maximumRestore === null) reasons.push("no SnapStart restore sample was observed");
    else if (maximumRestore > bounds.maximumRestoreMs) reasons.push(`restore ${round(maximumRestore)}ms exceeds ${bounds.maximumRestoreMs}ms`);
  } else {
    if (maximumInitialization === null) reasons.push("no cold initialization sample was observed");
    else if (maximumInitialization > bounds.maximumInitializationMs) reasons.push(`initialization ${round(maximumInitialization)}ms exceeds ${bounds.maximumInitializationMs}ms`);
  }
  return { result: reasons.length === 0 ? "pass" : "fail", functionName: configuration.functionName, qualifier: configuration.qualifier, runtime: configuration.runtime, architecture: configuration.architecture, snapStart: configuration.snapStart, memorySizeMiB: configuration.memorySizeMiB, maxMemoryUsedMiB: maximumUsed, headroomPercent: headroom, maximumDurationMs: round(maximumDuration), maximumInitializationMs: maximumInitialization === null ? null : round(maximumInitialization), maximumRestoreMs: maximumRestore === null ? null : round(maximumRestore), reason: reasons.length === 0 ? null : reasons.join("; ") };
}

function validateFunctionConfiguration(value, expectedIdentity) {
  exactKeys(value, ["functionName", "functionArn", "qualifier", "version", "state", "lastUpdateStatus", "codeSha256", "runtime", "architecture", "snapStart", "memorySizeMiB", "project", "profileId"], "Lambda function configuration");
  const platform = PROFILE_PLATFORMS[expectedIdentity.profileId];
  if (!/^[A-Za-z0-9-_]{1,64}$/u.test(value.functionName) || !/^arn:[a-z0-9-]+:lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9-_]{1,64}$/u.test(value.functionArn) || value.functionArn.split(":").at(-1) !== value.functionName || !/^(?:[1-9][0-9]*|[A-Za-z0-9-_]{1,128})$/u.test(value.qualifier) || value.version !== value.qualifier || value.state !== "Active" || value.lastUpdateStatus !== "Successful" || value.codeSha256 !== expectedIdentity.artifactSha256 || !platform || value.runtime !== platform.runtime || value.architecture !== platform.architecture || !new Set(["enabled", "disabled"]).has(value.snapStart) || (platform.snapStart === "required" && value.snapStart !== "enabled") || (platform.snapStart === "forbidden" && value.snapStart !== "disabled") || value.project !== "eacl-demo" || value.profileId !== expectedIdentity.profileId || !Number.isSafeInteger(value.memorySizeMiB) || value.memorySizeMiB < 128 || value.memorySizeMiB > 10240) throw new Error("Lambda function configuration does not bind the qualified immutable artifact, profile, and platform");
}

function validateTransport(transport) {
  if (!transport || typeof transport.request !== "function") throw new TypeError("manual runtime exercise transport is required");
}

function validateTarget(target, profileId, exercise) {
  if (!SERVER_PROFILE_IDS.includes(profileId)) throw new Error("manual runtime exercise profile is not registered");
  if (exercise === "memory") {
    exactKeys(target, ["kind", "functionArn", "qualifier", "profileId"], "manual runtime exercise target");
    if (target.kind !== "lambda-version" || target.profileId !== profileId || !/^arn:[a-z0-9-]+:lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9-_]{1,64}$/u.test(target.functionArn) || !/^[1-9][0-9]*$/u.test(target.qualifier)) throw new Error("manual memory exercise must target an exact Lambda version");
    return;
  }
  exactKeys(target, ["kind", "origin", "path", "profileId"], "manual runtime exercise target");
  if (target.kind !== "staged-cloudfront" || target.profileId !== profileId) throw new Error("manual HTTP runtime exercise must target staged CloudFront");
  const origin = new URL(target.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || target.path.replace(/\/$/u, "") !== `/api/v1/${profileId}`) throw new Error("manual runtime exercise target is invalid");
}

function validateHttpBounds(value) {
  const requestCount = value.kind === "load" ? boundedInteger(value.requestCount, 20, 500, "request count") : 0;
  const concurrency = value.kind === "load" ? boundedInteger(value.concurrency, 1, 8, "concurrency") : 1;
  const requestTimeoutMs = boundedInteger(value.requestTimeoutMs, 100, 10000, "request timeout");
  const maximumP95Ms = value.kind === "load" ? boundedInteger(value.maximumP95Ms, 1, 30000, "maximum p95") : 0;
  const maximumErrorRate = value.kind === "load" && value.maximumErrorRate === 0 ? 0 : value.kind === "fault" ? 0 : (() => { throw new TypeError("maximum error rate must be zero for a manual qualification exercise"); })();
  return { requestCount, concurrency, requestTimeoutMs, maximumP95Ms, maximumErrorRate };
}

function validateMemoryBounds(value) {
  return {
    samples: boundedInteger(value.samples, 5, 50, "memory samples"),
    minimumHeadroomPercent: boundedInteger(value.minimumHeadroomPercent, 20, 80, "minimum memory headroom"),
    maximumInitializationMs: boundedInteger(value.maximumInitializationMs, 1, 30000, "maximum initialization duration"),
    maximumRestoreMs: boundedInteger(value.maximumRestoreMs, 1, 30000, "maximum restore duration"),
    maximumDurationMs: boundedInteger(value.maximumDurationMs, 1, 30000, "maximum duration")
  };
}

function boundedInteger(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${name} is invalid`);
  return value;
}

function demandInput(demand) {
  if (!demand?.subject || !demand?.resource || typeof demand.permission !== "string") throw new TypeError("manual exercise demand is invalid");
  return { subjectType: demand.subject.type, subjectId: demand.subject.id, resourceType: demand.resource.type, resourceId: demand.resource.id, permission: demand.permission, consistency: "current" };
}

function assertDecision(decision, input, expectedAllowed) {
  for (const key of ["subjectType", "subjectId", "resourceType", "resourceId", "permission"]) if (decision?.[key] !== input[key]) throw new Error("load response does not match its request scope");
  if (decision.allowed !== expectedAllowed) throw new Error("load authorization result disagreed with the canonical exemplar");
}

function sealedReport(value) {
  const failedCount = value.cases.filter(({ status }) => status === "failed").length;
  const report = { ...value, evidenceId: null, result: failedCount === 0 ? "pass" : "fail", counts: { passed: value.cases.length - failedCount, failed: failedCount } };
  report.evidenceId = manualRuntimeExerciseEvidenceId(report);
  return report;
}

export function manualRuntimeExerciseEvidenceId(report) {
  const payload = structuredClone(report);
  delete payload.evidenceId;
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

function passed(id, durationMs) { return { id, status: "passed", durationMs: round(durationMs), reason: null }; }
function failed(id, durationMs, error) { return { id, status: "failed", durationMs: round(durationMs), reason: safeMessage(error) }; }
function safeMessage(error) { return String(error?.message ?? "manual exercise failed").replace(/https?:\/\/\S+|\b(?:token|secret|password|authorization)\b\s*[:=]\s*\S+|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\/(?:Users|home|var|tmp)\/\S+/giu, "[redacted]").slice(0, 320); }
function percentile(values, fraction) { return [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)]; }
function round(value) { return Math.round(value * 1000) / 1000; }

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
