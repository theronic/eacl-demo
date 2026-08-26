import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalJson } from "../packages/fixture-generator/canonical-json.mjs";
import { fixtureBundles } from "../packages/fixture-generator/generator.mjs";

const smallManifest = JSON.parse(await readFile(new URL("../fixtures/manifests/fixture-10000.v1.json", import.meta.url), "utf8"));
const largeManifest = JSON.parse(await readFile(new URL("../fixtures/manifests/fixture-1000000.v1.json", import.meta.url), "utf8"));
const small = fixtureBundles(10_000)[Symbol.iterator]();
const large = fixtureBundles(1_000_000)[Symbol.iterator]();
const hash = createHash("sha256");
let bundleCount = 0;
let recordCount = 0;
const introducedObjects = new Set();

while (true) {
  const smallStep = small.next();
  if (smallStep.done) break;
  const largeStep = large.next();
  assert.equal(largeStep.done, false, `large stream ended before small bundle ${bundleCount}`);
  assert.equal(
    canonicalJson(smallStep.value),
    canonicalJson(largeStep.value),
    `semantic bundle ${bundleCount} differs`
  );
  for (const record of smallStep.value.records) {
    if (record.kind === "object") {
      introducedObjects.add(`${record.object.type}:${record.object.id}`);
    } else {
      assert.equal(
        introducedObjects.has(`${record.subject.type}:${record.subject.id}`),
        true,
        `relationship ${record.relation} has a subject outside the prefix`
      );
      assert.equal(
        introducedObjects.has(`${record.resource.type}:${record.resource.id}`),
        true,
        `relationship ${record.relation} has a resource outside the prefix`
      );
    }
    hash.update(`${canonicalJson(record)}\n`);
    recordCount += 1;
  }
  bundleCount += 1;
}

assert.equal(bundleCount, 10_000);
assert.equal(large.next().done, false, "large stream must contain resources after the small prefix");
const digest = `sha256:${hash.digest("hex")}`;
assert.equal(recordCount, smallManifest.counts.records.total);
assert.equal(digest, smallManifest.digests.semanticRecords);
assert.equal(digest, largeManifest.prefixProofs["10000"].recordsDigest);
assert.equal(recordCount, largeManifest.prefixProofs["10000"].recordCount);

console.log(JSON.stringify({
  result: "pass",
  relation: "exact-semantic-record-prefix",
  smallCutPoint: 10_000,
  largeCutPoint: 1_000_000,
  comparedBundles: bundleCount,
  comparedRecords: recordCount,
  recordsDigest: digest
}));
