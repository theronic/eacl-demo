import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runProductionRecheck } from "../packages/qualification/src/production-recheck.mjs";
import {
  assertTrustedCloudFrontOrigin,
  createHttpQualificationTransport,
  qualificationTarget,
  reportableTarget
} from "../packages/qualification/src/targets.mjs";

const root = path.resolve(import.meta.dirname, "..");
const input = closedEnvironment({
  profileId: "EACL_PROFILE_ID",
  baseUrl: "EACL_PRODUCTION_BASE_URL",
  demoSha: "EACL_DEMO_SHA",
  eaclSha: "EACL_CORE_SHA",
  artifactSha256: "EACL_ARTIFACT_SHA256",
  deploymentId: "EACL_DEPLOYMENT_ID",
  dataManifestSha256: "EACL_DATA_MANIFEST_SHA256",
  output: "EACL_PRODUCTION_RECHECK_OUTPUT",
  expectedProductionOrigin: "EACL_EXPECTED_PRODUCTION_ORIGIN"
});
const target = qualificationTarget({ kind: "production-cloudfront", baseUrl: input.baseUrl, profileId: input.profileId });
assertTrustedCloudFrontOrigin(target, input.expectedProductionOrigin);
const expectedIdentity = {
  profileId: input.profileId,
  demoSha: digest(input.demoSha, 40, "EACL_DEMO_SHA"),
  eaclSha: digest(input.eaclSha, 40, "EACL_CORE_SHA"),
  artifactSha256: digest(input.artifactSha256, 64, "EACL_ARTIFACT_SHA256"),
  deploymentId: boundedIdentity(input.deploymentId),
  dataManifestSha256: digest(input.dataManifestSha256, 64, "EACL_DATA_MANIFEST_SHA256")
};
const transport = createHttpQualificationTransport(target);
let report;
try {
  report = await runProductionRecheck({ transport, expectedIdentity, target: reportableTarget(target) });
} finally {
  await transport.release();
}
const output = resolveOutput(input.output);
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
await rename(temporary, output);
process.stdout.write(`${JSON.stringify({ result: report.result, evidenceId: report.evidenceId, output: path.relative(root, output) })}\n`);
if (report.result !== "pass") process.exitCode = 1;

function closedEnvironment(mapping) {
  const values = {};
  for (const [key, variable] of Object.entries(mapping)) {
    const value = process.env[variable];
    if (typeof value !== "string" || value.length === 0 || value.length > 2048) throw new Error(`${variable} is required and bounded`);
    values[key] = value;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(values.profileId)) throw new Error("EACL_PROFILE_ID is invalid");
  return values;
}

function digest(value, length, name) {
  if (!new RegExp(`^[0-9a-f]{${length}}$`, "u").test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function boundedIdentity(value) {
  if (new TextEncoder().encode(value).length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value)) throw new Error("EACL_DEPLOYMENT_ID is invalid");
  return value;
}

function resolveOutput(value) {
  if (!/^verification\/results\/[a-z0-9][a-z0-9._/-]{0,180}\.json$/u.test(value) || value.includes("..")) throw new Error("EACL_PRODUCTION_RECHECK_OUTPUT is invalid");
  const resolved = path.resolve(root, value);
  const allowedRoot = path.join(root, "verification", "results");
  if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) throw new Error("production recheck output must stay inside verification/results");
  return resolved;
}
