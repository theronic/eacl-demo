import assert from "node:assert/strict";
import test from "node:test";

import { createAsyncFocusManager } from "./src/focus-management.mjs";

test("only the current request and epoch may move focus", () => {
  const focused = [];
  const elements = new Map([
    ["object-heading", element("object-heading", focused)],
    ["fallback-heading", element("fallback-heading", focused)]
  ]);
  const queued = [];
  const manager = createAsyncFocusManager({ document: { getElementById: (id) => elements.get(id) ?? null }, enqueue: (callback) => queued.push(callback) });
  manager.reset(4);
  assert.equal(manager.expect("object", { epoch: 4, requestId: "4-1", targetId: "object-heading" }), true);
  assert.equal(manager.settle("object", { epoch: 4, requestId: "old", fallbackId: "fallback-heading" }), false);
  assert.equal(manager.settle("object", { epoch: 4, requestId: "4-1", fallbackId: "fallback-heading" }), true);
  manager.reset(5);
  queued.shift()();
  assert.deepEqual(focused, []);
});

test("a durable fallback receives focus when the preferred result target disappeared", () => {
  const focused = [];
  const fallback = element("panel-heading", focused);
  const manager = createAsyncFocusManager({ document: { getElementById: (id) => id === "panel-heading" ? fallback : null }, enqueue: (callback) => callback() });
  manager.reset(2);
  manager.expect("schema", { epoch: 2, requestId: "2-1", targetId: "schema-result" });
  assert.equal(manager.settle("schema", { epoch: 2, requestId: "2-1", fallbackId: "panel-heading" }), true);
  assert.deepEqual(focused, ["panel-heading"]);
});

function element(id, focused) { return { isConnected: true, disabled: false, focus: () => focused.push(id) }; }
