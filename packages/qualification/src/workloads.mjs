import { performance } from "node:perf_hooks";

const PHASES = ["cold", "restore", "warm"];

export class UnsupportedWorkloadPhaseError extends Error {
  constructor(phase, message = `${phase} lifecycle is not supported by this profile.`) {
    super(message);
    this.name = "UnsupportedWorkloadPhaseError";
    this.phase = phase;
  }
}

export async function runRepresentativeWorkloads({ profileId, dataset, operationMix, criteria, createTransport }) {
  validateConfiguration({ profileId, dataset, operationMix, criteria, createTransport });
  const schedule = weightedSchedule(operationMix);
  const phases = [];
  for (const phase of PHASES) phases.push(await runPhase(phase, { schedule, criteria, createTransport }));
  const failed = phases.filter(({ status }) => status === "failed");
  const missingRequired = phases.filter(({ phase, status }) => status === "unsupported" && criteria.requiredPhases.includes(phase));
  return {
    schema: "eacl-demo.qualification-workload.v1",
    result: failed.length === 0 && missingRequired.length === 0 ? "pass" : "fail",
    profileId,
    dataset: { ...dataset },
    cacheStates: [...new Set(operationMix.map(({ cacheState }) => cacheState))].sort(),
    concurrency: criteria.concurrency,
    criteria: structuredClone(criteria),
    phases
  };
}

async function runPhase(phase, context) {
  const repetitions = context.criteria.repetitions[phase];
  try {
    return phase === "warm" ? await runWarm(repetitions, context) : await runLifecycle(phase, repetitions, context);
  } catch (error) {
    if (error instanceof UnsupportedWorkloadPhaseError) return { phase, status: "unsupported", reason: error.message, samples: 0, errors: 0, latencyMs: null, memory: null };
    return { phase, status: "failed", reason: safeMessage(error), samples: 0, errors: 1, latencyMs: null, memory: null };
  }
}

async function runLifecycle(phase, repetitions, { schedule, criteria, createTransport }) {
  const observations = [];
  for (let index = 0; index < repetitions; index += 1) {
    const transport = await createTransport({ phase, sample: index });
    try {
      const started = performance.now();
      await requireSuccess(await transport.request("bootstrap", {}));
      await runOperation(transport, schedule[index % schedule.length]);
      observations.push({ latencyMs: performance.now() - started, error: null, memory: await metrics(transport) });
    } catch (error) {
      observations.push({ latencyMs: null, error, memory: await metrics(transport) });
    } finally {
      await transport.release?.();
    }
  }
  return summarize(phase, observations, criteria);
}

async function runWarm(repetitions, { schedule, criteria, createTransport }) {
  const transport = await createTransport({ phase: "warm", sample: 0 });
  try {
    await requireSuccess(await transport.request("bootstrap", {}));
    const observations = new Array(repetitions);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(criteria.concurrency, repetitions) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= repetitions) return;
        const started = performance.now();
        try {
          await runOperation(transport, schedule[index % schedule.length]);
          observations[index] = { latencyMs: performance.now() - started, error: null, memory: await metrics(transport) };
        } catch (error) {
          observations[index] = { latencyMs: null, error, memory: await metrics(transport) };
        }
      }
    });
    await Promise.all(workers);
    return summarize("warm", observations, criteria);
  } finally {
    await transport.release?.();
  }
}

async function runOperation(transport, entry) {
  const response = await transport.request(entry.operation, { ...entry.input }, { cacheState: entry.cacheState });
  await requireSuccess(response);
}

async function requireSuccess(response) {
  if (!response || response.ok !== true) throw Object.assign(new Error(`workload request failed: ${response?.error?.code ?? "invalid-envelope"}`), { code: response?.error?.code ?? "invalid-envelope" });
  return response;
}

async function metrics(transport) {
  if (typeof transport.metrics !== "function") return null;
  const value = await transport.metrics();
  if (!value) return null;
  const { peakBytes, memoryLimitBytes } = value;
  if (!Number.isSafeInteger(peakBytes) || peakBytes < 0 || !Number.isSafeInteger(memoryLimitBytes) || memoryLimitBytes < 1 || peakBytes > memoryLimitBytes) throw new Error("workload memory metrics are invalid");
  return { peakBytes, memoryLimitBytes, headroomPercent: Math.round(((memoryLimitBytes - peakBytes) / memoryLimitBytes) * 10000) / 100 };
}

function summarize(phase, observations, criteria) {
  const errors = observations.filter(({ error }) => error).length;
  const latencies = observations.flatMap(({ latencyMs }) => latencyMs === null ? [] : [latencyMs]).sort((a, b) => a - b);
  const memories = observations.flatMap(({ memory }) => memory === null ? [] : [memory]);
  const errorRate = observations.length === 0 ? 1 : errors / observations.length;
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const minimumHeadroom = memories.length === 0 ? null : Math.min(...memories.map(({ headroomPercent }) => headroomPercent));
  const reasons = [];
  if (observations.length < criteria.minimumSamples[phase]) reasons.push(`only ${observations.length} of ${criteria.minimumSamples[phase]} required samples ran`);
  if (errorRate > criteria.maximumErrorRate) reasons.push(`error rate ${errorRate} exceeds ${criteria.maximumErrorRate}`);
  if (p95 === null || p95 > criteria.maximumP95Ms[phase]) reasons.push(`p95 ${p95 ?? "unavailable"}ms exceeds ${criteria.maximumP95Ms[phase]}ms`);
  if (minimumHeadroom === null) reasons.push("memory headroom is unavailable");
  else if (minimumHeadroom < criteria.minimumMemoryHeadroomPercent) reasons.push(`memory headroom ${minimumHeadroom}% is below ${criteria.minimumMemoryHeadroomPercent}%`);
  return {
    phase,
    status: reasons.length === 0 ? "passed" : "failed",
    reason: reasons.length === 0 ? null : reasons.join("; "),
    samples: observations.length,
    errors,
    errorRate,
    latencyMs: { p50: round(p50), p95: round(p95), maximumP95: criteria.maximumP95Ms[phase] },
    memory: { minimumHeadroomPercent: minimumHeadroom, requiredHeadroomPercent: criteria.minimumMemoryHeadroomPercent }
  };
}

function weightedSchedule(operationMix) {
  return operationMix.flatMap((entry) => Array.from({ length: entry.weight }, () => structuredClone(entry)));
}

function validateConfiguration({ profileId, dataset, operationMix, criteria, createTransport }) {
  if (typeof profileId !== "string" || !profileId) throw new TypeError("workload profileId is required");
  if (!dataset || typeof dataset.fixtureId !== "string" || !Number.isSafeInteger(dataset.logicalResourceCount) || dataset.logicalResourceCount < 1 || !/^[0-9a-f]{64}$/u.test(dataset.manifestSha256)) throw new TypeError("workload dataset identity is invalid");
  if (!Array.isArray(operationMix) || operationMix.length < 1 || operationMix.some(({ operation, input, weight, cacheState }) => typeof operation !== "string" || !input || typeof input !== "object" || !Number.isSafeInteger(weight) || weight < 1 || !new Set(["cold", "warm", "bypass"]).has(cacheState))) throw new TypeError("workload operation mix is invalid");
  if (typeof createTransport !== "function" || !criteria || !Number.isSafeInteger(criteria.concurrency) || criteria.concurrency < 1 || !Number.isFinite(criteria.maximumErrorRate) || criteria.maximumErrorRate < 0 || criteria.maximumErrorRate > 1 || !Number.isFinite(criteria.minimumMemoryHeadroomPercent) || criteria.minimumMemoryHeadroomPercent < 20 || !Array.isArray(criteria.requiredPhases)) throw new TypeError("workload criteria are invalid");
  for (const phase of PHASES) {
    if (!Number.isSafeInteger(criteria.repetitions?.[phase]) || criteria.repetitions[phase] < 1 || !Number.isSafeInteger(criteria.minimumSamples?.[phase]) || criteria.minimumSamples[phase] < 1 || !Number.isFinite(criteria.maximumP95Ms?.[phase]) || criteria.maximumP95Ms[phase] <= 0) throw new TypeError(`workload ${phase} criteria are invalid`);
  }
  if (criteria.requiredPhases.some((phase) => !PHASES.includes(phase))) throw new TypeError("workload required phase is invalid");
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

function safeMessage(error) { return String(error?.message ?? "workload failed").replace(/https?:\/\/\S+|\/(?:Users|home|var|tmp)\/\S+/giu, "[redacted]").slice(0, 320); }
function round(value) { return value === null ? null : Math.round(value * 1000) / 1000; }
