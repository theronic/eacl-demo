import assert from "node:assert/strict";
import test from "node:test";
import { BoundaryError, createExecutionBoundary } from "./src/execution-boundary.mjs";

test("admission rejects excess work without invoking its handler", async () => {
  const gate = deferred();
  const boundary = createExecutionBoundary({ maximumConcurrency: 1, deadlineMs: 1000 });
  const first = boundary.execute(async () => gate.promise, {});
  await Promise.resolve();
  let invoked = false;
  await assert.rejects(boundary.execute(async () => { invoked = true; }, {}), (error) => error instanceof BoundaryError && error.code === "overloaded");
  assert.equal(invoked, false);
  assert.equal(boundary.activeCount(), 1);
  gate.resolve({ ok: true });
  await first;
  assert.equal(boundary.activeCount(), 0);
});

test("parent cancellation propagates and cleanup runs once in reverse order", async () => {
  const boundary = createExecutionBoundary({ deadlineMs: 1000 });
  const parent = new AbortController();
  const cleaned = [];
  const execution = boundary.execute(async (_request, { signal, onCleanup }) => {
    onCleanup(async () => cleaned.push("first"));
    onCleanup(async () => cleaned.push("second"));
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    return {};
  }, {}, parent.signal);
  await Promise.resolve();
  parent.abort();
  await assert.rejects(execution, (error) => error.code === "cancelled");
  assert.deepEqual(cleaned, ["second", "first"]);
  assert.equal(boundary.activeCount(), 0);
});

test("deadline wins even when a handler ignores cancellation", async () => {
  const boundary = createExecutionBoundary({ deadlineMs: 5 });
  await assert.rejects(boundary.execute(async () => new Promise(() => {}), {}), (error) => error.code === "deadline-exceeded");
  assert.equal(boundary.activeCount(), 0);
});

test("response byte limits and serialization failures are classified", async () => {
  const boundary = createExecutionBoundary({ maximumResponseBytes: 32 });
  await assert.rejects(boundary.execute(async () => ({ payload: "a".repeat(64) }), {}), (error) => error.code === "response-too-large");
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(boundary.execute(async () => cyclic, {}), (error) => error.code === "internal-error");
});

test("cleanup also runs on handler error and response overflow", async () => {
  const events = [];
  const boundary = createExecutionBoundary({ maximumResponseBytes: 8 });
  await assert.rejects(boundary.execute(async (_request, { onCleanup }) => { onCleanup(() => events.push("handler-error")); throw new Error("backend"); }, {}), /backend/u);
  await assert.rejects(boundary.execute(async (_request, { onCleanup }) => { onCleanup(() => events.push("overflow")); return { too: "large" }; }, {}), (error) => error.code === "response-too-large");
  assert.deepEqual(events, ["handler-error", "overflow"]);
});

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
