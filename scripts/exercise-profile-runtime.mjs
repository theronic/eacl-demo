import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runHttpRuntimeExercise, runLambdaMemoryExercise, validateManualRuntimeExercise } from "../packages/qualification/src/manual-exercises.mjs";
import { assertTrustedCloudFrontOrigin, createHttpQualificationTransport, qualificationTarget, reportableTarget } from "../packages/qualification/src/targets.mjs";
import { invokeLambdaWithReport, loadLambdaFunctionConfiguration } from "./lib/lambda-report.mjs";

const root = path.resolve(import.meta.dirname, "..");
const input = environment();
const confirmation = `EXERCISE:${input.exercise}:${input.profileId}:${input.deploymentId}`;
if (input.confirmation !== confirmation) throw new Error(`manual runtime exercise requires exact confirmation ${confirmation}`);
const expectedIdentity = {
  profileId: input.profileId, demoSha: digest(input.demoSha, 40, "EACL_DEMO_SHA"), eaclSha: digest(input.eaclSha, 40, "EACL_CORE_SHA"),
  artifactSha256: digest(input.artifactSha256, 64, "EACL_ARTIFACT_SHA256"), deploymentId: boundedIdentity(input.deploymentId), dataManifestSha256: digest(input.dataManifestSha256, 64, "EACL_DATA_MANIFEST_SHA256")
};
const exemplars = JSON.parse(await readFile(path.join(root, "fixtures/exemplars.v1.json"), "utf8"));
const allowedDemand = exemplar(exemplars, "direct-owner-allow", true);
const deniedDemand = exemplar(exemplars, "direct-owner-deny", false);
const requestPrefix = `manual-${input.runId}-${input.runAttempt}`;
let report;
if (input.exercise === "memory") {
  const configuration = await loadLambdaFunctionConfiguration({ functionName: input.functionName, qualifier: input.functionVersion, expectedArtifactSha256: expectedIdentity.artifactSha256 });
  const target = { kind: "lambda-version", functionArn: configuration.functionArn, qualifier: configuration.qualifier, profileId: input.profileId };
  report = await runLambdaMemoryExercise({
    target, expectedIdentity, functionConfiguration: configuration, allowedDemand, deniedDemand,
    samples: input.samples, minimumHeadroomPercent: input.minimumHeadroomPercent, maximumInitializationMs: input.maximumInitializationMs, maximumRestoreMs: input.maximumRestoreMs, maximumDurationMs: input.maximumDurationMs,
    invoke: ({ operation, input: operationInput, sample }) => invokeLambdaWithReport({ functionName: input.functionName, qualifier: input.functionVersion, profileId: input.profileId, operation, input: operationInput, requestId: `${requestPrefix}-${sample + 1}` })
  });
} else {
  const qualification = qualificationTarget({ kind: "staged-cloudfront", baseUrl: input.baseUrl, profileId: input.profileId });
  assertTrustedCloudFrontOrigin(qualification, input.expectedStagedOrigin);
  const target = reportableTarget(qualification);
  report = await runHttpRuntimeExercise({
    kind: input.exercise, target, expectedIdentity, allowedDemand, deniedDemand,
    requestCount: input.requestCount, concurrency: input.concurrency, requestTimeoutMs: input.requestTimeoutMs, maximumP95Ms: input.maximumP95Ms, maximumErrorRate: input.maximumErrorRate,
    transport: createHttpQualificationTransport(qualification, { requestIdPrefix: requestPrefix, requestTimeoutMs: input.requestTimeoutMs })
  });
}
validateManualRuntimeExercise(report, { requirePassing: false });
const output = outputPath(input.output);
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
await rename(temporary, output);
process.stdout.write(`${JSON.stringify({ result: report.result, exercise: report.exercise, evidenceId: report.evidenceId, output: path.relative(root, output) })}\n`);
if (report.result !== "pass") process.exitCode = 1;

function environment() {
  const exercise = required("EACL_EXERCISE_KIND");
  if (!new Set(["load", "memory", "fault"]).has(exercise)) throw new Error("EACL_EXERCISE_KIND is invalid");
  const profileId = required("EACL_PROFILE_ID");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(profileId)) throw new Error("EACL_PROFILE_ID is invalid");
  const common = {
    exercise, profileId, baseUrl: exercise === "memory" ? null : required("EACL_QUALIFICATION_BASE_URL"), expectedStagedOrigin: exercise === "memory" ? null : required("EACL_EXPECTED_STAGED_ORIGIN"), demoSha: required("EACL_DEMO_SHA"), eaclSha: required("EACL_CORE_SHA"), artifactSha256: required("EACL_ARTIFACT_SHA256"), deploymentId: required("EACL_DEPLOYMENT_ID"), dataManifestSha256: required("EACL_DATA_MANIFEST_SHA256"), confirmation: required("EACL_EXERCISE_CONFIRMATION"), output: required("EACL_EXERCISE_OUTPUT"),
    runId: integer(required("GITHUB_RUN_ID"), 1, Number.MAX_SAFE_INTEGER, "GITHUB_RUN_ID"), runAttempt: integer(required("GITHUB_RUN_ATTEMPT"), 1, 1000, "GITHUB_RUN_ATTEMPT"),
    requestCount: exercise === "load" ? integer(required("EACL_REQUEST_COUNT"), 20, 500, "EACL_REQUEST_COUNT") : 0,
    concurrency: exercise === "load" ? integer(required("EACL_CONCURRENCY"), 1, 8, "EACL_CONCURRENCY") : 1,
    requestTimeoutMs: integer(required("EACL_REQUEST_TIMEOUT_MS"), 100, 10000, "EACL_REQUEST_TIMEOUT_MS"),
    maximumP95Ms: exercise === "load" ? integer(required("EACL_MAXIMUM_P95_MS"), 1, 30000, "EACL_MAXIMUM_P95_MS") : 0,
    maximumErrorRate: exercise === "load" ? decimal(required("EACL_MAXIMUM_ERROR_RATE"), 0, 0.05, "EACL_MAXIMUM_ERROR_RATE") : 0,
    functionName: exercise === "memory" ? required("EACL_FUNCTION_NAME") : "unused",
    functionVersion: exercise === "memory" ? required("EACL_FUNCTION_VERSION") : "1",
    samples: exercise === "memory" ? integer(required("EACL_MEMORY_SAMPLES"), 5, 50, "EACL_MEMORY_SAMPLES") : 5,
    minimumHeadroomPercent: exercise === "memory" ? integer(required("EACL_MINIMUM_HEADROOM_PERCENT"), 20, 80, "EACL_MINIMUM_HEADROOM_PERCENT") : 20,
    maximumInitializationMs: exercise === "memory" ? integer(required("EACL_MAXIMUM_INITIALIZATION_MS"), 1, 30000, "EACL_MAXIMUM_INITIALIZATION_MS") : 30000,
    maximumRestoreMs: exercise === "memory" ? integer(required("EACL_MAXIMUM_RESTORE_MS"), 1, 30000, "EACL_MAXIMUM_RESTORE_MS") : 30000,
    maximumDurationMs: exercise === "memory" ? integer(required("EACL_MAXIMUM_DURATION_MS"), 1, 30000, "EACL_MAXIMUM_DURATION_MS") : 30000
  };
  if (exercise === "memory" && (!/^[A-Za-z0-9-_]{1,64}$/u.test(common.functionName) || !/^[1-9][0-9]*$/u.test(common.functionVersion))) throw new Error("Lambda function/version input is invalid");
  return common;
}

function exemplar(value, id, allowed) { const found = value?.cases?.find((entry) => entry.id === id); if (found?.kind !== "decision" || found.expected?.allowed !== allowed || !found.demand) throw new Error(`canonical exercise exemplar is invalid: ${id}`); return found.demand; }
function required(name) { const value = process.env[name]; if (typeof value !== "string" || value.length < 1 || value.length > 2048 || /[\r\n]/u.test(value)) throw new Error(`${name} is required and bounded`); return value; }
function integer(value, minimum, maximum, name) { if (!/^[0-9]+$/u.test(value)) throw new Error(`${name} is invalid`); const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is invalid`); return parsed; }
function decimal(value, minimum, maximum, name) { if (!/^(?:0|0\.[0-9]+)$/u.test(value)) throw new Error(`${name} is invalid`); const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} is invalid`); return parsed; }
function digest(value, length, name) { if (!new RegExp(`^[0-9a-f]{${length}}$`, "u").test(value)) throw new Error(`${name} is invalid`); return value; }
function boundedIdentity(value) { if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(value)) throw new Error("EACL_DEPLOYMENT_ID is invalid"); return value; }
function outputPath(value) { if (!/^verification\/results\/[a-z0-9][a-z0-9._/-]{0,180}\.json$/u.test(value) || value.includes("..")) throw new Error("EACL_EXERCISE_OUTPUT is invalid"); const resolved = path.resolve(root, value); const allowed = path.join(root, "verification", "results"); if (!resolved.startsWith(`${allowed}${path.sep}`)) throw new Error("exercise output must stay inside verification/results"); return resolved; }
