import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = JSON.parse(await readFile(new URL("../../schemas/explorer.v1.schema.json", import.meta.url), "utf8"));
const required = ["object", "relationship", "pageInfo", "objectPage", "relationshipPage", "objectResult", "count", "permissionDecision", "schema", "cacheInfo", "basis", "health", "bootstrap", "responseMeta", "success", "failure"];

test("explorer.v1 exposes every required closed wire definition", () => {
  for (const name of required) {
    assert.equal(name in schema.$defs, true, name);
    assert.equal(schema.$defs[name].type, "object", name);
    assert.equal(schema.$defs[name].additionalProperties, false, name);
    assert.equal(schema.$defs[name].required.length > 0, true, name);
  }
});

test("bootstrap binds identity while every response uses one compact metadata shape", () => {
  assert.deepEqual(schema.$defs.identity.required, ["profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId", "dataManifestSha256"]);
  assert.deepEqual(schema.$defs.responseMeta.required, ["revision", "requestId"]);
  assert.deepEqual(Object.keys(schema.$defs.responseMeta.properties), ["revision", "requestId", "elapsedMs", "cacheStatus"]);
});

test("success and failure contain no consolidation-only envelope fields", () => {
  assert.deepEqual(schema.$defs.success.required, ["meta", "data"]);
  assert.deepEqual(schema.$defs.failure.required, ["error", "meta"]);
  assert.equal("ok" in schema.$defs.success.properties, false);
  assert.equal("retryable" in schema.$defs.failure.properties.error.properties, false);
  assert.deepEqual(Object.keys(schema.$defs.failure.properties.error.properties), ["code", "message"]);
});
