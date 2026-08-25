import { createHash } from "node:crypto";

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

export function validateCoreLock(lock) {
  exactKeys(lock, ["schema", "repository", "sha", "modules", "reachability", "identityRule"], "Core lock");
  invariant(lock.schema === "eacl-demo.eacl-core-lock.v1", "Unsupported Core lock schema");
  invariant(lock.repository === "https://github.com/theronic/eacl.git", "Core lock repository is not canonical");
  invariant(SHA1.test(lock.sha), "Core lock sha must be a lowercase 40-hex commit");
  invariant(Array.isArray(lock.modules) && lock.modules.length > 0, "Core lock modules must be non-empty");
  invariant(new Set(lock.modules).size === lock.modules.length, "Core lock modules must be unique");
  exactKeys(lock.reachability, ["verifiedAt", "remoteRef", "observedTip", "method"], "Core lock reachability");
  invariant(lock.reachability.remoteRef.startsWith("refs/"), "Reachability proof must name a full ref");
  invariant(lock.reachability.observedTip === lock.sha, "Reachability observed tip must equal the locked sha");
  invariant(!Number.isNaN(Date.parse(lock.reachability.verifiedAt)), "Reachability verification time must be ISO-8601");
  invariant(lock.identityRule.includes("Only sha"), "Core lock must state that only sha is a release identity");
  return lock;
}

export function createDeploymentManifest({ demoSha, coreLock, coreLockBytes, generatedAt, artifacts = [], profiles = [] }) {
  validateCoreLock(coreLock);
  invariant(SHA1.test(demoSha), "demoSha must be a lowercase 40-hex commit");
  invariant(Buffer.isBuffer(coreLockBytes) || coreLockBytes instanceof Uint8Array, "coreLockBytes must contain the committed lock bytes");
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
    deploymentId: `${demoSha.slice(0, 12)}-${coreLock.sha.slice(0, 12)}`,
    generatedAt,
    demo: {
      repository: "https://github.com/theronic/eacl-demo.git",
      sha: demoSha,
    },
    eacl: {
      repository: coreLock.repository,
      sha: coreLock.sha,
      lock: {
        path: "dependencies/eacl-core.lock.json",
        sha256: sha256(coreLockBytes),
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
  exactKeys(manifest.eacl, ["repository", "sha", "lock"], "EACL source");
  invariant(manifest.eacl.repository === "https://github.com/theronic/eacl.git", "EACL repository is not canonical");
  invariant(SHA1.test(manifest.eacl.sha), "EACL sha is invalid");
  exactKeys(manifest.eacl.lock, ["path", "sha256", "committedAtDemoSha"], "EACL lock binding");
  invariant(manifest.eacl.lock.path === "dependencies/eacl-core.lock.json", "EACL lock path is invalid");
  invariant(SHA256.test(manifest.eacl.lock.sha256), "EACL lock digest is invalid");
  invariant(manifest.eacl.lock.committedAtDemoSha === true, "EACL lock must be committed at demo sha");
  invariant(manifest.deploymentId === `${manifest.demo.sha.slice(0, 12)}-${manifest.eacl.sha.slice(0, 12)}`, "Deployment ID does not match source pair");
  invariant(Array.isArray(manifest.artifacts), "Artifacts must be an array");
  invariant(Array.isArray(manifest.profiles) && manifest.profiles.every((profile) => PROFILE_ID.test(profile)), "Profiles are invalid");
  return manifest;
}
