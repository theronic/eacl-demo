import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { validateHttpRequest } from "../contracts/src/http-boundary.mjs";

const workload = await readJson("../../benchmarks/datahike-storage/workload.v1.json");
const schema = await readJson("../../schemas/storage-benchmark-workload.v1.schema.json");
const largeManifest = await readJson("../../fixtures/manifests/fixture-1000000.v1.json");
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);

test("benchmark workload validates and binds the canonical million-resource fixture", () => {
  assert.equal(validate(workload), true, JSON.stringify(validate.errors));
  assert.equal(workload.comparison.backend, "datahike");
  assert.deepEqual(workload.comparison.storages, ["s3", "dynamodb"]);
  assert.equal(workload.comparison.region, "us-east-1");
  assert.equal(workload.comparison.logicalResources, 1_000_000);
  assert.equal(workload.comparison.fixtureDigest, largeManifest.digests.fixture);
  assert.equal(workload.runtime.lambdaRuntime, "java25");
  assert.equal(workload.runtime.architecture, "arm64");
  assert.equal(workload.runtime.snapStart, "PublishedVersions");
  assert.equal(workload.runtime.memorySelection, "maximum-of-the-two-lowest-qualified-memory-values");
});

test("weights are exact and every request passes the closed HTTP boundary", () => {
  assert.equal(workload.schedule.operations.reduce((total, entry) => total + entry.weightPer100, 0), 100);
  assert.equal(new Set(workload.schedule.operations.map(({ id }) => id)).size, workload.schedule.operations.length);
  for (const profile of ["datahike-s3", "datahike-dynamodb"]) {
    for (const entry of workload.schedule.operations) {
      const request = {
        path: `/${entry.operation}`,
        method: entry.method,
        query: "",
        body: entry.method === "GET" ? null : JSON.stringify(entry.input),
        contentType: entry.method === "GET" ? null : "application/json",
        requestId: "benchmark-contract-check"
      };
      assert.equal(validateHttpRequest(request).ok, true, `${profile}/${entry.id}`);
    }
  }
});

test("wave order is deterministic, complete, and changes between waves", () => {
  const first = expandWave(0);
  const repeated = expandWave(0);
  const second = expandWave(1);
  assert.deepEqual(first, repeated);
  assert.equal(first.length, 100);
  assert.notDeepEqual(first, second);
  const actual = new Map();
  for (const id of first) actual.set(id, (actual.get(id) ?? 0) + 1);
  assert.deepEqual(actual, new Map(workload.schedule.operations.map(({ id, weightPer100 }) => [id, weightPer100])));
});

test("cache, concurrency, repetition, uncertainty, and no-claim gates are explicit", () => {
  assert.deepEqual(workload.lanes.map(({ id }) => id), ["warm-cache-disabled", "warm-cache-enabled", "cold-restore-first-result"]);
  assert.deepEqual(workload.lanes[0].concurrency, [1, 8]);
  assert.equal(workload.lanes[0].measuredWaves, 30);
  assert.equal(workload.analysis.minimumEffectPercent, 5);
  assert.match(workload.analysis.confidence, /10000 deterministic resamples/);
  assert.match(workload.analysis.noClaimRule, /publish no fastest claim/);
});

function expandWave(wave) {
  const copies = workload.schedule.operations.flatMap(({ id, weightPer100 }) =>
    Array.from({ length: weightPer100 }, (_, copy) => ({ id, copy }))
  );
  return copies.sort((left, right) => {
    const leftHash = orderHash(wave, left);
    const rightHash = orderHash(wave, right);
    return leftHash.localeCompare(rightHash) || left.id.localeCompare(right.id) || left.copy - right.copy;
  }).map(({ id }) => id);
}

function orderHash(wave, entry) {
  return createHash("sha256").update(`${workload.schedule.seed}\0${wave}\0${entry.id}\0${entry.copy}`).digest("hex");
}

async function readJson(relative) {
  return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
}
