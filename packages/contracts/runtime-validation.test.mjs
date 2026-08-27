import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRuntimeBoundaryValidator, createRuntimeValidators } from "./src/runtime-validation.mjs";

const names = ["artifact-digests.v1", "error-codes.v1", "explorer.v1", "explorer-client-request.v1", "explorer-response.v1", "explorer-descriptor.v1", "fixture-manifest-boundary.v1", "profile-registry.v1", "profile-publication.v1", "benchmark-evidence-index.v1", "fastest-storage-evidence.v1", "release-manifest.v1"];
const schemas = Object.fromEntries(await Promise.all(names.map(async (name) => [name, JSON.parse(await readFile(new URL(`../../schemas/${name}.schema.json`, import.meta.url), "utf8"))])));
const validate = createRuntimeValidators(schemas);
const sha1 = "a".repeat(40);
const sha256 = "b".repeat(64);
const identity = { profileId: "datahike-s3", demoSha: sha1, eaclSha: sha1, artifactSha256: sha256, deploymentId: "deploy-1", dataManifestSha256: sha256 };
const basis = { behavior: "request-snapshot", id: "basis-1", capturedAt: "2026-08-25T12:00:00Z", fixedForEnvironment: false };
const descriptor = {
  contract: { name: "explorer.v1", routeMajor: 1, revision: 1, minimumClientRevision: 0 }, identity,
  profile: { backend: "datahike", storage: "s3" },
  runtime: { execution: "lambda", name: "java25", architecture: "arm64", snapStart: "enabled" },
  capabilities: { operations: ["authorize"], consistencyModes: ["current"], snapshotBehavior: "request-snapshot", cacheBehavior: "shared-read-through", mutationLocality: "private-seed-workflow", limitations: ["read-only"] },
  limits: [{ name: "page-size", value: 25 }], dataset: { fixtureId: "canonical-v1", logicalResourceCount: 1000000, serverCount: 998417, manifestSha256: sha256 }, basis
};

test("all runtime boundaries accept canonical values", async () => {
  assert.equal(validate.client({ contractVersion: "explorer.v1", profileId: "datahike-s3", requestId: "r1", operation: "authorize", input: {} }).requestId, "r1");
  assert.equal(validate.server({ meta: { revision: "basis-1", requestId: "r1" }, data: { object: { type: "server", id: "server-1", displayName: null, attributes: [] } } }).data.object.id, "server-1");
  assert.equal(validate.server({ meta: { revision: "datomic:fixture:42", requestId: "r2", elapsedMs: 0.8, cacheStatus: "hit" }, data: { allowed: true } }).data.allowed, true);
  assert.equal(validate.fixture({ schema: "eacl-demo.fixture-manifest.v1", fixtureId: "canonical-v1-10000", algorithmVersion: "fixture-v1", seed: "eacl-demo", cutPoint: 10000, logicalResourceCount: 10000, schemaSha256: sha256, manifestSha256: sha256 }).cutPoint, 10000);
  assert.equal(validate.descriptor(descriptor).identity.profileId, "datahike-s3");
  const registry = JSON.parse(await readFile(new URL("../../registry/profile-registry.v1.json", import.meta.url), "utf8"));
  assert.equal(validate.registry(registry).profiles.length, 6);
  const publication = { $schema: "../../schemas/profile-publication.v1.schema.json", schema: "eacl-demo.profile-publication.v1", contractVersion: "explorer.v1", publicationId: `sha256:${sha256}`, publishedAt: "2026-08-25T12:00:00Z", gate: { kind: "initial-qualification", evidenceId: `sha256:${sha256}` }, profile: registry.profiles[0] };
  assert.equal(validate.profilePublication(publication).profile.id, "datahike-s3");
  const benchmarkIndex = { $schema: "../../schemas/benchmark-evidence-index.v1.schema.json", schema: "eacl-demo.benchmark-evidence-index.v1", contractVersion: "explorer.v1", indexId: `sha256:${sha256}`, publishedAt: "2026-08-25T12:00:00Z", evidence: [] };
  assert.equal(validate.benchmarkIndex(benchmarkIndex).evidence.length, 0);
  const release = { schema: "eacl-demo.release-manifest.v1", contractVersion: "explorer.v1", source: { demo: { repository: "https://github.com/theronic/eacl-demo.git", sha: sha1 }, eacl: { repository: "https://github.com/theronic/eacl.git", sha: sha1 } }, fixture: { id: "canonical-v1", manifestSha256: sha256 }, deployment: { provider: "github-actions", repositoryId: "1345904214", runId: "1", runAttempt: 1, ref: "refs/heads/demos", identity: `1345904214:1:1:${sha1}` }, artifacts: [{ name: "datahike-s3", path: "dist/datahike-s3/artifact.json", sha256, bytes: 1 }] };
  assert.equal(validate.release(release).deployment.runId, "1");
});

test("unknown fields and malformed identities fail closed without exposing values", () => {
  const candidate = { contractVersion: "explorer.v1", profileId: "datahike-s3", requestId: "sensitive-value", operation: "authorize", input: {}, extra: true };
  assert.throws(() => validate.client(candidate), (error) => {
    assert.equal(error.code, "validation-error");
    assert.equal(error.boundary, "client");
    assert.equal(JSON.stringify(error).includes("sensitive-value"), false);
    assert.equal(error.validationErrors.some(({ keyword }) => keyword === "additionalProperties"), true);
    return true;
  });
  assert.throws(() => validate.descriptor({ ...descriptor, identity: { ...identity, demoSha: "main" } }), /descriptor boundary validation failed/u);
});

test("runtime validation is restricted to checked-in precompiled schema ids", () => {
  assert.throws(
    () => createRuntimeBoundaryValidator(schemas, "https://demo.eacl.dev/schemas/not-generated.schema.json", "unknown"),
    /required runtime schema is unavailable/u
  );
  assert.throws(
    () => createRuntimeBoundaryValidator({ unknown: { $id: "https://demo.eacl.dev/schemas/not-generated.schema.json" } }, "https://demo.eacl.dev/schemas/not-generated.schema.json", "unknown"),
    /no precompiled runtime validator/u
  );
});
