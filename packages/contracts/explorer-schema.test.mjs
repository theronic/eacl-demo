import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = JSON.parse(await readFile(new URL("../../schemas/explorer.v1.schema.json", import.meta.url), "utf8"));
const required = ["object", "relationship", "pageInfo", "objectPage", "relationshipPage", "objectResult", "count", "authorizationDecision", "schema", "cacheInfo", "basis", "health", "bootstrap", "success", "failure"];

test("explorer.v1 exposes every required closed wire definition", () => {
  for (const name of required) {
    assert.equal(name in schema.$defs, true, name);
    assert.equal(schema.$defs[name].type, "object", name);
    assert.equal(schema.$defs[name].additionalProperties, false, name);
    assert.equal(schema.$defs[name].required.length > 0, true, name);
  }
});

test("identity binds profile, both sources, artifact, deployment, and data", () => {
  assert.deepEqual(schema.$defs.identity.required, ["profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId", "dataManifestSha256"]);
  assert.equal(schema.$defs.responseMeta.properties.contractVersion.const, "explorer.v1");
  assert.equal(schema.$defs.responseMeta.required.includes("operation"), true);
});

test("success data is closed and correlated with its operation", () => {
  const variants = schema.$defs.success.allOf[0].oneOf;
  assert.equal(variants.length, 13);
  assert.deepEqual(variants.map(({ properties }) => properties.meta.properties.operation.const), ["health", "bootstrap", "list-subjects", "get-object", "list-relationships", "reverse-relationships", "authorize", "lookup-resources", "lookup-subjects", "count-resources", "get-schema", "get-cache-info", "count-objects"]);
});
