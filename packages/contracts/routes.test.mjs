import assert from "node:assert/strict";
import test from "node:test";
import { logicalOperations, operationRoutes, parseApiRoute } from "./src/routes.mjs";

test("every server profile routes below its exact v1 prefix", () => {
  for (const profileId of ["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory", "jank-memory"]) {
    for (const operation of logicalOperations) {
      const result = parseApiRoute(`/api/v1/${profileId}/${operation}`, operationRoutes[operation]);
      assert.deepEqual(result, { ok: true, contractVersion: "explorer.v1", transport: "http", profileId, operation });
    }
  }
});

test("DataScript uses the same logical operations without a public server route", () => {
  assert.deepEqual(parseApiRoute("/api/v1/datascript-browser-memory/authorize", "POST"), { ok: false, code: "route-not-found" });
  assert.deepEqual(logicalOperations, Object.keys(operationRoutes));
});

test("closed routes reject unknown operations, methods, versions, and fields", () => {
  assert.deepEqual(parseApiRoute("/api/v1/datahike-s3/seed", "POST"), { ok: false, code: "route-not-found" });
  assert.deepEqual(parseApiRoute("/api/v1/datahike-s3/authorize", "GET"), { ok: false, code: "method-not-allowed", allowedMethods: ["POST"] });
});
