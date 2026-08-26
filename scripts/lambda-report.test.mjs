import assert from "node:assert/strict";
import test from "node:test";

import { loadLambdaFunctionConfiguration, parseLambdaFunctionConfiguration, parseLambdaFunctionTags, parseLambdaInvocation, parseLambdaReport } from "./lib/lambda-report.mjs";

const digest = "a".repeat(64);

test("Lambda configuration binds exact published version, artifact, state, and memory", () => {
  const source = JSON.stringify({ FunctionName: "eacl-demo-datahike-s3", FunctionArn: "arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datahike-s3:7", Version: "7", State: "Active", LastUpdateStatus: "Successful", CodeSha256: Buffer.from(digest, "hex").toString("base64"), Runtime: "java25", Architectures: ["arm64"], SnapStart: { ApplyOn: "None", OptimizationStatus: "Off" }, MemorySize: 512 });
  assert.deepEqual(parseLambdaFunctionConfiguration(source, { functionName: "eacl-demo-datahike-s3", qualifier: "7", expectedArtifactSha256: digest }), {
    functionName: "eacl-demo-datahike-s3", functionArn: "arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datahike-s3", qualifier: "7", version: "7", state: "Active", lastUpdateStatus: "Successful", codeSha256: digest, runtime: "java25", architecture: "arm64", snapStart: "disabled", memorySizeMiB: 512
  });
  assert.deepEqual(parseLambdaFunctionTags(JSON.stringify({ Tags: { Project: "eacl-demo", Profile: "datahike-s3", ArtifactSha256: digest } })), { project: "eacl-demo", profileId: "datahike-s3" });
  assert.throws(() => parseLambdaFunctionTags(JSON.stringify({ Tags: { Project: "another", Profile: "datahike-s3" } })), /tags/u);
  assert.throws(() => parseLambdaFunctionConfiguration(source, { functionName: "eacl-demo-datahike-s3", qualifier: "7", expectedArtifactSha256: "b".repeat(64) }), /immutable exercise target/u);
  assert.throws(() => parseLambdaFunctionConfiguration(JSON.stringify({ ...JSON.parse(source), Architectures: ["arm64", "x86_64"] }), { functionName: "eacl-demo-datahike-s3", qualifier: "7", expectedArtifactSha256: digest }), /immutable exercise target/u);
  assert.throws(() => parseLambdaFunctionConfiguration(JSON.stringify({ ...JSON.parse(source), SnapStart: { ApplyOn: "PublishedVersions", OptimizationStatus: "Off" } }), { functionName: "eacl-demo-datahike-s3", qualifier: "7", expectedArtifactSha256: digest }), /not ready/u);
});

test("Lambda configuration loader verifies the exact function profile tags", async () => {
  const calls = [];
  const configuration = { FunctionName: "eacl-demo-datahike-s3", FunctionArn: "arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datahike-s3:7", Version: "7", State: "Active", LastUpdateStatus: "Successful", CodeSha256: Buffer.from(digest, "hex").toString("base64"), Runtime: "java25", Architectures: ["arm64"], SnapStart: { ApplyOn: "None", OptimizationStatus: "Off" }, MemorySize: 512 };
  const loaded = await loadLambdaFunctionConfiguration({ functionName: "eacl-demo-datahike-s3", qualifier: "7", expectedArtifactSha256: digest, execFile: async (_command, args) => {
    calls.push(args);
    return { stdout: JSON.stringify(args[1] === "get-function-configuration" ? configuration : { Tags: { Project: "eacl-demo", Profile: "datahike-s3" } }) };
  } });
  assert.equal(loaded.profileId, "datahike-s3");
  assert.deepEqual(calls.map((args) => args[1]), ["get-function-configuration", "list-tags"]);
  assert.equal(calls[1].includes("arn:aws:lambda:af-south-1:123456789012:function:eacl-demo-datahike-s3"), true);
});

test("classic and structured Lambda platform REPORT records parse exactly", () => {
  const classic = "START RequestId: abc Version: 7\nREPORT RequestId: abc Duration: 12.34 ms Billed Duration: 13 ms Memory Size: 512 MB Max Memory Used: 123 MB Init Duration: 456.78 ms\n";
  assert.deepEqual(parseLambdaReport(classic), { durationMs: 12.34, billedDurationMs: 13, memorySizeMiB: 512, maxMemoryUsedMiB: 123, initDurationMs: 456.78, restoreDurationMs: null });
  const structured = `${JSON.stringify({ time: "2026-08-26T00:00:00Z", type: "platform.report", record: { requestId: "abc", metrics: { durationMs: 12.34, billedDurationMs: 13, memorySizeMB: 512, maxMemoryUsedMB: 123, restoreDurationMs: 20.5 } } })}\n`;
  assert.deepEqual(parseLambdaReport(structured), { durationMs: 12.34, billedDurationMs: 13, memorySizeMiB: 512, maxMemoryUsedMiB: 123, initDurationMs: null, restoreDurationMs: 20.5 });
  const restored = "REPORT RequestId: abc Duration: 12.34 ms Billed Duration: 13 ms Memory Size: 512 MB Max Memory Used: 123 MB Restore Duration: 20.5 ms Billed Restore Duration: 10 ms\n";
  assert.deepEqual(parseLambdaReport(restored), { durationMs: 12.34, billedDurationMs: 13, memorySizeMiB: 512, maxMemoryUsedMiB: 123, initDurationMs: null, restoreDurationMs: 20.5 });
  assert.throws(() => parseLambdaReport("START only"), /exactly one REPORT/u);
  assert.throws(() => parseLambdaReport(`${classic}${classic}`), /exactly one REPORT/u);
});

test("Lambda invocation rejects version drift and returns only bounded envelope plus REPORT", () => {
  const report = "REPORT RequestId: abc Duration: 12.34 ms Billed Duration: 13 ms Memory Size: 512 MB Max Memory Used: 123 MB\n";
  const metadata = JSON.stringify({ StatusCode: 200, ExecutedVersion: "7", LogResult: Buffer.from(report).toString("base64") });
  const response = JSON.stringify({ statusCode: 200, body: JSON.stringify({ ok: true, meta: { operation: "health", requestId: "sample-1" }, data: {} }) });
  assert.deepEqual(parseLambdaInvocation(metadata, response, { qualifier: "7" }), { envelope: JSON.parse(JSON.parse(response).body), durationMs: 12.34, billedDurationMs: 13, memorySizeMiB: 512, maxMemoryUsedMiB: 123, initDurationMs: null, restoreDurationMs: null });
  assert.throws(() => parseLambdaInvocation(metadata, response, { qualifier: "8" }), /exact immutable version/u);
  assert.throws(() => parseLambdaInvocation(JSON.stringify({ StatusCode: 200, ExecutedVersion: "7", LogResult: "not base64" }), response, { qualifier: "7" }), /tail log is invalid/u);
  assert.throws(() => parseLambdaInvocation(metadata, "x".repeat(1048577), { qualifier: "7" }), /unbounded/u);
  const impossible = "REPORT RequestId: abc Duration: 14 ms Billed Duration: 13 ms Memory Size: 512 MB Max Memory Used: 513 MB\n";
  assert.throws(() => parseLambdaReport(impossible), /memory values|billed duration/u);
});
