import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const json = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const [adoption, canonicalManifest, tasks, specification] = await Promise.all([
  json("docs/provenance/datahike-s3-adoption-2026-08-25.json"),
  json("fixtures/manifests/fixture-1000000.v1.json"),
  readFile(new URL("../openspec/changes/consolidate-eacl-demo-backends/tasks.md", import.meta.url), "utf8"),
  readFile(new URL("../openspec/changes/consolidate-eacl-demo-backends/specs/datahike-storage-demos/spec.md", import.meta.url), "utf8")
]);

test("the adopted S3 store cannot masquerade as the canonical benchmark fixture", () => {
  assert.equal(adoption.canonicalFixtureComparison.status, "mismatch");
  assert.equal(
    adoption.canonicalFixtureComparison.manifestSha256,
    canonicalManifest.digests.manifest
  );
});

test("comparable S3 publication remains a pending separately authorized stateful operation", () => {
  assert.match(tasks, /- \[ \] 8\.14 Obtain separate explicit authorization[\s\S]*canonical one-million-resource Datahike\/S3 blue-green generation/u);
  assert.match(tasks, /- \[ \] 8\.16 Run the comparable storage benchmark only after both profiles bind the exact canonical fixture/u);
  assert.match(specification, /existing DynamoDB seed authorization SHALL NOT be interpreted as authorization[\s\S]*additional S3 generation/u);
  assert.match(specification, /deterministic qualified fallback with no fastest claim/u);
});
