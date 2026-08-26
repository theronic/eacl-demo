import assert from "node:assert/strict";
import test from "node:test";
import { logicalOperations, operationRoutes, parseApiRoute, parseWorkerMessage } from "./src/routes.mjs";

test("every server profile routes below its exact v1 prefix", () => {
  for (const profileId of ["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory", "jank-memory"]) {
    for (const operation of logicalOperations) {
      const result = parseApiRoute(`/api/v1/${profileId}/${operation}`, operationRoutes[operation]);
      assert.deepEqual(result, { ok: true, contractVersion: "explorer.v1", transport: "http", profileId, operation });
    }
  }
});

test("DataScript is worker-only and resolves the same operations", () => {
  assert.deepEqual(parseApiRoute("/api/v1/datascript-browser-memory/authorize", "POST"), { ok: false, code: "route-not-found" });
  for (const operation of logicalOperations) {
    const message = parseWorkerMessage({ type: "request", contractVersion: "explorer.v1", profileId: "datascript-browser-memory", requestId: `request-${operation}`, clientEpoch: 7, operation, input: {} });
    assert.equal(message.ok, true);
    assert.equal(message.operation, operation);
    assert.equal(message.transport, "worker");
  }
});

test("closed routes reject unknown operations, methods, versions, and fields", () => {
  assert.deepEqual(parseApiRoute("/api/v1/datahike-s3/seed", "POST"), { ok: false, code: "route-not-found" });
  assert.deepEqual(parseApiRoute("/api/v1/datahike-s3/authorize", "GET"), { ok: false, code: "method-not-allowed", allowedMethods: ["POST"] });
  assert.deepEqual(parseWorkerMessage({ type: "request", contractVersion: "explorer.v2", profileId: "datascript-browser-memory", requestId: "r", clientEpoch: 1, operation: "authorize", input: {} }), { ok: false, code: "identity-mismatch" });
  assert.deepEqual(parseWorkerMessage({ type: "request", contractVersion: "explorer.v1", profileId: "datascript-browser-memory", requestId: "r", clientEpoch: 1, operation: "authorize", input: {}, seed: true }), { ok: false, code: "validation-error" });
});
