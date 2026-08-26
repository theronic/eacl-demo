import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createReadOnlyDispatcher } from "./src/read-only-dispatcher.mjs";
import { logicalOperations } from "./src/routes.mjs";

const vocabulary = JSON.parse(await readFile(new URL("./capability-vocabulary.v1.json", import.meta.url), "utf8"));
const handlers = Object.fromEntries(logicalOperations.map((operation) => [operation, async (input) => ({ operation, input })]));

test("public dispatcher contains exactly the shared read-only logical operations", async () => {
  assert.deepEqual([...logicalOperations].sort(), [...vocabulary.operations].sort());
  const dispatcher = createReadOnlyDispatcher(handlers);
  for (const operation of logicalOperations) {
    assert.deepEqual(await dispatcher.dispatch({ ok: true, operation, input: { marker: operation } }, {}), { operation, input: { marker: operation } });
  }
});

test("mutating, setup, benchmark, eviction, and administration operations cannot dispatch", async () => {
  const dispatcher = createReadOnlyDispatcher(handlers);
  for (const operation of ["schema-write", "seed", "setup", "benchmark", "transact", "arbitrary-transaction", "cache-evict", "delete-store", "admin"]) {
    assert.deepEqual(await dispatcher.dispatch({ ok: true, operation, input: {} }, {}), { ok: false, code: "route-not-found" });
  }
});

test("a handler table with a missing or extra route is rejected before serving", () => {
  const missing = { ...handlers }; delete missing.authorize;
  assert.throws(() => createReadOnlyDispatcher(missing), /exactly the closed read-only/u);
  assert.throws(() => createReadOnlyDispatcher({ ...handlers, seed: async () => {} }), /exactly the closed read-only/u);
  assert.throws(() => createReadOnlyDispatcher({ ...handlers, authorize: "not-a-function" }), /invalid public handler/u);
});
