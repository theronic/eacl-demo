import path from "node:path";
import process from "node:process";

import { verifyCheckedOutIdentity } from "./lib/checked-out-identity.mjs";
import { verifyOrdinaryArtifact } from "./lib/ordinary-artifact.mjs";
import { ordinaryTargetDefinitions } from "./lib/ordinary-workflow.mjs";

const root = path.resolve(import.meta.dirname, "..");
const [target, input] = process.argv.slice(2);
if (!ordinaryTargetDefinitions[target] || !input || path.isAbsolute(input)) throw new Error("usage: node scripts/verify-ordinary-artifact.mjs <registered-target> <repository-relative-directory>");
const directory = path.resolve(root, input);
if (!directory.startsWith(`${root}${path.sep}`)) throw new Error("ordinary artifact directory escapes the repository");
const identity = verifyCheckedOutIdentity(root, process.env.GITHUB_SHA);
const manifest = await verifyOrdinaryArtifact({
  directory,
  expectedTarget: target,
  expectedDemoSha: identity.demoSha,
  expectedEaclSha: identity.eaclSha,
  expectedArtifactSha256: process.env.EACL_EXPECTED_ARTIFACT_SHA256
});
process.stdout.write(`${manifest.target}\t${manifest.artifactSha256}\tverified\n`);
