import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("Datahike DynamoDB serving closure excludes upstream and destructive SDK paths", () => {
  const output = execFileSync("node", ["scripts/audit-datahike-dynamodb-serving.mjs"], {
    cwd: root, encoding: "utf8"
  });
  assert.match(output, /serving audit passed/);
});
