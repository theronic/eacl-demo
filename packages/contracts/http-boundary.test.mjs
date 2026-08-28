import assert from "node:assert/strict";
import test from "node:test";
import { validateHttpRequest } from "./src/http-boundary.mjs";

const post = (operation, input, overrides = {}) => validateHttpRequest({ path: `/${operation}`, method: "POST", contentType: "application/json", query: "", body: JSON.stringify(input), requestId: "request-1", ...overrides });

test("closed GET and POST routes produce normalized client requests", () => {
  assert.deepEqual(validateHttpRequest({ path: "/health", method: "GET", query: "", body: null, requestId: "r" }), { ok: true, contractVersion: "explorer.v1", transport: "http", operation: "health", requestId: "r", input: {} });
  const authorization = post("check-permission", { subjectType: "user", subjectId: "alice", resourceType: "server", resourceId: "server-1", permission: "read", cache: true, populateCache: false, consistency: "minimize" });
  assert.equal(authorization.ok, true);
  assert.equal(authorization.input.permission, "read");
  const lookup = post("lookup-resources", { subjectType: "user", subjectId: "alice", resourceType: "server", permission: "read", pageSize: 20, cache: false, populateCache: false, consistency: "minimize" });
  assert.equal(lookup.ok, true);
  assert.equal(lookup.input.cache, false);
});

test("method, route, content type, query, and normalized path are closed", () => {
  assert.equal(validateHttpRequest({ path: "/health", method: "DELETE", query: "", body: null, requestId: "r" }).code, "method-not-allowed");
  assert.equal(post("seed", {}).code, "route-not-found");
  assert.equal(post("check-permission", {}, { contentType: "text/plain" }).code, "unsupported-media-type");
  assert.equal(post("check-permission", {}, { query: "debug=true" }).code, "validation-error");
  assert.equal(post("check-permission", {}, { path: "/%63heck-permission" }).code, "route-not-found");
  assert.equal(post("check-permission", {}, { path: "//check-permission" }).code, "route-not-found");
  assert.equal(post("check-permission", {}, { path: "/check-permission/" }).code, "route-not-found");
});

test("operation bodies reject missing, extra, unbounded, mutation, and administration fields", () => {
  assert.equal(post("check-permission", { subjectType: "user" }).code, "validation-error");
  assert.equal(post("check-permission", { subjectType: "user", subjectId: "alice", resourceType: "server", resourceId: "server-1", permission: "read", seed: true }).code, "validation-error");
  assert.equal(post("list-subjects", { pageSize: 1001 }).code, "validation-error");
  assert.equal(post("count-objects", { kind: "objects", ceiling: 1000001 }).code, "validation-error");
  assert.equal(post("lookup-resources", { subjectType: "user", subjectId: "alice", resourceType: "server", permission: "read", cache: "yes" }).code, "validation-error");
  assert.equal(post("get-schema", { transaction: [] }).code, "validation-error");
  assert.equal(post("get-cache-info", { evict: true }).code, "validation-error");
});

test("invalid JSON, non-object bodies, oversized bodies, cursors, and consistency fail before dispatch", () => {
  assert.equal(post("check-permission", {}, { body: "{" }).code, "validation-error");
  assert.equal(post("check-permission", {}, { body: "[]" }).code, "validation-error");
  assert.equal(post("get-schema", {}, { body: `{"padding":"${"a".repeat(65536)}"}` }).code, "request-too-large");
  assert.equal(post("list-subjects", { cursor: "a".repeat(4097) }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "magic" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "exact", atLeastAsFreshAs: "2026-08-26T00:00:00Z" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "exact", atLeastAsFreshBasisId: "datahike:42:locator" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "at-least", atLeastAsFreshBasisId: "datahike:42:locator" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "at-least", atLeastAsFreshBasisCapturedAt: "2026-08-26T00:00:00Z" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "at-least", atLeastAsFreshAs: "2026-08-26T00:00:00Z" }).ok, true);
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "at-least", atLeastAsFreshAs: "2026-08-26T00:00:00Z", atLeastAsFreshBasisId: "datahike:42:locator", atLeastAsFreshBasisCapturedAt: "2026-08-26T00:01:00Z" }).ok, true);
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "at-least", atLeastAsFreshAs: "2026-08-26T00:00:00Z", atLeastAsFreshBasisId: "datahike:42:locator", atLeastAsFreshBasisCapturedAt: "not-a-date" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "exact", atLeastAsFreshAs: "2026-08-26T00:00:00Z", atLeastAsFreshBasisId: "datahike:42:locator", atLeastAsFreshBasisCapturedAt: "2026-08-26T00:01:00Z" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "at-least", atLeastAsFreshAs: "2026-08-26T00:00:00Z", atLeastAsFreshBasisId: "not a basis" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "historical-date" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "exact", atExactSnapshotAt: "2026-08-26T00:00:00Z" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "historical-date", atExactSnapshotAt: "not-a-date" }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "historical-date", atExactSnapshotAt: "2026-08-26T00:00:00Z" }).ok, true);
});
