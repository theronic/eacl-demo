import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import test from "node:test";

import { canonicalJson } from "./canonical-json.mjs";
import {
  fixtureBatches,
  materializeBoundedFixture,
  seedFixtureBatches,
  writeFixtureNdjson
} from "./batching.mjs";
import { fixtureBundles, generateFixtureManifest } from "./generator.mjs";

test("durable batches are bounded, atomic, deterministic, and complete", () => {
  const limits = { maxResources: 17, maxRecords: 80, maxCanonicalBytes: 12_000 };
  const batches = [...fixtureBatches(10_000, limits)];
  assert.equal(batches[0].firstResourceOrdinal, 0);
  assert.equal(batches.at(-1).lastResourceOrdinal, 9_999);
  assert.equal(batches.reduce((total, batch) => total + batch.resourceCount, 0), 10_000);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    assert.equal(batch.resourceCount <= limits.maxResources, true);
    assert.equal(batch.records.length <= limits.maxRecords, true);
    assert.equal(batch.canonicalBytes <= limits.maxCanonicalBytes, true);
    if (index > 0) assert.equal(batch.firstResourceOrdinal, batches[index - 1].lastResourceOrdinal + 1);
    const digest = createHash("sha256");
    for (const record of batch.records) digest.update(`${canonicalJson(record)}\n`);
    assert.equal(batch.digest, `sha256:${digest.digest("hex")}`);
  }
});

test("resumable durable seed checkpoints only at committed batch boundaries", async () => {
  const limits = { maxResources: 100, maxRecords: 500, maxCanonicalBytes: 100_000 };
  const committed = [];
  const firstBatches = [...fixtureBatches(10_000, limits)].slice(0, 2);
  const checkpoint = firstBatches.at(-1).lastResourceOrdinal + 1;
  const result = await seedFixtureBatches({
    cutPointResources: 10_000,
    limits,
    nextResourceOrdinal: checkpoint,
    async applyBatch(batch) { committed.push(batch.idempotencyKey); }
  });
  assert.equal(result.readyToVerify, true);
  assert.equal(result.completedResources, 10_000);
  assert.equal(committed[0], [...fixtureBatches(10_000, limits)][2].idempotencyKey);
  await assert.rejects(
    seedFixtureBatches({ cutPointResources: 10_000, limits, nextResourceOrdinal: checkpoint + 1, async applyBatch() {} }),
    /not a deterministic batch boundary/
  );
});

test("durable seeding honors cancellation before the next write", async () => {
  const controller = new AbortController();
  let writes = 0;
  await assert.rejects(
    seedFixtureBatches({
      cutPointResources: 10_000,
      applyBatch() { writes += 1; controller.abort(new Error("cancelled")); },
      signal: controller.signal
    }),
    /cancelled/
  );
  assert.equal(writes, 1);
});

test("browser and in-memory materialization is bounded at the small cut point", () => {
  const small = materializeBoundedFixture(10_000);
  assert.equal(small.records.length, 48_693);
  assert.equal(small.canonicalBytes, 6_753_401);
  assert.throws(() => materializeBoundedFixture(1_000_000), /exceeds in-memory resource limit/);
});

test("stream writer handles backpressure and reproduces fixture digest", async () => {
  const hash = createHash("sha256");
  const sink = new Writable({
    highWaterMark: 32,
    write(chunk, _encoding, callback) {
      hash.update(chunk);
      queueMicrotask(callback);
    }
  });
  const written = await writeFixtureNdjson(10_000, sink);
  await new Promise((resolve, reject) => sink.end(resolve).on("error", reject));
  const manifest = await generateFixtureManifest(10_000);
  assert.equal(written.lines, manifest.counts.records.total + 1);
  assert.equal(`sha256:${hash.digest("hex")}`, manifest.digests.fixture);
});

test("each semantic relationship still follows introduction of both objects", () => {
  const objects = new Set();
  for (const bundle of fixtureBundles(10_000)) {
    for (const record of bundle.records) {
      if (record.kind === "object") objects.add(`${record.object.type}:${record.object.id}`);
      else {
        assert.equal(objects.has(`${record.subject.type}:${record.subject.id}`), true);
        assert.equal(objects.has(`${record.resource.type}:${record.resource.id}`), true);
      }
    }
  }
});
