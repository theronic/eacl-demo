import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [catalog, registry] = await Promise.all([
  readFile(new URL("./backend-storage.v1.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("./profiles.v1.json", import.meta.url), "utf8").then(JSON.parse)
]);
const expectedIds = ["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory", "jank-memory", "datascript-browser-memory"];

test("profile IDs are the exact stable closed set", () => {
  assert.deepEqual(registry.profiles.map(({ id }) => id), expectedIds);
  assert.equal(new Set(expectedIds).size, expectedIds.length);
});

test("profile mapping is a bijection over the supported backend/storage pairs", () => {
  const supported = catalog.backends.flatMap(({ id, storages }) => storages.map((storage) => `${id}/${storage}`)).sort();
  const profiled = registry.profiles.map(({ backend, storage }) => `${backend}/${storage}`).sort();
  assert.deepEqual(profiled, supported);
});

test("IDs are explicit and not assumed to equal backend plus storage", () => {
  const byPair = new Map(registry.profiles.map((profile) => [`${profile.backend}/${profile.storage}`, profile.id]));
  assert.equal(byPair.get("datascript/browser-memory"), "datascript-browser-memory");
});

test("deployed server profiles use direct Lambda Function URL origins", () => {
  const byId = new Map(registry.profiles.map((profile) => [profile.id, profile]));
  for (const id of ["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory"]) {
    assert.match(byId.get(id).apiOrigin, /^https:\/\/[a-z0-9]+\.lambda-url\.us-east-1\.on\.aws$/u);
    assert.equal(new URL(byId.get(id).apiOrigin).hostname, new URL(byId.get(id).apiOrigin).host);
  }
  for (const id of ["jank-memory", "datascript-browser-memory"]) {
    assert.equal(byId.get(id).apiOrigin, null);
  }
});
