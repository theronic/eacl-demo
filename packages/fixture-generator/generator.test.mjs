import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson } from "./canonical-json.mjs";
import {
  ALGORITHM_VERSION,
  CUT_POINTS,
  FIXTURE_ID,
  SEED,
  accountServerCount,
  fixtureBundles,
  generateFixtureManifest,
  sample64
} from "./generator.mjs";

const storedSmall = JSON.parse(await readFile(new URL("../../fixtures/manifests/fixture-10000.v1.json", import.meta.url), "utf8"));
const storedLarge = JSON.parse(await readFile(new URL("../../fixtures/manifests/fixture-1000000.v1.json", import.meta.url), "utf8"));

test("algorithm identity and unsigned samples are fixed", () => {
  assert.equal(FIXTURE_ID, "eacl-demo-fixture-v1");
  assert.equal(ALGORITHM_VERSION, 1);
  assert.equal(SEED, 20260813n);
  assert.deepEqual(CUT_POINTS, [10_000, 1_000_000]);
  assert.deepEqual(
    Array.from({ length: 14 }, (_, ordinal) => accountServerCount(ordinal)),
    [16, 16, 16, 16, 16, 16, 16, 16, 776, 7064, 19961, 5523, 10357, 257]
  );
  assert.equal(sample64(8, 0), 7486028538069950133n);
  assert.equal(sample64(8, 1), 13710856897193850775n);
});

test("bundles stop at exact resource cut points", () => {
  for (const cutPoint of [1, 2, 10_000]) {
    const bundles = [...fixtureBundles(cutPoint)];
    assert.equal(bundles.length, cutPoint);
    assert.equal(bundles[0].resource.id, "platform");
  }
});

test("canonical JSON sorts keys and rejects ambiguous numbers", () => {
  assert.equal(canonicalJson({ z: 1, a: { d: 2, b: 3 } }), '{"a":{"b":3,"d":2},"z":1}');
  assert.throws(() => canonicalJson({ value: -0 }), /safe non-negative/);
  assert.throws(() => canonicalJson({ value: -1 }), /safe non-negative/);
  assert.throws(() => canonicalJson({ value: 1.5 }), /safe non-negative/);
});

test("checked-in manifests reproduce and the small semantic stream is the large prefix", async () => {
  const [small, large] = await Promise.all([
    generateFixtureManifest(10_000),
    generateFixtureManifest(1_000_000)
  ]);
  assert.deepEqual(small, storedSmall);
  assert.deepEqual(large, storedLarge);
  assert.equal(small.counts.objects.resources.total, 10_000);
  assert.equal(large.counts.objects.resources.total, 1_000_000);
  assert.equal(
    small.digests.semanticRecords,
    large.prefixProofs["10000"].recordsDigest
  );
  assert.equal(
    small.counts.records.total,
    large.prefixProofs["10000"].recordCount
  );
});
