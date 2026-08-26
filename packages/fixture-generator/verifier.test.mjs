import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalJson } from "./canonical-json.mjs";
import { generateFixtureManifest } from "./generator.mjs";
import { verifyFixtureLines } from "./verifier.mjs";

const storedManifest = JSON.parse(await readFile(new URL("../../fixtures/manifests/fixture-10000.v1.json", import.meta.url), "utf8"));
const lines = [];
const generatedManifest = await generateFixtureManifest(10_000, { onLine: (line) => lines.push(line) });

test("complete canonical fixture passes all identity and digest checks", async () => {
  assert.deepEqual(generatedManifest, storedManifest);
  const result = await verifyFixtureLines(lines, storedManifest);
  assert.equal(result.result, "pass");
  assert.equal(result.lines, 48_694);
});

test("partial batches fail closed", async () => {
  await expectCode(lines.slice(0, -1), storedManifest, "partial-fixture");
});

test("duplicate canonical records fail closed", async () => {
  const duplicate = [...lines];
  duplicate.splice(100, 0, duplicate[99]);
  await expectCode(duplicate, storedManifest, "duplicate-record");
});

test("dangling relationship fails before digest verification", async () => {
  const dangling = [...lines];
  const index = dangling.findIndex((line, candidate) => candidate > 0 && JSON.parse(line).kind === "relationship");
  const record = JSON.parse(dangling[index]);
  record.subject.id = "missing-subject";
  dangling[index] = `${canonicalJson(record)}\n`;
  await expectCode(dangling, storedManifest, "dangling-relationship");
});

test("schema drift and wrong cut points have stable failure categories", async () => {
  const schemaDrift = [...lines];
  const driftedHeader = JSON.parse(schemaDrift[0]);
  driftedHeader.schemaDigest = `sha256:${"0".repeat(64)}`;
  schemaDrift[0] = `${canonicalJson(driftedHeader)}\n`;
  await expectCode(schemaDrift, storedManifest, "schema-drift");

  const wrongCut = [...lines];
  const wrongHeader = JSON.parse(wrongCut[0]);
  wrongHeader.cutPointResources = 1_000_000;
  wrongCut[0] = `${canonicalJson(wrongHeader)}\n`;
  await expectCode(wrongCut, storedManifest, "wrong-cut-point");
});

test("manifest drift is detected independently of fixture bytes", async () => {
  const drifted = structuredClone(storedManifest);
  drifted.counts.objects.resources.total -= 1;
  await expectCode(lines, drifted, "manifest-digest-mismatch");
});

async function expectCode(candidateLines, manifest, code) {
  await assert.rejects(
    verifyFixtureLines(candidateLines, manifest),
    (error) => error?.code === code,
    `expected fixture verification error ${code}`
  );
}
