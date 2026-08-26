import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runMergeSmoke } from "../packages/qualification/src/merge-smoke.mjs";
import {
  assertTrustedCloudFrontOrigin,
  createHttpQualificationTransport,
  qualificationTarget,
  reportableTarget
} from "../packages/qualification/src/targets.mjs";

const root = path.resolve(import.meta.dirname, "..");
const input = closedEnvironment({
  profileId: "EACL_PROFILE_ID",
  baseUrl: "EACL_CANDIDATE_BASE_URL",
  demoSha: "EACL_DEMO_SHA",
  eaclSha: "EACL_CORE_SHA",
  artifactSha256: "EACL_ARTIFACT_SHA256",
  deploymentId: "EACL_DEPLOYMENT_ID",
  dataManifestSha256: "EACL_DATA_MANIFEST_SHA256",
  output: "EACL_MERGE_SMOKE_OUTPUT",
  expectedStagedOrigin: "EACL_EXPECTED_STAGED_ORIGIN"
});
const target = qualificationTarget({
  kind: "staged-cloudfront",
  baseUrl: input.baseUrl,
  profileId: input.profileId
});
assertTrustedCloudFrontOrigin(target, input.expectedStagedOrigin);
const expectedIdentity = {
  profileId: input.profileId,
  demoSha: sha1(input.demoSha, "EACL_DEMO_SHA"),
  eaclSha: sha1(input.eaclSha, "EACL_CORE_SHA"),
  artifactSha256: sha256(input.artifactSha256, "EACL_ARTIFACT_SHA256"),
  deploymentId: boundedIdentity(input.deploymentId),
  dataManifestSha256: sha256(input.dataManifestSha256, "EACL_DATA_MANIFEST_SHA256")
};
const exemplars = JSON.parse(await readFile(path.join(root, "fixtures/exemplars.v1.json"), "utf8"));
const allowedDemand = demand(exemplars, "direct-owner-allow", true);
const deniedDemand = demand(exemplars, "direct-owner-deny", false);
const transport = createHttpQualificationTransport(target);
let report;
try {
  report = await runMergeSmoke({
    transport,
    expectedIdentity,
    target: reportableTarget(target),
    allowedDemand,
    deniedDemand
  });
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

function demand(exemplars, id, allowed) {
  const exemplar = exemplars?.cases?.find((candidate) => candidate.id === id);
  if (exemplar?.kind !== "decision" || exemplar.expected?.allowed !== allowed || !exemplar.demand) throw new Error(`canonical merge-smoke exemplar is invalid: ${id}`);
  return exemplar.demand;
}

function sha1(value, name) {
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${name} must be a lowercase SHA-1`);
  return value;
}

function sha256(value, name) {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${name} must be a lowercase SHA-256`);
  return value;
}

function boundedIdentity(value) {
  if (new TextEncoder().encode(value).length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value)) throw new Error("EACL_DEPLOYMENT_ID is invalid");
  return value;
}

function resolveOutput(value) {
  if (!/^verification\/results\/[a-z0-9][a-z0-9._/-]{0,180}\.json$/u.test(value) || value.includes("..")) throw new Error("EACL_MERGE_SMOKE_OUTPUT is invalid");
  const resolved = path.resolve(root, value);
  const allowedRoot = path.join(root, "verification", "results");
  if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) throw new Error("merge-smoke output must stay inside verification/results");
  return resolved;
}
