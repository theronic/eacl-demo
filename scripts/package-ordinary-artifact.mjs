import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createOrdinaryArtifact, verifyOrdinaryArtifact } from "./lib/ordinary-artifact.mjs";
import { verifyCheckedOutIdentity } from "./lib/checked-out-identity.mjs";
import { eligibleOrdinaryTargets, ordinaryTargetDefinitions } from "./lib/ordinary-workflow.mjs";

const root = path.resolve(import.meta.dirname, "..");
const target = process.argv[2];
const definition = ordinaryTargetDefinitions[target];
if (!definition) throw new Error("usage: node scripts/package-ordinary-artifact.mjs <registered-target>");
const buildUnits = JSON.parse(await readFile(path.join(root, "build-units.json"), "utf8"));
if (!eligibleOrdinaryTargets(buildUnits).includes(target)) throw new Error(`ordinary target is not fully deployment-eligible: ${target}`);
const demoSha = process.env.GITHUB_SHA;
const identity = verifyCheckedOutIdentity(root, demoSha);
const output = path.join(root, "dist", "ordinary-artifacts", target);
await mkdir(path.dirname(output), { recursive: true });
await rm(output, { recursive: true, force: true });
const manifest = await createOrdinaryArtifact({
  target,
  demoSha: identity.demoSha,
  eaclSha: identity.eaclSha,
  source: path.join(root, definition.payloadPath),
  output
});
await verifyOrdinaryArtifact({
  directory: output,
  expectedTarget: target,
  expectedDemoSha: identity.demoSha,
  expectedEaclSha: identity.eaclSha,
  expectedArtifactSha256: manifest.artifactSha256
});
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, [
    `artifact_name=${manifest.artifactName}`,
    `artifact_sha256=${manifest.artifactSha256}`,
    `artifact_path=dist/ordinary-artifacts/${target}`,
    ""
  ].join("\n"));
}
process.stdout.write(`${manifest.artifactName}\n`);
