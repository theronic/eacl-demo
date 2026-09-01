import { createHash } from "node:crypto";
import { DEPS_EDN_PATH, EACL_REPOSITORY } from "./eacl-core.mjs";

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  invariant(JSON.stringify(actual) === JSON.stringify(wanted), `${label} keys must be exactly: ${wanted.join(", ")}`);
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateCoreIdentity(core) {
  exactKeys(core, ["repository", "sha", "modules"], "Core identity");
  invariant(core.repository === EACL_REPOSITORY, "Core repository is not canonical");
  invariant(SHA1.test(core.sha), "Core sha must be a lowercase 40-hex commit");
  invariant(Array.isArray(core.modules) && core.modules.length > 0, "Core modules must be non-empty");
  invariant(new Set(core.modules).size === core.modules.length, "Core modules must be unique");
  return core;
}

export function createDeploymentManifest({ demoSha, core, depsEdnBytes, generatedAt, artifacts = [], profiles = [] }) {
  validateCoreIdentity(core);
  invariant(SHA1.test(demoSha), "demoSha must be a lowercase 40-hex commit");
  invariant(Buffer.isBuffer(depsEdnBytes) || depsEdnBytes instanceof Uint8Array, "depsEdnBytes must contain the committed deps.edn bytes");
  invariant(!Number.isNaN(Date.parse(generatedAt)), "generatedAt must be ISO-8601");
  invariant(Array.isArray(artifacts), "artifacts must be an array");
  invariant(Array.isArray(profiles) && profiles.every((profile) => PROFILE_ID.test(profile)), "profiles must contain closed kebab-case IDs");
  invariant(new Set(profiles).size === profiles.length, "profiles must be unique");
  for (const artifact of artifacts) {
    exactKeys(artifact, ["name", "sha256"], "Artifact");
    invariant(typeof artifact.name === "string" && artifact.name.length > 0 && artifact.name.length <= 128, "Artifact name is invalid");
    invariant(SHA256.test(artifact.sha256), "Artifact sha256 must be lowercase 64-hex");
  }
  return {
    schema: "eacl-demo.deployment-manifest.v1",
    contractVersion: "explorer.v1",
    deploymentId: `${demoSha.slice(0, 12)}-${core.sha.slice(0, 12)}`,
    generatedAt,
    demo: {
      repository: "https://github.com/theronic/eacl-demo.git",
      sha: demoSha,
    },
    eacl: {
      repository: core.repository,
      sha: core.sha,
      pin: {
        path: DEPS_EDN_PATH,
        sha256: sha256(depsEdnBytes),
        committedAtDemoSha: true,
      },
    },
    artifacts,
    profiles,
  };
}

export function validateDeploymentManifest(manifest) {
  exactKeys(manifest, ["schema", "contractVersion", "deploymentId", "generatedAt", "demo", "eacl", "artifacts", "profiles"], "Deployment manifest");
  invariant(manifest.schema === "eacl-demo.deployment-manifest.v1", "Unsupported deployment manifest schema");
  invariant(manifest.contractVersion === "explorer.v1", "Unsupported explorer contract");
  invariant(/^[0-9a-f]{12}-[0-9a-f]{12}$/u.test(manifest.deploymentId), "Deployment ID is invalid");
  invariant(!Number.isNaN(Date.parse(manifest.generatedAt)), "Deployment generatedAt is invalid");
  exactKeys(manifest.demo, ["repository", "sha"], "Demo source");
  invariant(manifest.demo.repository === "https://github.com/theronic/eacl-demo.git", "Demo repository is not canonical");
  invariant(SHA1.test(manifest.demo.sha), "Demo sha is invalid");
  exactKeys(manifest.eacl, ["repository", "sha", "pin"], "EACL source");
  invariant(manifest.eacl.repository === EACL_REPOSITORY, "EACL repository is not canonical");
  invariant(SHA1.test(manifest.eacl.sha), "EACL sha is invalid");
  exactKeys(manifest.eacl.pin, ["path", "sha256", "committedAtDemoSha"], "EACL pin binding");
  invariant(manifest.eacl.pin.path === DEPS_EDN_PATH, "EACL pin path is invalid");
  invariant(SHA256.test(manifest.eacl.pin.sha256), "EACL pin digest is invalid");
  invariant(manifest.eacl.pin.committedAtDemoSha === true, "EACL pin must be committed at demo sha");
  invariant(manifest.deploymentId === `${manifest.demo.sha.slice(0, 12)}-${manifest.eacl.sha.slice(0, 12)}`, "Deployment ID does not match source pair");
  invariant(Array.isArray(manifest.artifacts), "Artifacts must be an array");
  invariant(Array.isArray(manifest.profiles) && manifest.profiles.every((profile) => PROFILE_ID.test(profile)), "Profiles are invalid");
  return manifest;
}
