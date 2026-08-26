import assert from "node:assert/strict";
import test from "node:test";
import { validateHttpRequest } from "./src/http-boundary.mjs";

const post = (operation, input, overrides = {}) => validateHttpRequest({ path: `/api/v1/datahike-s3/${operation}`, method: "POST", contentType: "application/json", query: "", body: JSON.stringify(input), requestId: "request-1", ...overrides });

test("closed GET and POST routes produce normalized client requests", () => {
  assert.deepEqual(validateHttpRequest({ path: "/api/v1/datahike-s3/health", method: "GET", query: "", body: null, requestId: "r" }), { ok: true, contractVersion: "explorer.v1", transport: "http", profileId: "datahike-s3", operation: "health", requestId: "r", input: {} });
  const authorization = post("authorize", { subjectType: "user", subjectId: "alice", resourceType: "server", resourceId: "server-1", permission: "read", consistency: "current" });
  assert.equal(authorization.ok, true);
  assert.equal(authorization.input.permission, "read");
  const lookup = post("lookup-resources", { subjectType: "user", subjectId: "alice", resourceType: "server", permission: "read", pageSize: 20, cache: false, populateCache: false, consistency: "current" });
  assert.equal(lookup.ok, true);
  assert.equal(lookup.input.cache, false);
});

test("method, route, content type, query, and normalized path are closed", () => {
  assert.equal(validateHttpRequest({ path: "/api/v1/datahike-s3/health", method: "DELETE", query: "", body: null, requestId: "r" }).code, "method-not-allowed");
  assert.equal(post("seed", {}).code, "route-not-found");
  assert.equal(post("authorize", {}, { contentType: "text/plain" }).code, "unsupported-media-type");
  assert.equal(post("authorize", {}, { query: "debug=true" }).code, "validation-error");
  assert.equal(post("authorize", {}, { path: "/api/v1/datahike-s3/%61uthorize" }).code, "route-not-found");
  assert.equal(post("authorize", {}, { path: "/api//v1/datahike-s3/authorize" }).code, "route-not-found");
  assert.equal(post("authorize", {}, { path: "/api/v1/datahike-s3/authorize/" }).code, "route-not-found");
});

test("operation bodies reject missing, extra, unbounded, mutation, and administration fields", () => {
  assert.equal(post("authorize", { subjectType: "user" }).code, "validation-error");
  assert.equal(post("authorize", { subjectType: "user", subjectId: "alice", resourceType: "server", resourceId: "server-1", permission: "read", seed: true }).code, "validation-error");
  assert.equal(post("list-subjects", { pageSize: 101 }).code, "validation-error");
  assert.equal(post("count-objects", { kind: "objects", ceiling: 1000001 }).code, "validation-error");
  assert.equal(post("lookup-resources", { subjectType: "user", subjectId: "alice", resourceType: "server", permission: "read", cache: "yes" }).code, "validation-error");
  assert.equal(post("get-schema", { transaction: [] }).code, "validation-error");
  assert.equal(post("get-cache-info", { evict: true }).code, "validation-error");
});

test("invalid JSON, non-object bodies, oversized bodies, cursors, and consistency fail before dispatch", () => {
  assert.equal(post("authorize", {}, { body: "{" }).code, "validation-error");
  assert.equal(post("authorize", {}, { body: "[]" }).code, "validation-error");
  assert.equal(post("get-schema", {}, { body: `{"padding":"${"a".repeat(65536)}"}` }).code, "request-too-large");
  assert.equal(post("list-subjects", { cursor: "a".repeat(4097) }).code, "validation-error");
  assert.equal(post("get-object", { type: "server", id: "server-1", consistency: "magic" }).code, "validation-error");
});
