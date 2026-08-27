import assert from "node:assert/strict";
import test from "node:test";

import { runRepresentativeWorkloads, UnsupportedWorkloadPhaseError } from "./src/workloads.mjs";

const dataset = { fixtureId: "canonical-v1-10000", logicalResourceCount: 10_000, manifestSha256: "a".repeat(64) };
const operationMix = [{ operation: "check-permission", input: { subjectId: "user-1" }, weight: 2, cacheState: "warm" }, { operation: "health", input: {}, weight: 1, cacheState: "bypass" }];
const criteria = {
  requiredPhases: ["cold", "warm"], concurrency: 2, maximumErrorRate: 0, minimumMemoryHeadroomPercent: 20,
  repetitions: { cold: 2, restore: 2, warm: 4 }, minimumSamples: { cold: 2, restore: 2, warm: 4 },
  maximumP95Ms: { cold: 10_000, restore: 10_000, warm: 10_000 }
};

test("workloads retain dataset, cache, concurrency, latency, error, and memory criteria", async () => {
  const report = await runRepresentativeWorkloads({
    profileId: "datalevin-memory", dataset, operationMix, criteria,
    createTransport: async ({ phase }) => {
      if (phase === "restore") throw new UnsupportedWorkloadPhaseError(phase);
      return passingTransport();
    }
  });
  assert.equal(report.result, "pass");
  assert.deepEqual(report.cacheStates, ["bypass", "warm"]);
  assert.equal(report.concurrency, 2);
  assert.equal(report.phases.find(({ phase }) => phase === "restore").status, "unsupported");
  for (const phase of report.phases.filter(({ status }) => status === "passed")) {
    assert.equal(phase.errors, 0);
    assert.equal(phase.memory.minimumHeadroomPercent, 30);
    assert.equal(typeof phase.latencyMs.p95, "number");
  }
});

test("required restore and memory below 20 percent fail qualification", async () => {
  const strict = { ...criteria, requiredPhases: ["cold", "restore", "warm"] };
  const unsupported = await runRepresentativeWorkloads({ profileId: "datalevin-memory", dataset, operationMix, criteria: strict, createTransport: async ({ phase }) => {
    if (phase === "restore") throw new UnsupportedWorkloadPhaseError(phase);
    return passingTransport();
  } });
  assert.equal(unsupported.result, "fail");

  const lowMemory = await runRepresentativeWorkloads({ profileId: "jank-memory", dataset, operationMix, criteria, createTransport: async () => passingTransport({ peakBytes: 85, memoryLimitBytes: 100 }) });
  assert.equal(lowMemory.result, "fail");
  assert.equal(lowMemory.phases.find(({ phase }) => phase === "warm").reason.includes("below 20%"), true);
});

function passingTransport(memory = { peakBytes: 70, memoryLimitBytes: 100 }) {
  return {
    async request(operation) { return { meta: { revision: "basis-1", requestId: `request-${operation}` }, data: {} }; },
    async metrics() { return memory; },
    async release() { return true; }
  };
}
