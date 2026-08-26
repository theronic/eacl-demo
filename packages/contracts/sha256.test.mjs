import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { sha256Hex } from "./src/sha256.mjs";

test("browser-safe SHA-256 matches standard vectors and Node for UTF-8 and byte payloads", () => {
  const values = ["", "abc", "The quick brown fox jumps over the lazy dog", "EACL · λ · 🔐", "x".repeat(10_000)];
  for (const value of values) assert.equal(sha256Hex(value), createHash("sha256").update(value).digest("hex"));
  const bytes = Uint8Array.from({ length: 513 }, (_, index) => index % 256);
  assert.equal(sha256Hex(bytes), createHash("sha256").update(bytes).digest("hex"));
  assert.throws(() => sha256Hex({}), /string or Uint8Array/u);
});
