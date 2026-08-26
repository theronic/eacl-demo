import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const defaultExecFile = promisify(execFileCallback);

export async function loadLambdaFunctionConfiguration({ functionName, qualifier, expectedArtifactSha256, execFile = defaultExecFile }) {
  validateFunction(functionName, qualifier);
  const { stdout } = await execFile("aws", ["lambda", "get-function-configuration", "--function-name", functionName, "--qualifier", qualifier, "--output", "json"], execOptions());
  const configuration = parseLambdaFunctionConfiguration(stdout, { functionName, qualifier, expectedArtifactSha256 });
  const tagsResult = await execFile("aws", ["lambda", "list-tags", "--resource", configuration.functionArn, "--output", "json"], execOptions());
  return { ...configuration, ...parseLambdaFunctionTags(tagsResult.stdout) };
}

export function parseLambdaFunctionConfiguration(source, { functionName, qualifier, expectedArtifactSha256 }) {
  validateFunction(functionName, qualifier);
  if (!/^[0-9a-f]{64}$/u.test(expectedArtifactSha256)) throw new TypeError("expected Lambda artifact digest is invalid");
  const value = parseObject(source, "Lambda function configuration");
  const codeSha256 = base64Sha256ToHex(value.CodeSha256);
  const functionArn = unqualifiedFunctionArn(value.FunctionArn, functionName, qualifier);
  const snapStart = parseSnapStart(value.SnapStart);
  if (value.FunctionName !== functionName || value.Version !== qualifier || value.State !== "Active" || value.LastUpdateStatus !== "Successful" || codeSha256 !== expectedArtifactSha256 || typeof value.Runtime !== "string" || !Array.isArray(value.Architectures) || value.Architectures.length !== 1 || !new Set(["arm64", "x86_64"]).has(value.Architectures[0]) || !Number.isSafeInteger(value.MemorySize) || value.MemorySize < 128 || value.MemorySize > 10240) throw new Error("Lambda function configuration does not match the immutable exercise target");
  return { functionName, functionArn, qualifier, version: value.Version, state: value.State, lastUpdateStatus: value.LastUpdateStatus, codeSha256, runtime: value.Runtime, architecture: value.Architectures[0], snapStart, memorySizeMiB: value.MemorySize };
}

export function parseLambdaFunctionTags(source) {
  const value = parseObject(source, "Lambda function tags");
  if (!value.Tags || typeof value.Tags !== "object" || Array.isArray(value.Tags) || value.Tags.Project !== "eacl-demo" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.Tags.Profile)) throw new Error("Lambda function tags do not bind an EACL demo profile");
  return { project: "eacl-demo", profileId: value.Tags.Profile };
}

export async function invokeLambdaWithReport({ functionName, qualifier, profileId, operation, input, requestId, execFile = defaultExecFile }) {
  validateFunction(functionName, qualifier);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(profileId) || !/^[a-z][a-z0-9-]{0,63}$/u.test(operation) || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(requestId) || !input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Lambda exercise invocation is invalid");
  const directory = await mkdtemp(path.join(tmpdir(), "eacl-demo-lambda-report-"));
  const eventPath = path.join(directory, "event.json");
  const responsePath = path.join(directory, "response.json");
  const method = new Set(["health", "bootstrap"]).has(operation) ? "GET" : "POST";
  const body = method === "POST" ? JSON.stringify(input) : null;
  const event = {
    version: "2.0", routeKey: "$default", rawPath: `/api/v1/${profileId}/${operation}`, rawQueryString: "",
    headers: method === "POST" ? { "content-type": "application/json; charset=utf-8", "x-amz-content-sha256": createHash("sha256").update(body).digest("hex") } : {},
    requestContext: { requestId, http: { method } }, isBase64Encoded: false, body
  };
  try {
    await writeFile(eventPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    const { stdout } = await execFile("aws", ["lambda", "invoke", "--function-name", functionName, "--qualifier", qualifier, "--cli-binary-format", "raw-in-base64-out", "--payload", `fileb://${eventPath}`, "--log-type", "Tail", "--output", "json", responsePath], execOptions());
    const response = await readFile(responsePath, "utf8");
    return parseLambdaInvocation(stdout, response, { qualifier });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function parseLambdaInvocation(metadataSource, responseSource, { qualifier }) {
  if (typeof metadataSource !== "string" || Buffer.byteLength(metadataSource, "utf8") > 65536 || typeof responseSource !== "string" || Buffer.byteLength(responseSource, "utf8") > 1048576) throw new Error("Lambda invocation output is invalid or unbounded");
  const metadata = parseObject(metadataSource, "Lambda invocation metadata");
  if (metadata.StatusCode !== 200 || metadata.FunctionError !== undefined || metadata.ExecutedVersion !== qualifier || typeof metadata.LogResult !== "string") throw new Error("Lambda exercise invocation did not complete on the exact immutable version");
  const functionResponse = parseObject(responseSource, "Lambda function response");
  if (!Number.isSafeInteger(functionResponse.statusCode) || functionResponse.statusCode < 100 || functionResponse.statusCode > 599 || typeof functionResponse.body !== "string") throw new Error("Lambda exercise returned an invalid Function URL response");
  const envelope = parseObject(functionResponse.body, "Lambda Function URL envelope");
  const report = parseLambdaReport(decodeBase64(metadata.LogResult, "Lambda tail log"));
  return { envelope, ...report };
}

export function parseLambdaReport(source) {
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > 4096) throw new Error("Lambda tail log is invalid or unbounded");
  const jsonReports = source.split(/\r?\n/u).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value?.type === "platform.report" && value.record?.metrics ? [value.record.metrics] : [];
    } catch { return []; }
  });
  if (jsonReports.length === 1) {
    const metrics = jsonReports[0];
    return normalizeReport({
      memorySizeMiB: metrics.memorySizeMB,
      maxMemoryUsedMiB: metrics.maxMemoryUsedMB,
      durationMs: metrics.durationMs,
      billedDurationMs: metrics.billedDurationMs,
      initDurationMs: metrics.initDurationMs ?? null,
      restoreDurationMs: metrics.restoreDurationMs ?? null
    });
  }
  if (jsonReports.length > 1) throw new Error("Lambda tail log contains multiple platform reports");
  const reportLines = source.split(/\r?\n/u).filter((line) => /^REPORT\s+RequestId:/u.test(line));
  if (reportLines.length !== 1) throw new Error("Lambda tail log does not contain exactly one REPORT record");
  const line = reportLines[0];
  return normalizeReport({
    durationMs: numberField(line, /Duration:\s*([0-9]+(?:\.[0-9]+)?)\s*ms/u, "duration"),
    billedDurationMs: numberField(line, /Billed Duration:\s*([0-9]+(?:\.[0-9]+)?)\s*ms/u, "billed duration"),
    memorySizeMiB: numberField(line, /Memory Size:\s*([0-9]+)\s*MB/u, "memory size"),
    maxMemoryUsedMiB: numberField(line, /Max Memory Used:\s*([0-9]+)\s*MB/u, "maximum memory"),
    initDurationMs: optionalNumberField(line, /Init Duration:\s*([0-9]+(?:\.[0-9]+)?)\s*ms/u),
    restoreDurationMs: optionalNumberField(line, /(?:^|\s)Restore Duration:\s*([0-9]+(?:\.[0-9]+)?)\s*ms/u)
  });
}

function normalizeReport(value) {
  for (const key of ["memorySizeMiB", "maxMemoryUsedMiB"]) if (!Number.isSafeInteger(value[key]) || value[key] < 1) throw new Error("Lambda REPORT memory values are invalid");
  if (value.memorySizeMiB < 128 || value.memorySizeMiB > 10240 || value.maxMemoryUsedMiB > value.memorySizeMiB) throw new Error("Lambda REPORT memory values are invalid");
  for (const key of ["durationMs", "billedDurationMs"]) if (!Number.isFinite(value[key]) || value[key] < 0) throw new Error("Lambda REPORT duration values are invalid");
  if (value.billedDurationMs < value.durationMs) throw new Error("Lambda REPORT billed duration is invalid");
  if (value.initDurationMs !== null && (!Number.isFinite(value.initDurationMs) || value.initDurationMs < 0)) throw new Error("Lambda REPORT initialization value is invalid");
  if (value.restoreDurationMs !== null && (!Number.isFinite(value.restoreDurationMs) || value.restoreDurationMs < 0)) throw new Error("Lambda REPORT restore value is invalid");
  return value;
}

function parseSnapStart(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Lambda SnapStart configuration is absent");
  if (value.ApplyOn === "None" && value.OptimizationStatus === "Off") return "disabled";
  if (value.ApplyOn === "PublishedVersions" && value.OptimizationStatus === "On") return "enabled";
  throw new Error("Lambda SnapStart configuration is not ready or is invalid");
}

function base64Sha256ToHex(value) {
  if (typeof value !== "string") throw new Error("Lambda CodeSha256 is absent");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")) throw new Error("Lambda CodeSha256 is invalid");
  return bytes.toString("hex");
}

function decodeBase64(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) throw new Error(`${name} is invalid`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64").replace(/=+$/u, "") !== value.replace(/=+$/u, "")) throw new Error(`${name} is invalid`);
  return bytes.toString("utf8");
}

function unqualifiedFunctionArn(value, functionName, qualifier) {
  if (typeof value !== "string") throw new Error("Lambda FunctionArn is absent");
  const suffix = `:function:${functionName}:${qualifier}`;
  if (!/^arn:[a-z0-9-]+:lambda:[a-z0-9-]+:[0-9]{12}:function:/u.test(value) || !value.endsWith(suffix)) throw new Error("Lambda FunctionArn does not match the exact version");
  return value.slice(0, -(`:${qualifier}`.length));
}

function numberField(source, pattern, name) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Lambda REPORT ${name} is absent`);
  return Number(match[1]);
}
function optionalNumberField(source, pattern) { const match = source.match(pattern); return match ? Number(match[1]) : null; }
function parseObject(source, name) { try { const value = JSON.parse(source); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; } catch { throw new Error(`${name} is not a JSON object`); } }
function validateFunction(functionName, qualifier) { if (!/^[A-Za-z0-9-_]{1,64}$/u.test(functionName) || !/^[1-9][0-9]*$/u.test(qualifier)) throw new TypeError("Lambda function/version identity is invalid"); }
function execOptions() { return { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30000, windowsHide: true }; }
