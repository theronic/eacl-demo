import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runMergeSmoke } from "../packages/qualification/src/merge-smoke.mjs";
import { assertTrustedCloudFrontOrigin, createHttpQualificationTransport, qualificationTarget, reportableTarget } from "../packages/qualification/src/targets.mjs";

const root = path.resolve(import.meta.dirname, "..");
const profileId = required("EACL_PROFILE_ID");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(profileId)) throw new Error("EACL_PROFILE_ID is invalid");
const phase = required("EACL_TRANSITION_PHASE");
if (!new Set(["target", "restore"]).has(phase)) throw new Error("EACL_TRANSITION_PHASE is invalid");
const expectedIdentity = identity(JSON.parse(required("EACL_TRANSITION_IDENTITY_JSON")), profileId);
const target = qualificationTarget({ kind: "staged-cloudfront", baseUrl: required("EACL_TRANSITION_BASE_URL"), profileId });
assertTrustedCloudFrontOrigin(target, required("EACL_EXPECTED_STAGED_ORIGIN"));
const exemplars = JSON.parse(await readFile(path.join(root, "fixtures/exemplars.v1.json"), "utf8"));
const transport = createHttpQualificationTransport(target, { requestIdPrefix: `transition-${required("GITHUB_RUN_ID")}-${required("GITHUB_RUN_ATTEMPT")}-${phase}`, requestTimeoutMs: 10000 });
let report;
try {
  report = await runMergeSmoke({ transport, expectedIdentity, target: reportableTarget(target), allowedDemand: exemplar(exemplars, "direct-owner-allow", true), deniedDemand: exemplar(exemplars, "direct-owner-deny", false) });
} finally {
  await transport.release();
}
const output = outputPath(required("EACL_TRANSITION_OUTPUT"));
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
await writeFile(temporary, `${JSON.stringify({ schema: "eacl-demo.manual-transition-smoke.v1", phase, mergeSmoke: report }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
await rename(temporary, output);
process.stdout.write(`${JSON.stringify({ result: report.result, phase, evidenceId: report.evidenceId, output: path.relative(root, output) })}\n`);
if (report.result !== "pass") process.exitCode = 1;

function identity(value, expectedProfileId) {
  const keys = ["profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId", "dataManifestSha256"];
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort()) || value.profileId !== expectedProfileId || !/^[0-9a-f]{40}$/u.test(value.demoSha) || !/^[0-9a-f]{40}$/u.test(value.eaclSha) || !/^[0-9a-f]{64}$/u.test(value.artifactSha256) || !/^[0-9a-f]{64}$/u.test(value.dataManifestSha256) || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(value.deploymentId)) throw new Error("transition identity is invalid");
  return value;
}
function exemplar(value, id, allowed) { const found = value?.cases?.find((entry) => entry.id === id); if (found?.kind !== "decision" || found.expected?.allowed !== allowed || !found.demand) throw new Error(`canonical transition exemplar is invalid: ${id}`); return found.demand; }
function required(name) { const value = process.env[name]; if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /[\r\n]/u.test(value)) throw new Error(`${name} is required and bounded`); return value; }
function outputPath(value) { if (!/^verification\/results\/[a-z0-9][a-z0-9._/-]{0,180}\.json$/u.test(value) || value.includes("..")) throw new Error("EACL_TRANSITION_OUTPUT is invalid"); const resolved = path.resolve(root, value); const allowed = path.join(root, "verification", "results"); if (!resolved.startsWith(`${allowed}${path.sep}`)) throw new Error("transition output must stay inside verification/results"); return resolved; }
