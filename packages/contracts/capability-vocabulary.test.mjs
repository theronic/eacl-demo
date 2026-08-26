import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const vocabulary = JSON.parse(await readFile(new URL("./capability-vocabulary.v1.json", import.meta.url), "utf8"));
const domains = ["operations", "consistencyModes", "snapshotBehaviors", "cacheBehaviors", "mutationLocalities", "limitFields", "datasetIdentityFields", "limitations"];

test("every capability domain is non-empty, closed, and duplicate-free", () => {
  assert.deepEqual(Object.keys(vocabulary).sort(), ["$schema", "schema", ...domains].sort());
  for (const domain of domains) {
    assert.equal(vocabulary[domain].length > 0, true, domain);
    assert.equal(new Set(vocabulary[domain]).size, vocabulary[domain].length, domain);
    assert.equal(vocabulary[domain].every((term) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(term)), true, domain);
  }
});

test("the vocabulary can state each required semantic distinction", () => {
  assert.equal(vocabulary.operations.includes("authorize"), true);
  assert.equal(vocabulary.consistencyModes.includes("exact"), true);
  assert.equal(vocabulary.snapshotBehaviors.includes("fixed-environment"), true);
  assert.equal(vocabulary.cacheBehaviors.includes("browser-worker-local"), true);
  assert.equal(vocabulary.mutationLocalities.includes("private-seed-workflow"), true);
  assert.equal(vocabulary.limitFields.includes("response-bytes"), true);
  assert.equal(vocabulary.datasetIdentityFields.includes("manifest-sha256"), true);
  assert.equal(vocabulary.limitations.includes("datomic-like-not-datomic-pro"), true);
  assert.equal(vocabulary.limitations.includes("no-datalog-api"), true);
  assert.equal(vocabulary.limitations.includes("no-distribution"), true);
  assert.equal(vocabulary.limitations.includes("not-production-database"), true);
});
