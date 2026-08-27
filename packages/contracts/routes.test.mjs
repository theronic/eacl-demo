import assert from "node:assert/strict";
import test from "node:test";
import { logicalOperations, operationRoutes, parseApiRoute } from "./src/routes.mjs";

test("every server profile exposes the same root operations", () => {
  for (const operation of logicalOperations) {
    const result = parseApiRoute(`/${operation}`, operationRoutes[operation]);
    assert.deepEqual(result, { ok: true, contractVersion: "explorer.v1", transport: "http", operation });
  }
});

test("DataScript uses the same logical operations without a public server route", () => {
  assert.deepEqual(parseApiRoute("/datascript-browser-memory/check-permission", "POST"), { ok: false, code: "route-not-found" });
  assert.deepEqual(logicalOperations, Object.keys(operationRoutes));
});

test("closed routes reject unknown operations, methods, versions, and fields", () => {
  assert.deepEqual(parseApiRoute("/seed", "POST"), { ok: false, code: "route-not-found" });
  assert.deepEqual(parseApiRoute("/check-permission", "GET"), { ok: false, code: "method-not-allowed", allowedMethods: ["POST"] });
});
