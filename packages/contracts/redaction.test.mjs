import assert from "node:assert/strict";
import test from "node:test";
import { createReadOnlyDispatcher } from "./src/read-only-dispatcher.mjs";
import { redactRecord, createSafeFailure } from "./src/redaction.mjs";
import { logicalOperations } from "./src/routes.mjs";

const context = { requestId: "r", operation: "authorize", identity: { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "d", dataManifestSha256: "e".repeat(64) }, basis: null };

test("structured logs redact secret-bearing keys recursively and omit exception stacks", () => {
  const record = redactRecord({ requestId: "r", headers: { authorization: "sensitive", cookie: "sensitive" }, config: { connectionString: "sensitive", region: "us-east-1" }, error: Object.assign(new Error("backend leaked sensitive"), { stack: "sensitive stack" }) });
  assert.deepEqual(record.headers, { authorization: "[REDACTED]", cookie: "[REDACTED]" });
  assert.deepEqual(record.config, { connectionString: "[REDACTED]", region: "us-east-1" });
  assert.deepEqual(record.error, { name: "Error", code: "internal-error" });
  assert.equal(JSON.stringify(record).includes("sensitive stack"), false);
});

test("public failures ignore backend messages, stacks, and credential-shaped diagnostics", () => {
  const credential = `${["AK", "IA"].join("")}${"A".repeat(16)}`;
  const error = Object.assign(new Error(`transport failed with ${credential}`), { code: "throttled", stack: `stack ${credential}`, publicDetails: ["dependency=dynamodb", `credential=${credential}`] });
  const failure = createSafeFailure(context, error);
  const encoded = JSON.stringify(failure);
  assert.deepEqual(failure.error, {
    code: "throttled",
    message: "A dependency throttled the request."
  });
  assert.equal(encoded.includes(credential), false);
  assert.equal(encoded.includes("transport failed"), false);
});

test("unlisted mutating and expensive names can never reach a handler", async () => {
  let calls = 0;
  const handlers = Object.fromEntries(logicalOperations.map((operation) => [operation, async () => { calls += 1; return {}; }]));
  const dispatcher = createReadOnlyDispatcher(handlers);
  for (const operation of ["seed", "schema-write", "transact", "benchmark", "scan-all", "dump-storage", "cache-evict", "admin"]) {
    assert.deepEqual(await dispatcher.dispatch({ ok: true, operation, input: {} }, {}), { ok: false, code: "route-not-found" });
  }
  assert.equal(calls, 0);
});

test("unknown exceptions collapse to internal-error", () => {
  const failure = createSafeFailure(context, new Error("backend implementation detail"));
  assert.equal(failure.error.code, "internal-error");
  assert.equal(failure.error.message, "The request failed internally.");
});
