import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const json = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const [adoption, legacyManifest, canonicalManifest, registry, tasks, specification, evidenceReadme] = await Promise.all([
  json("docs/provenance/datahike-s3-adoption-2026-08-25.json"),
  json("registry/data-manifests/datahike-s3-legacy.v1.json"),
  json("fixtures/manifests/fixture-1000000.v1.json"),
  json("registry/profile-registry.v1.json"),
  readFile(new URL("../openspec/changes/consolidate-eacl-demo-backends/tasks.md", import.meta.url), "utf8"),
  readFile(new URL("../openspec/changes/consolidate-eacl-demo-backends/specs/datahike-storage-demos/spec.md", import.meta.url), "utf8"),
  readFile(new URL("../registry/benchmark-evidence/README.md", import.meta.url), "utf8")
]);

test("the adopted S3 store cannot masquerade as the canonical benchmark fixture", () => {
  assert.equal(adoption.canonicalFixtureComparison.status, "mismatch");
  assert.equal(legacyManifest.canonicalFixture, false);
  assert.equal(legacyManifest.semanticRecordsSha256, null);
  assert.notEqual(legacyManifest.logicalResourceCount, canonicalManifest.cutPoint.logicalResources);
  assert.equal(
    adoption.canonicalFixtureComparison.manifestSha256,
    canonicalManifest.digests.manifest
  );
  assert.notDeepEqual(legacyManifest.counts.resources, canonicalManifest.counts.objects.resources.byType);
});

test("comparable S3 publication remains a pending separately authorized stateful operation", () => {
  assert.match(tasks, /- \[ \] 8\.14 Obtain separate explicit authorization[\s\S]*canonical one-million-resource Datahike\/S3 blue-green generation/u);
  assert.match(tasks, /- \[ \] 8\.16 Run the comparable storage benchmark only after both profiles bind the exact canonical fixture/u);
  assert.match(specification, /existing DynamoDB seed authorization SHALL NOT be interpreted as authorization[\s\S]*additional S3 generation/u);
  assert.match(specification, /deterministic qualified fallback with no fastest claim/u);
});

test("the checked-in registry publishes no incomparable speed evidence", () => {
  assert.deepEqual(registry.benchmarkEvidence, []);
  const datahikeDefault = registry.storageDefaults.find(({ backend }) => backend === "datahike");
  assert.deepEqual(datahikeDefault, {
    outcome: "none",
    profileId: null,
    storage: null,
    claim: null,
    evidenceId: null,
    measuredAt: null,
    reason: "No qualified storage choice is enabled.",
    backend: "datahike"
  });
  assert.match(evidenceReadme, /equal\s+canonical Datahike\/S3 lifecycle have not yet qualified/u);
  assert.match(evidenceReadme, /claim: null/u);
});
