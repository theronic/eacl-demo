import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createFunctionUrlResponse, normalizeFunctionUrlEvent, runFunctionUrlContractSuite } from "./src/function-url.mjs";
import { createFailure, createSuccess } from "./src/envelopes.mjs";

const suite = JSON.parse(await readFile(new URL("../../verification/contracts/function-url-v2.cases.json", import.meta.url), "utf8"));
const context = { requestId: "r", operation: "check-permission", identity: { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "d", dataManifestSha256: "e".repeat(64) }, basis: null };

test("reference adapter passes the reusable Function URL event suite", async () => {
  const result = await runFunctionUrlContractSuite({ name: "reference-js", normalizeEvent: normalizeFunctionUrlEvent }, suite);
  assert.deepEqual(result, { schema: "eacl-demo.function-url-suite-result.v1", adapter: "reference-js", total: 5, passed: 5, failures: [] });
});

test("Function URL responses use stable status and security headers", () => {
  const success = createFunctionUrlResponse(createSuccess(context, { allowed: true }));
  assert.equal(success.statusCode, 200);
  assert.equal(success.headers["cache-control"], "no-store");
  assert.equal(success.headers["x-content-type-options"], "nosniff");
  assert.equal(success.isBase64Encoded, false);
  const failure = createFunctionUrlResponse(createFailure(context, "method-not-allowed"), { allowedMethods: ["POST"] });
  assert.equal(failure.statusCode, 405);
  assert.equal(failure.headers.allow, "POST");
});

test("base64 request bodies normalize identically", () => {
  const body = JSON.stringify({ type: "server", id: "server-1" });
  const event = { version: "2.0", routeKey: "$default", rawPath: "/get-object", rawQueryString: "", headers: { "content-type": "application/json" }, requestContext: { requestId: "r", http: { method: "POST" } }, isBase64Encoded: true, body: btoa(body) };
  assert.equal(normalizeFunctionUrlEvent(event).input.id, "server-1");
});
