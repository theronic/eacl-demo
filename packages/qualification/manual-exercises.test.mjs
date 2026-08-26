import assert from "node:assert/strict";
import test from "node:test";

import { manualRuntimeExerciseEvidenceId, runHttpRuntimeExercise, runLambdaMemoryExercise, validateManualRuntimeExercise } from "./src/manual-exercises.mjs";

const identity = { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deployment-7", dataManifestSha256: "d".repeat(64) };
const target = { kind: "staged-cloudfront", origin: "https://staging.demo.eacl.dev", path: "/api/v1/datahike-s3", profileId: "datahike-s3" };
const memoryTarget = { kind: "lambda-version", functionArn: "arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datahike-s3", qualifier: "7", profileId: "datahike-s3" };
const allowedDemand = { subject: { type: "user", id: "user-1" }, resource: { type: "account", id: "account-0" }, permission: "admin" };
const deniedDemand = { subject: { type: "user", id: "user-2" }, resource: { type: "account", id: "account-0" }, permission: "admin" };

test("bounded staged load binds identity, scope, latency, error rate, and recovery", async () => {
  let released = 0;
  const report = await runHttpRuntimeExercise({
    kind: "load", target, expectedIdentity: identity, allowedDemand, deniedDemand,
    requestCount: 20, concurrency: 4, requestTimeoutMs: 1000, maximumP95Ms: 1000, maximumErrorRate: 0,
    clock: clock(),
    transport: {
      request: async (operation, input) => response(operation, operation === "health"
        ? { ready: true, status: "ready", identity }
        : operation === "bootstrap" ? { identity }
          : { ...input, allowed: input.subjectId === "user-1" }),
      release: async () => { released += 1; }
    }
  });
  assert.equal(validateManualRuntimeExercise(report), report);
  assert.equal(report.result, "pass");
  assert.equal(report.cases.length, 7);
  assert.deepEqual(report.load, { requestCount: 20, attemptedCount: 20, concurrency: 4, failedCount: 0, errorRate: 0, latencyMs: { p50: report.load.latencyMs.p50, p95: report.load.latencyMs.p95, maximumP95: 1000 } });
  assert.equal(released, 1);
});

test("closed transport-fault campaign requires exact errors and recovers", async () => {
  const expected = new Map([
    ["invalid-json", [400, "validation-error"]], ["oversized-body", [413, "request-too-large"]],
    ["unsupported-media-type", [415, "unsupported-media-type"]], ["wrong-method", [405, "method-not-allowed"]],
    ["mutation-route", [404, "route-not-found"]]
  ]);
  const report = await runHttpRuntimeExercise({
    kind: "fault", target, expectedIdentity: identity, allowedDemand, deniedDemand,
    requestCount: 0, concurrency: 1, requestTimeoutMs: 1000, maximumP95Ms: 0, maximumErrorRate: 0,
    clock: clock(),
    transport: {
      request: async (operation) => response(operation, operation === "health" ? { ready: true, status: "ready", identity } : { identity }),
      probeFault: async (kind) => kind === "client-cancel" ? { kind, aborted: true } : { kind, aborted: false, status: expected.get(kind)[0], envelope: { ok: false, error: { code: expected.get(kind)[1] } } },
      release: async () => true
    }
  });
  assert.equal(validateManualRuntimeExercise(report), report);
  assert.deepEqual(report.cases.filter(({ id }) => id.startsWith("fault-")).map(({ status }) => status), Array(6).fill("passed"));
});

test("immutable Lambda REPORT samples enforce exact artifact and memory headroom", async () => {
  const configuration = { functionName: "eacl-demo-datahike-s3", functionArn: "arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datahike-s3", qualifier: "7", version: "7", state: "Active", lastUpdateStatus: "Successful", codeSha256: identity.artifactSha256, runtime: "java25", architecture: "arm64", snapStart: "disabled", memorySizeMiB: 512, project: "eacl-demo", profileId: identity.profileId };
  const report = await runLambdaMemoryExercise({
    target: memoryTarget, expectedIdentity: identity, functionConfiguration: configuration, allowedDemand, deniedDemand,
    samples: 5, minimumHeadroomPercent: 20, maximumInitializationMs: 5000, maximumRestoreMs: 5000, maximumDurationMs: 5000,
    clock: clock(),
    invoke: async ({ operation, input, sample }) => ({
      envelope: response(operation, operation === "health" ? { ready: true, status: "ready", identity } : { ...input, allowed: input.subjectId === "user-1" }),
      memorySizeMiB: 512, maxMemoryUsedMiB: 300 + sample, durationMs: 25 + sample, billedDurationMs: 26 + sample, initDurationMs: sample === 0 ? 500 : null, restoreDurationMs: null
    })
  });
  assert.equal(validateManualRuntimeExercise(report), report);
  assert.equal(report.memory.headroomPercent, 40.625);
  assert.equal(report.memory.maxMemoryUsedMiB, 304);

  for (const changed of [
    { codeSha256: "e".repeat(64) },
    { runtime: "provided.al2023" },
    { architecture: "x86_64" }
  ]) {
    await assert.rejects(() => runLambdaMemoryExercise({
      target: memoryTarget, expectedIdentity: identity, functionConfiguration: { ...configuration, ...changed }, allowedDemand, deniedDemand,
      samples: 5, minimumHeadroomPercent: 20, maximumInitializationMs: 5000, maximumRestoreMs: 5000, maximumDurationMs: 5000,
      invoke: async () => { throw new Error("must not invoke"); }
    }), /immutable artifact, profile, and platform/u);
  }
});

test("failed and tampered exercise evidence cannot pass validation", async () => {
  const configuration = { functionName: "eacl-demo-datahike-s3", functionArn: "arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datahike-s3", qualifier: "7", version: "7", state: "Active", lastUpdateStatus: "Successful", codeSha256: identity.artifactSha256, runtime: "java25", architecture: "arm64", snapStart: "disabled", memorySizeMiB: 512, project: "eacl-demo", profileId: identity.profileId };
  const failed = await runLambdaMemoryExercise({
    target: memoryTarget, expectedIdentity: identity, functionConfiguration: configuration, allowedDemand, deniedDemand,
    samples: 5, minimumHeadroomPercent: 20, maximumInitializationMs: 5000, maximumRestoreMs: 5000, maximumDurationMs: 5000,
    clock: clock(),
    invoke: async ({ operation, input, sample }) => ({ envelope: response(operation, operation === "health" ? { ready: true, status: "ready", identity } : { ...input, allowed: input.subjectId === "user-1" }), memorySizeMiB: 512, maxMemoryUsedMiB: 500, durationMs: 25, billedDurationMs: 26, initDurationMs: sample === 0 ? 500 : null, restoreDurationMs: null })
  });
  assert.equal(failed.result, "fail");
  assert.throws(() => validateManualRuntimeExercise(failed), /did not pass/u);
  const tampered = structuredClone(failed);
  tampered.memory.headroomPercent = 50;
  assert.throws(() => validateManualRuntimeExercise(tampered, { requirePassing: false }), /content-addressed/u);
});

test("rehashed reports still reject omitted cases, outcome-label drift, and cross-profile paths", async () => {
  const load = await runHttpRuntimeExercise({
    kind: "load", target, expectedIdentity: identity, allowedDemand, deniedDemand,
    requestCount: 20, concurrency: 2, requestTimeoutMs: 1000, maximumP95Ms: 1000, maximumErrorRate: 0,
    clock: clock(), transport: {
      request: async (operation, input) => response(operation, operation === "health" ? { ready: true, status: "ready", identity } : operation === "bootstrap" ? { identity } : { ...input, allowed: input.subjectId === "user-1" }),
      release: async () => true
    }
  });
  const mislabeled = structuredClone(load);
  mislabeled.load.failedCount = 1;
  mislabeled.load.attemptedCount = 20;
  mislabeled.load.errorRate = 0.05;
  mislabeled.evidenceId = manualRuntimeExerciseEvidenceId(mislabeled);
  assert.throws(() => validateManualRuntimeExercise(mislabeled, { requirePassing: false }), /outcomes/u);

  const omitted = structuredClone(load);
  omitted.cases.splice(2, 1);
  omitted.counts.passed -= 1;
  omitted.evidenceId = manualRuntimeExerciseEvidenceId(omitted);
  assert.throws(() => validateManualRuntimeExercise(omitted, { requirePassing: false }), /closed ordered set/u);

  const crossProfile = structuredClone(load);
  crossProfile.target.path = "/api/v1/datomic-dynamodb";
  crossProfile.evidenceId = manualRuntimeExerciseEvidenceId(crossProfile);
  assert.throws(() => validateManualRuntimeExercise(crossProfile, { requirePassing: false }), /target is invalid/u);
});

test("zero-error load and exact-version memory stop after the first decisive failure", async () => {
  let loadInvocations = 0;
  const load = await runHttpRuntimeExercise({
    kind: "load", target, expectedIdentity: identity, allowedDemand, deniedDemand,
    requestCount: 100, concurrency: 4, requestTimeoutMs: 1000, maximumP95Ms: 1000, maximumErrorRate: 0,
    clock: clock(), transport: {
      request: async (operation) => {
        if (operation === "health") return response(operation, { ready: true, status: "ready", identity });
        if (operation === "bootstrap") return response(operation, { identity });
        loadInvocations += 1;
        throw new Error("authorization=credential must be redacted");
      },
      release: async () => true
    }
  });
  assert.equal(load.result, "fail");
  assert.ok(loadInvocations <= 4);
  assert.ok(load.load.attemptedCount <= 4);
  assert.equal(validateManualRuntimeExercise(load, { requirePassing: false }), load);
  assert.equal(JSON.stringify(load).includes("credential"), false);

  const configuration = { functionName: "eacl-demo-datahike-s3-generation", functionArn: "arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datahike-s3-generation", qualifier: "7", version: "7", state: "Active", lastUpdateStatus: "Successful", codeSha256: identity.artifactSha256, runtime: "java25", architecture: "arm64", snapStart: "disabled", memorySizeMiB: 512, project: "eacl-demo", profileId: identity.profileId };
  const directTarget = { ...memoryTarget, functionArn: configuration.functionArn };
  let memoryInvocations = 0;
  const memory = await runLambdaMemoryExercise({
    target: directTarget, expectedIdentity: identity, functionConfiguration: configuration, allowedDemand, deniedDemand,
    samples: 50, minimumHeadroomPercent: 20, maximumInitializationMs: 5000, maximumRestoreMs: 5000, maximumDurationMs: 5000,
    clock: clock(), invoke: async () => { memoryInvocations += 1; throw new Error("first invocation failed"); }
  });
  assert.equal(memoryInvocations, 1);
  assert.equal(memory.result, "fail");
  assert.deepEqual(memory.cases.map(({ id }) => id), ["memory-sample-1", "memory-headroom"]);
  assert.equal(validateManualRuntimeExercise(memory, { requirePassing: false }), memory);
});

test("memory evidence requires the lifecycle matching the bound SnapStart state", async () => {
  const datalevinIdentity = { ...identity, profileId: "datalevin-memory" };
  const configuration = { functionName: "eacl-demo-datalevin-memory-generation", functionArn: "arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datalevin-memory-generation", qualifier: "9", version: "9", state: "Active", lastUpdateStatus: "Successful", codeSha256: identity.artifactSha256, runtime: "java25", architecture: "arm64", snapStart: "enabled", memorySizeMiB: 1024, project: "eacl-demo", profileId: datalevinIdentity.profileId };
  const directTarget = { kind: "lambda-version", functionArn: configuration.functionArn, qualifier: "9", profileId: datalevinIdentity.profileId };
  const restored = await runLambdaMemoryExercise({
    target: directTarget, expectedIdentity: datalevinIdentity, functionConfiguration: configuration, allowedDemand, deniedDemand,
    samples: 5, minimumHeadroomPercent: 20, maximumInitializationMs: 5000, maximumRestoreMs: 5000, maximumDurationMs: 5000,
    clock: clock(), invoke: async ({ operation, input, sample }) => ({ envelope: responseWithIdentity(operation, operation === "health" ? { ready: true, status: "ready", identity: datalevinIdentity } : { ...input, allowed: input.subjectId === "user-1" }, datalevinIdentity), memorySizeMiB: 1024, maxMemoryUsedMiB: 500, durationMs: 25, billedDurationMs: 26, initDurationMs: null, restoreDurationMs: sample === 0 ? 250 : null })
  });
  assert.equal(restored.result, "pass");
  assert.equal(restored.memory.maximumRestoreMs, 250);
  assert.equal(restored.memory.maximumInitializationMs, null);

  const warmOnlyConfiguration = { ...configuration, profileId: identity.profileId, functionName: "eacl-demo-datahike-s3-warm", functionArn: "arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datahike-s3-warm", snapStart: "disabled", qualifier: "7", version: "7" };
  const warmOnly = await runLambdaMemoryExercise({
    target: { kind: "lambda-version", functionArn: warmOnlyConfiguration.functionArn, qualifier: "7", profileId: identity.profileId }, expectedIdentity: identity, functionConfiguration: warmOnlyConfiguration, allowedDemand, deniedDemand,
    samples: 5, minimumHeadroomPercent: 20, maximumInitializationMs: 5000, maximumRestoreMs: 5000, maximumDurationMs: 5000,
    clock: clock(), invoke: async ({ operation, input }) => ({ envelope: response(operation, operation === "health" ? { ready: true, status: "ready", identity } : { ...input, allowed: input.subjectId === "user-1" }), memorySizeMiB: 1024, maxMemoryUsedMiB: 500, durationMs: 25, billedDurationMs: 26, initDurationMs: null, restoreDurationMs: null })
  });
  assert.equal(warmOnly.result, "fail");
  assert.match(warmOnly.memory.reason, /no cold initialization sample/u);
});

function response(operation, data) { return { ok: true, meta: { operation, requestId: `request-${operation}`, identity }, data }; }
function responseWithIdentity(operation, data, responseIdentity) { return { ok: true, meta: { operation, requestId: `request-${operation}`, identity: responseIdentity }, data }; }
function clock() { const values = ["2026-08-26T10:00:00Z", "2026-08-26T10:01:00Z"]; return () => values.shift() ?? values.at(-1); }
