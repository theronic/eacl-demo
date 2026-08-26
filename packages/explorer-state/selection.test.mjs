import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { initialSelection, selectBackend, storageOptions } from "./src/selection.mjs";

const catalog = JSON.parse(await readFile(new URL("../contracts/backend-storage.v1.json", import.meta.url), "utf8"));

test("Datahike is the no-URL initial backend", () => {
  assert.deepEqual(initialSelection(catalog, new URLSearchParams()), { backend: "datahike", storage: "s3" });
});

test("a valid canonical backend and storage override the initial selection", () => {
  assert.deepEqual(initialSelection(catalog, new URLSearchParams("backend=datomic&storage=dynamodb")), { backend: "datomic", storage: "dynamodb" });
  assert.deepEqual(initialSelection(catalog, new URLSearchParams("backend=datahike&storage=dynamodb")), { backend: "datahike", storage: "dynamodb" });
});

test("unknown and incompatible values fall back within the closed relation", () => {
  assert.deepEqual(initialSelection(catalog, new URLSearchParams("backend=nope&storage=memory")), { backend: "datahike", storage: "s3" });
  assert.deepEqual(initialSelection(catalog, new URLSearchParams("backend=datomic&storage=s3")), { backend: "datomic", storage: "dynamodb" });
});

test("backend changes preserve storage only when the new backend supports it", () => {
  assert.deepEqual(selectBackend(catalog, { backend: "datahike", storage: "dynamodb" }, "datomic"), { backend: "datomic", storage: "dynamodb" });
  assert.deepEqual(selectBackend(catalog, { backend: "datahike", storage: "s3" }, "jank"), { backend: "jank", storage: "memory" });
  assert.deepEqual(storageOptions(catalog, "datahike").map(({ id }) => id), ["s3", "dynamodb"]);
});

test("a qualified registry default overrides a merely compatible prior storage", () => {
  assert.deepEqual(selectBackend(catalog, { backend: "datomic", storage: "dynamodb" }, "datahike", "s3"), { backend: "datahike", storage: "s3" });
  assert.deepEqual(selectBackend(catalog, { backend: "datomic", storage: "dynamodb" }, "datahike", "unknown"), { backend: "datahike", storage: "dynamodb" });
});
