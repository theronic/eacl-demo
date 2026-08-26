import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtime = await readFile(new URL("src/runtime-validation.mjs", import.meta.url), "utf8");
const generated = await readFile(new URL("src/generated/runtime-validators.mjs", import.meta.url), "utf8");

test("browser runtime validation contains no dynamic code generation", () => {
  assert.doesNotMatch(runtime, /\bAjv|\.compile\s*\(/u);
  assert.doesNotMatch(generated, /\brequire\s*\(|\bnew\s+Function\s*\(|\beval\s*\(/u);
});
