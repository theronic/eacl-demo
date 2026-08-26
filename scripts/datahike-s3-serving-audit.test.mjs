import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("Datahike S3 serving source excludes mutation, setup, benchmark, and administration", () => {
  const output = execFileSync(process.execPath, ["scripts/audit-datahike-s3-serving.mjs"], { encoding: "utf8" });
  const report = JSON.parse(output);
  assert.equal(report.schema, "eacl-demo.datahike-s3-serving-audit.v1");
  assert.deepEqual(report.records.map(({ name }) => name), [
    "boundary.clj",
    "client.clj",
    "konserve.clj",
    "lambda_handler.clj",
    "operations.clj",
    "profile.clj",
    "read_only_writer.clj",
    "reader.clj",
  ]);
});
