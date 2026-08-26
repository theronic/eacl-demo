import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = JSON.parse(await readFile(new URL("./backend-storage.v1.json", import.meta.url), "utf8"));
const expected = new Map([
  ["datahike", ["s3", "dynamodb"]],
  ["datomic", ["dynamodb"]],
  ["datalevin", ["memory"]],
  ["jank", ["memory"]],
  ["datascript", ["browser-memory"]]
]);

test("backend and storage sets are closed and ordered", () => {
  assert.deepEqual(new Map(catalog.backends.map(({ id, storages }) => [id, storages])), expected);
  assert.deepEqual(catalog.storages.map(({ id }) => id), ["s3", "dynamodb", "memory", "browser-memory"]);
  assert.equal(catalog.defaultBackend, "datahike");
});

test("every supported storage is declared and no backend has duplicates", () => {
  const declared = new Set(catalog.storages.map(({ id }) => id));
  for (const backend of catalog.backends) {
    assert.equal(new Set(backend.storages).size, backend.storages.length);
    assert.equal(backend.storages.every((storage) => declared.has(storage)), true);
  }
});
