import assert from "node:assert/strict";
import test from "node:test";
import { createDataScriptRuntimeLoader } from "./src/datascript-runtime-loader.mjs";

function environment() {
  const scripts = [];
  const globals = {};
  const document = {
    querySelector: () => ({ content: `/datascript/assets/datascript-runtime-${"a".repeat(64)}.js` }),
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { append(script) { scripts.push(script); } },
  };
  return { scripts, globals, document, load: createDataScriptRuntimeLoader({ documentImpl: document, globalImpl: globals }) };
}
const runtime = { initialize() {}, request() {}, release() {} };

test("runtime is untouched until selected and concurrent loads share one script", async () => {
  const e = environment();
  assert.equal(e.scripts.length, 0);
  const first = e.load();
  assert.equal(e.load(), first);
  assert.equal(e.scripts.length, 1);
  e.globals.EaclDataScriptRuntime = runtime;
  e.scripts[0].onload();
  assert.equal(await first, runtime);
  assert.equal(await e.load(), runtime);
  assert.equal(e.scripts.length, 1);
});

test("network failures and missing exports can be retried", async () => {
  const e = environment();
  const first = e.load();
  e.scripts[0].onerror();
  await assert.rejects(first, /downloaded/);
  const second = e.load();
  e.scripts[1].onload();
  await assert.rejects(second, /interface/);
  const third = e.load();
  e.globals.EaclDataScriptRuntime = runtime;
  e.scripts[2].onload();
  assert.equal(await third, runtime);
  assert.ok(e.scripts[0].removed && e.scripts[1].removed);
});

test("metadata cannot point outside the immutable local asset path", async () => {
  const e = environment();
  e.document.querySelector = () => ({ content: "https://example.com/runtime.js" });
  await assert.rejects(e.load(), /unavailable/);
  assert.equal(e.scripts.length, 0);
});
