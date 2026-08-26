import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createFailure, createSuccess, httpStatusForError } from "./src/envelopes.mjs";
import { createRuntimeValidators } from "./src/runtime-validation.mjs";

const names = ["artifact-digests.v1", "error-codes.v1", "explorer.v1", "explorer-client-request.v1", "explorer-response.v1", "explorer-worker-message.v1", "explorer-worker-event.v1", "explorer-descriptor.v1", "fixture-manifest-boundary.v1", "profile-registry.v1", "profile-publication.v1", "benchmark-evidence-index.v1", "fastest-storage-evidence.v1", "release-manifest.v1"];
const schemas = Object.fromEntries(await Promise.all(names.map(async (name) => [name, JSON.parse(await readFile(new URL(`../../schemas/${name}.schema.json`, import.meta.url), "utf8"))])));
const validate = createRuntimeValidators(schemas);
const context = {
  requestId: "request-1",
  operation: "authorize",
  identity: { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deploy-1", dataManifestSha256: "d".repeat(64) },
  basis: { behavior: "request-snapshot", id: "basis-1", capturedAt: "2026-08-25T12:00:00Z", fixedForEnvironment: false }
};

test("success carries the complete immutable request and deployment identity", () => {
  const envelope = createSuccess(context, { subjectType: "user", subjectId: "user-1", resourceType: "server", resourceId: "server-1", permission: "view", allowed: true, reasonCode: "granted", path: [] });
  assert.equal(validate.server(envelope), envelope);
  assert.deepEqual(envelope.meta.identity, context.identity);
  assert.equal(envelope.meta.requestId, context.requestId);
  assert.equal(envelope.meta.operation, context.operation);
});

test("failure uses the same identity and only stable catalog semantics", () => {
  const envelope = createFailure(context, "throttled", ["dependency=dynamodb"]);
  assert.equal(validate.server(envelope), envelope);
  assert.deepEqual(envelope.meta.identity, context.identity);
  assert.equal(envelope.error.message, "A dependency throttled the request.");
  assert.equal(envelope.error.retryable, true);
  assert.equal(httpStatusForError("throttled"), 429);
});

test("unknown error codes and partial identities cannot produce envelopes", () => {
  assert.throws(() => createFailure(context, "raw-exception"), /unknown stable error code/u);
  assert.throws(() => createSuccess({ ...context, identity: { profileId: "datahike-s3" } }, {}), /unknown or missing fields/u);
});
