import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { commonQualificationCases } from "../packages/qualification/src/cases.mjs";
import { writeQualificationReports } from "../packages/qualification/src/reports.mjs";
import { runQualification } from "../packages/qualification/src/runner.mjs";
import {
  assertTrustedFunctionUrlOrigin,
  createHttpQualificationTransport,
  qualificationTarget
} from "../packages/qualification/src/targets.mjs";

const root = path.resolve(import.meta.dirname, "..");
const input = closedEnvironment({
  profileId: "EACL_PROFILE_ID",
  baseUrl: "EACL_QUALIFICATION_BASE_URL",
  targetKind: "EACL_QUALIFICATION_TARGET_KIND",
  demoSha: "EACL_DEMO_SHA",
  eaclSha: "EACL_CORE_SHA",
  artifactSha256: "EACL_ARTIFACT_SHA256",
  deploymentId: "EACL_DEPLOYMENT_ID",
  dataManifestSha256: "EACL_DATA_MANIFEST_SHA256",
  outputDirectory: "EACL_QUALIFICATION_OUTPUT"
});

if (!new Set(["local", "direct-function-url"]).has(input.targetKind)) {
  throw new Error("HTTP qualification supports only local or direct-function-url targets");
}
const target = qualificationTarget({
  kind: input.targetKind,
  baseUrl: input.baseUrl,
  profileId: input.profileId
});
if (input.targetKind === "direct-function-url") {
  const definitions = JSON.parse(await readFile(path.join(root, "packages/contracts/profiles.v1.json"), "utf8"));
  const definition = definitions.profiles.find(({ id }) => id === input.profileId);
  if (!definition?.apiOrigin) throw new Error("profile has no deployed Function URL origin in the closed catalog");
  assertTrustedFunctionUrlOrigin(target, definition.apiOrigin);
}
const exemplarCatalogs = new Map(await Promise.all([
  "exemplars.v1.json",
  "legacy-datahike-s3-exemplars.v1.json"
].map(async (name) => {
  const catalog = JSON.parse(await readFile(path.join(root, "fixtures", name), "utf8"));
  if (typeof catalog.fixtureId !== "string" || !Array.isArray(catalog.cases)) {
    throw new Error(`invalid qualification exemplar catalog: ${name}`);
  }
  return [catalog.fixtureId, catalog];
})));
const expectedIdentity = {
  profileId: input.profileId,
  demoSha: input.demoSha,
  eaclSha: input.eaclSha,
  artifactSha256: input.artifactSha256,
  deploymentId: input.deploymentId,
  dataManifestSha256: input.dataManifestSha256
};
const qualification = await runQualification({
  target,
  expectedIdentity,
  cases: (descriptor) => {
    const fixtureId = descriptor.dataset?.fixtureId;
    const exemplars = exemplarCatalogs.get(fixtureId);
    if (!exemplars) throw new Error(`no qualification exemplars are registered for fixture ${fixtureId ?? "unknown"}`);
    if (descriptor.dataset.manifestSha256 !== expectedIdentity.dataManifestSha256) {
      throw new Error("descriptor dataset identity differs from the immutable deployment");
    }
    return commonQualificationCases(exemplars);
  },
  createTransport: (value) => createHttpQualificationTransport(value)
});
const outputDirectory = path.resolve(root, input.outputDirectory);
if (outputDirectory !== root && !outputDirectory.startsWith(`${root}${path.sep}`)) {
  throw new Error("qualification output must stay inside the workspace");
}
const paths = await writeQualificationReports({
  qualification,
  outputDirectory,
  basename: input.profileId
});
process.stdout.write(`${JSON.stringify({ result: qualification.result, paths })}\n`);
if (qualification.result !== "pass") process.exitCode = 1;

function closedEnvironment(mapping) {
  const values = {};
  for (const [key, variable] of Object.entries(mapping)) {
    const value = process.env[variable];
    if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
      throw new Error(`${variable} is required and bounded`);
    }
    values[key] = value;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(values.profileId)) {
    throw new Error("EACL_PROFILE_ID is invalid");
  }
  if (!/^verification\/results\/[a-z0-9][a-z0-9._/-]{0,180}$/u.test(values.outputDirectory) ||
      values.outputDirectory.includes("..")) {
    throw new Error("EACL_QUALIFICATION_OUTPUT is invalid");
  }
  return values;
}
