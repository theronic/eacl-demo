import assert from "node:assert/strict";
import test from "node:test";

import { createDataScriptWorkerTransport } from "./src/worker-transport.mjs";

const expectedIdentity = {
  profileId: "datascript-browser-memory",
  demoSha: "a".repeat(40),
  eaclSha: "b".repeat(40),
  artifactSha256: "c".repeat(64),
  deploymentId: "datascript:deployment-1",
  dataManifestSha256: "d".repeat(64)
};

test("requests carry deterministic IDs and the current client epoch", async () => {
  const worker = fakeWorker();
  const transport = createDataScriptWorkerTransport({ worker, expectedIdentity, validateEvent: identity });
  await initialize(worker, transport);
  const result = transport.request("bootstrap", {});
  assert.deepEqual(worker.sent[1], {
    type: "request", contractVersion: "explorer.v1", profileId: "datascript-browser-memory",
    requestId: "datascript-1-2", clientEpoch: 1, operation: "bootstrap", input: {}
  });
  worker.emit(response(worker.sent[1], { ready: true }));
  assert.equal((await result).data.ready, true);
  assert.equal(transport.pendingCount, 0);
});

test("reset rejects old work and suppresses late replies from its epoch", async () => {
  const worker = fakeWorker();
  const transport = createDataScriptWorkerTransport({ worker, expectedIdentity, validateEvent: identity });
  await initialize(worker, transport);
  const old = transport.request("bootstrap", {});
  const reset = transport.reset();
  await assert.rejects(old, (error) => error.code === "canceled");
  assert.equal(transport.clientEpoch, 2);
  assert.equal(worker.sent[2].type, "reset");
  worker.emit(response(worker.sent[1], { stale: true }));
  assert.equal(transport.pendingCount, 1);
  worker.emit(response(worker.sent[2], { fresh: true }, "bootstrap"));
  assert.equal((await reset).data.fresh, true);
});

test("AbortSignal posts a scoped cancel and cleanup is exact-once", async () => {
  const worker = fakeWorker();
  const transport = createDataScriptWorkerTransport({ worker, expectedIdentity, validateEvent: identity });
  await initialize(worker, transport);
  const controller = new AbortController();
  const pending = transport.request("bootstrap", {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError" && error.code === "canceled");
  assert.deepEqual(worker.sent[2], {
    type: "cancel", contractVersion: "explorer.v1", profileId: "datascript-browser-memory",
    requestId: "datascript-1-2", clientEpoch: 1
  });
  assert.equal(transport.close(), true);
  assert.equal(transport.close(), false);
  assert.equal(worker.terminations, 1);
  assert.equal(worker.listenerCount(), 0);
});

test("progress is bounded to active IDs and malformed addressable events reject safely", async () => {
  const worker = fakeWorker();
  const progress = [];
  const transport = createDataScriptWorkerTransport({
    worker,
    expectedIdentity,
    onProgress: (event) => progress.push(event.completed),
    validateEvent(value) {
      if (value.invalid) throw Object.assign(new Error("worker event validation failed"), { code: "validation-error" });
      return value;
    }
  });
  await initialize(worker, transport);
  const pending = transport.request("bootstrap", {});
  worker.emit({ ...base(worker.sent[1]), type: "progress", phase: "fixture-seed", completed: 64, total: 10000, message: "Seeding." });
  worker.emit({ ...base(worker.sent[1]), type: "progress", requestId: "unknown", phase: "fixture-seed", completed: 128, total: 10000, message: "Ignored." });
  assert.deepEqual(progress, [64]);
  worker.emit({ ...base(worker.sent[1]), invalid: true });
  await assert.rejects(pending, (error) => error.code === "validation-error");
});

test("operations are blocked before initialization and responses stay request-correlated", async () => {
  const worker = fakeWorker();
  const transport = createDataScriptWorkerTransport({ worker, expectedIdentity, validateEvent: identity });
  assert.throws(() => transport.request("health", {}), (error) => error.code === "identity-mismatch");
  await initialize(worker, transport);
  const pending = transport.request("health", {});
  worker.emit({ ...response(worker.sent[1], { ready: true }), response: { data: { ready: true }, meta: { revision: "worker:1", requestId: "wrong" } } });
  await assert.rejects(pending, (error) => error.code === "identity-mismatch");
});

function fakeWorker() {
  const listeners = new Set();
  return {
    sent: [], terminations: 0,
    postMessage(value) { this.sent.push(value); },
    terminate() { this.terminations += 1; },
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); },
    emit(data) { for (const listener of listeners) listener({ data }); },
    listenerCount() { return listeners.size; }
  };
}

function response(request, data) {
  return {
    ...base(request), type: "response",
    response: { data, meta: { revision: "worker:1", requestId: request.requestId } }
  };
}

function base(request) {
  return { contractVersion: "explorer.v1", profileId: "datascript-browser-memory", requestId: request.requestId, clientEpoch: request.clientEpoch };
}

function identity(value) { return value; }

async function initialize(worker, transport) {
  const pending = transport.initialize();
  const request = worker.sent.at(-1);
  assert.equal(request.type, "initialize");
  assert.deepEqual(request.identity, expectedIdentity);
  worker.emit({ ...base(request), type: "initialized", identity: expectedIdentity });
  await pending;
  assert.equal(transport.initialized, true);
}
