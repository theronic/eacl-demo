import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

import { fixtureBatches } from "../packages/fixture-generator/batching.mjs";
import { canonicalJson } from "../packages/fixture-generator/canonical-json.mjs";
import { fixtureContext, fixtureHeader } from "../packages/fixture-generator/generator.mjs";

if (process.argv.length !== 4 || process.argv[2] !== "--cut-point") {
  throw new Error("usage: node scripts/stream-fixture-batches.mjs --cut-point 10000|1000000");
}
const cutPoint = Number(process.argv[3]);
if (![10_000, 1_000_000].includes(cutPoint)) throw new Error("unsupported fixture cut point");

const manifest = JSON.parse(await readFile(
  new URL(`../fixtures/manifests/fixture-${cutPoint}.v1.json`, import.meta.url),
  "utf8"
));
const context = await fixtureContext();
assertEqual(manifest.algorithm.generatorDigest, context.generatorDigest, "generator digest");
assertEqual(manifest.schema.digest, context.schemaDigest, "schema digest");
assertEqual(manifest.exemplars.digest, context.exemplarDigest, "exemplar digest");
assertEqual(manifest.cutPoint.logicalResources, cutPoint, "cut point");

const manifestWithoutSelfDigest = structuredClone(manifest);
delete manifestWithoutSelfDigest.digests.manifest;
assertEqual(
  manifest.digests.manifest,
  hash(`${canonicalJson(manifestWithoutSelfDigest)}\n`),
  "manifest self digest"
);

// Complete this preflight before writing the first byte. A changed generator,
// fixture, record order, or checked-in manifest therefore cannot partially
// seed the new blue/green generation.
const fixtureHash = createHash("sha256");
const semanticHash = createHash("sha256");
fixtureHash.update(`${canonicalJson(fixtureHeader(cutPoint, context))}\n`);
let preflightRecords = 0;
let preflightBatches = 0;
for (const batch of fixtureBatches(cutPoint)) {
  preflightBatches += 1;
  for (const record of batch.records) {
    const line = `${canonicalJson(record)}\n`;
    fixtureHash.update(line);
    semanticHash.update(line);
    preflightRecords += 1;
  }
}
assertEqual(preflightRecords, manifest.counts.records.total, "record count");
assertEqual(`sha256:${fixtureHash.digest("hex")}`, manifest.digests.fixture, "fixture digest");
assertEqual(`sha256:${semanticHash.digest("hex")}`, manifest.digests.semanticRecords, "semantic digest");

let batches = 0;
for (const batch of fixtureBatches(cutPoint)) {
  const line = `${JSON.stringify(batch)}\n`;
  if (!process.stdout.write(line)) await once(process.stdout, "drain");
  batches += 1;
}
assertEqual(batches, preflightBatches, "batch count");
process.stderr.write(`preflight-verified and streamed ${batches} deterministic fixture batches for ${cutPoint} resources\n`);

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertEqual(actual, expected, name) {
  if (actual !== expected) throw new Error(`${name} mismatch`);
}
