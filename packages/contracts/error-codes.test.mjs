import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = JSON.parse(await readFile(new URL("./error-codes.v1.json", import.meta.url), "utf8"));
const codes = new Map(catalog.errors.map((error) => [error.code, error]));

test("stable errors cover every required failure class", () => {
  const required = ["validation-error", "method-not-allowed", "route-not-found", "cursor-invalid", "cursor-expired", "cursor-scope-mismatch", "unsupported-consistency", "cancelled", "deadline-exceeded", "overloaded", "throttled", "dependency-unavailable", "storage-missing", "storage-corrupt", "internal-error"];
  for (const code of required) assert.equal(codes.has(code), true, code);
  assert.equal(codes.size, catalog.errors.length);
});

test("retry classification and public messages are explicit", () => {
  assert.equal(codes.get("throttled").retryable, true);
  assert.equal(codes.get("storage-corrupt").retryable, false);
  for (const error of codes.values()) {
    assert.match(error.message, /^[A-Z].*[.]$/u);
    assert.equal(/exception|stack|credential|token|secret/iu.test(error.message), false);
  }
});
