import { createHash } from "node:crypto";
import { once } from "node:events";

import { canonicalJson } from "./canonical-json.mjs";
import { fixtureBundles, fixtureContext, fixtureHeader, validateCutPoint } from "./generator.mjs";

export const DEFAULT_DURABLE_BATCH_LIMITS = Object.freeze({
  maxResources: 250,
  maxRecords: 1_250,
  maxCanonicalBytes: 1_048_576
});

export const DEFAULT_IN_MEMORY_LIMITS = Object.freeze({
  maxResources: 10_000,
  maxRecords: 50_000,
  maxCanonicalBytes: 8_388_608
});

export function *fixtureBatches(cutPointResources, limits = DEFAULT_DURABLE_BATCH_LIMITS) {
  validateCutPoint(cutPointResources);
  const normalized = validateLimits(limits);
  let nextResourceOrdinal = 0;
  let batch = emptyBatch(nextResourceOrdinal);

  for (const bundle of fixtureBundles(cutPointResources)) {
    const bundleLines = bundle.records.map((record) => `${canonicalJson(record)}\n`);
    const bundleBytes = bundleLines.reduce((total, line) => total + Buffer.byteLength(line), 0);
    if (bundle.records.length > normalized.maxRecords || bundleBytes > normalized.maxCanonicalBytes) {
      throw new RangeError(`resource bundle ${nextResourceOrdinal} exceeds durable batch limits`);
    }
    if (batch.resourceCount > 0 && wouldExceed(batch, bundle.records.length, bundleBytes, normalized)) {
      yield finishBatch(batch);
      batch = emptyBatch(nextResourceOrdinal);
    }
    batch.resourceCount += 1;
    batch.records.push(...bundle.records);
    batch.canonicalBytes += bundleBytes;
    batch.lastResourceOrdinal = nextResourceOrdinal;
    nextResourceOrdinal += 1;
  }
  if (batch.resourceCount > 0) yield finishBatch(batch);
}

export async function seedFixtureBatches({
  cutPointResources,
  applyBatch,
  limits = DEFAULT_DURABLE_BATCH_LIMITS,
  nextResourceOrdinal = 0,
  signal,
  onProgress
}) {
  if (typeof applyBatch !== "function") throw new TypeError("applyBatch must be a function");
  validateCutPoint(cutPointResources);
  if (!Number.isSafeInteger(nextResourceOrdinal) || nextResourceOrdinal < 0 || nextResourceOrdinal > cutPointResources) {
    throw new RangeError("nextResourceOrdinal is outside the fixture cut point");
  }
  let completed = nextResourceOrdinal;
  for (const batch of fixtureBatches(cutPointResources, limits)) {
    throwIfAborted(signal);
    if (batch.lastResourceOrdinal < nextResourceOrdinal) continue;
    if (batch.firstResourceOrdinal < nextResourceOrdinal) {
      throw new Error(`resume ordinal ${nextResourceOrdinal} is not a deterministic batch boundary`);
    }
    await applyBatch(batch, { signal });
    completed = batch.lastResourceOrdinal + 1;
    onProgress?.({ completedResources: completed, totalResources: cutPointResources, batchDigest: batch.digest });
  }
  return { completedResources: completed, totalResources: cutPointResources, readyToVerify: completed === cutPointResources };
}

export function materializeBoundedFixture(cutPointResources, limits = DEFAULT_IN_MEMORY_LIMITS) {
  validateCutPoint(cutPointResources);
  const normalized = validateLimits(limits);
  if (cutPointResources > normalized.maxResources) throw new RangeError(`cut point ${cutPointResources} exceeds in-memory resource limit ${normalized.maxResources}`);
  const records = [];
  let canonicalBytes = 0;
  for (const bundle of fixtureBundles(cutPointResources)) {
    if (records.length + bundle.records.length > normalized.maxRecords) throw new RangeError("fixture exceeds in-memory record limit");
    for (const record of bundle.records) {
      const line = `${canonicalJson(record)}\n`;
      canonicalBytes += Buffer.byteLength(line);
      if (canonicalBytes > normalized.maxCanonicalBytes) throw new RangeError("fixture exceeds in-memory canonical-byte limit");
      records.push(record);
    }
  }
  return { cutPointResources, records, canonicalBytes };
}

export async function writeFixtureNdjson(cutPointResources, writable, { signal } = {}) {
  validateCutPoint(cutPointResources);
  if (!writable || typeof writable.write !== "function") throw new TypeError("writable stream is required");
  const context = await fixtureContext();
  let lines = 0;
  let bytes = 0;
  const writeLine = async (record) => {
    throwIfAborted(signal);
    const line = `${canonicalJson(record)}\n`;
    bytes += Buffer.byteLength(line);
    lines += 1;
    if (!writable.write(line)) await once(writable, "drain");
  };
  await writeLine(fixtureHeader(cutPointResources, context));
  for (const bundle of fixtureBundles(cutPointResources)) {
    for (const record of bundle.records) await writeLine(record);
  }
  return { lines, bytes };
}

function emptyBatch(firstResourceOrdinal) {
  return { firstResourceOrdinal, lastResourceOrdinal: firstResourceOrdinal - 1, resourceCount: 0, records: [], canonicalBytes: 0 };
}

function finishBatch(batch) {
  const hash = createHash("sha256");
  for (const record of batch.records) hash.update(`${canonicalJson(record)}\n`);
  return Object.freeze({
    ...batch,
    records: Object.freeze(batch.records),
    digest: `sha256:${hash.digest("hex")}`,
    idempotencyKey: `eacl-demo-fixture-v1:${batch.firstResourceOrdinal}-${batch.lastResourceOrdinal}`
  });
}

function wouldExceed(batch, additionalRecords, additionalBytes, limits) {
  return batch.resourceCount + 1 > limits.maxResources
    || batch.records.length + additionalRecords > limits.maxRecords
    || batch.canonicalBytes + additionalBytes > limits.maxCanonicalBytes;
}

function validateLimits(limits) {
  const normalized = { ...limits };
  for (const field of ["maxResources", "maxRecords", "maxCanonicalBytes"]) {
    if (!Number.isSafeInteger(normalized[field]) || normalized[field] < 1) throw new RangeError(`${field} must be a positive safe integer`);
  }
  return normalized;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Fixture operation aborted", "AbortError");
}
