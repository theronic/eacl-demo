const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

export function createReleaseManifest({ demoSha, eaclSha, fixture, deployment, artifacts }) {
  invariant(SHA1.test(demoSha), "demo SHA must be exact lowercase 40-hex");
  invariant(SHA1.test(eaclSha), "EACL SHA must be exact lowercase 40-hex");
  exactKeys(fixture, ["id", "manifestSha256"], "fixture");
  invariant(ID.test(fixture.id), "fixture ID is invalid");
  invariant(SHA256.test(fixture.manifestSha256), "fixture manifest digest is invalid");
  exactKeys(deployment, ["provider", "repositoryId", "runId", "runAttempt", "ref"], "deployment input");
  invariant(deployment.provider === "github-actions", "deployment provider must be github-actions");
  invariant(deployment.repositoryId === "1345904214", "deployment repository ID is not canonical");
  invariant(/^[1-9][0-9]*$/u.test(deployment.runId), "GitHub run ID is invalid");
  invariant(Number.isSafeInteger(deployment.runAttempt) && deployment.runAttempt >= 1, "GitHub run attempt is invalid");
  invariant(deployment.ref === "refs/heads/demos", "release ref must be refs/heads/demos");
  invariant(Array.isArray(artifacts) && artifacts.length > 0, "artifacts must be non-empty");
  for (const artifact of artifacts) {
    exactKeys(artifact, ["name", "path", "sha256", "bytes"], "artifact");
    invariant(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(artifact.name), "artifact name is invalid");
    invariant(artifact.path === `dist/${artifact.name}/artifact.json`, "artifact path does not match name");
    invariant(SHA256.test(artifact.sha256), "artifact digest is invalid");
    invariant(Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0, "artifact size is invalid");
  }
  invariant(new Set(artifacts.map(({ name }) => name)).size === artifacts.length, "artifact names must be unique");

  return {
    schema: "eacl-demo.release-manifest.v1",
    contractVersion: "explorer.v1",
    source: {
      demo: { repository: "https://github.com/theronic/eacl-demo.git", sha: demoSha },
      eacl: { repository: "https://github.com/theronic/eacl.git", sha: eaclSha }
    },
    fixture,
    deployment: {
      ...deployment,
      identity: `${deployment.repositoryId}:${deployment.runId}:${deployment.runAttempt}:${demoSha}`
    },
    artifacts
  };
}

export function validateReleaseManifest(manifest) {
  exactKeys(manifest, ["schema", "contractVersion", "source", "fixture", "deployment", "artifacts"], "release manifest");
  invariant(manifest.schema === "eacl-demo.release-manifest.v1", "unsupported release manifest");
  invariant(manifest.contractVersion === "explorer.v1", "unsupported contract version");
  const { identity, ...deployment } = manifest.deployment;
  const recreated = createReleaseManifest({
    demoSha: manifest.source?.demo?.sha,
    eaclSha: manifest.source?.eacl?.sha,
    fixture: manifest.fixture,
    deployment,
    artifacts: manifest.artifacts
  });
  invariant(identity === recreated.deployment.identity, "deployment identity mismatch");
  invariant(JSON.stringify(recreated) === JSON.stringify(manifest), "release manifest is not canonical");
  return manifest;
}

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  invariant(JSON.stringify(actual) === JSON.stringify(wanted), `${label} keys must be exactly: ${wanted.join(", ")}`);
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
