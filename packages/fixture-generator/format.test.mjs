import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { canonicalJson } from "./canonical-json.mjs";
import { generateFixtureManifest, sha256 } from "./generator.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const [streamSchema, manifestSchema, exemplarSchema, exemplars, small, large] = await Promise.all([
  readJson("../../schemas/fixture-stream.v1.schema.json"),
  readJson("../../schemas/fixture-manifest.v1.schema.json"),
  readJson("../../schemas/fixture-exemplars.v1.schema.json"),
  readJson("../../fixtures/exemplars.v1.json"),
  readJson("../../fixtures/manifests/fixture-10000.v1.json"),
  readJson("../../fixtures/manifests/fixture-1000000.v1.json")
]);
const validateLine = ajv.compile(streamSchema);
const validateManifest = ajv.compile(manifestSchema);
const validateExemplars = ajv.compile(exemplarSchema);

test("checked-in manifests and exemplars validate as closed JSON formats", () => {
  for (const manifest of [small, large]) {
    assert.equal(validateManifest(manifest), true, ajv.errorsText(validateManifest.errors));
    const withoutSelfDigest = structuredClone(manifest);
    const expected = withoutSelfDigest.digests.manifest;
    delete withoutSelfDigest.digests.manifest;
    assert.equal(sha256(`${canonicalJson(withoutSelfDigest)}\n`), expected);
  }
  assert.equal(validateExemplars(exemplars), true, ajv.errorsText(validateExemplars.errors));
});

test("every canonical small-fixture NDJSON line validates independently", async () => {
  let lines = 0;
  await generateFixtureManifest(10_000, {
    onLine(line) {
      assert.equal(line.endsWith("\n"), true);
      assert.equal(validateLine(JSON.parse(line)), true, `line ${lines}: ${ajv.errorsText(validateLine.errors)}`);
      lines += 1;
    }
  });
  assert.equal(lines, small.counts.records.total + 1);
});

async function readJson(relative) {
  return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
}
