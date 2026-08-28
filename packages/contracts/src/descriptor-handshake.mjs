export function validateDescriptorHandshake({ registryProfile, route, health, bootstrap }) {
  if (!registryProfile || registryProfile.state !== "enabled" || !registryProfile.deployment) throw identityError("registry profile is not enabled");
  if (route !== registryProfile.route) throw identityError("requested route does not match registry route");
  if (!health || health.status !== "ready" || health.ready !== true) throw identityError("health is not ready");
  if (!bootstrap) throw identityError("bootstrap descriptor is missing");

  const expected = {
    profileId: registryProfile.id,
    demoSha: registryProfile.deployment.demoSha,
    eaclSha: registryProfile.deployment.eaclSha,
    artifactSha256: registryProfile.deployment.artifact.sha256,
    deploymentId: registryProfile.deployment.deploymentId,
    dataManifestSha256: registryProfile.deployment.dataManifestSha256
  };
  assertProfileIdentity(health.identity, expected.profileId, "health");
  assertProfileIdentity(bootstrap.identity, expected.profileId, "bootstrap");
  assertSameIdentity(health.identity, bootstrap.identity);
  if (!bootstrap.profile || bootstrap.profile.backend !== registryProfile.backend || bootstrap.profile.storage !== registryProfile.storage) throw identityError("bootstrap profile mapping mismatch");
  if (health.identity.dataManifestSha256 !== bootstrap.identity.dataManifestSha256) throw identityError("health and bootstrap data identity mismatch");
  if (!health.basis || !bootstrap.basis || health.basis.id !== bootstrap.basis.id || health.basis.behavior !== bootstrap.basis.behavior || health.basis.fixedForEnvironment !== bootstrap.basis.fixedForEnvironment) {
    throw identityError("health and bootstrap basis identity mismatch");
  }
  if (bootstrap.dataset.manifestSha256 !== bootstrap.identity.dataManifestSha256) throw identityError("bootstrap dataset identity mismatch");

  const identityWarning = deploymentIdentityWarning(expected, health.identity);
  return {
    profileId: expected.profileId,
    route,
    contract: structuredClone(bootstrap.contract),
    deployment: {
      demoSha: health.identity.demoSha,
      eaclSha: health.identity.eaclSha,
      artifactSha256: health.identity.artifactSha256,
      deploymentId: health.identity.deploymentId
    },
    dataManifestSha256: bootstrap.identity.dataManifestSha256,
    basis: structuredClone(bootstrap.basis),
    profile: structuredClone(bootstrap.profile),
    runtime: structuredClone(bootstrap.runtime),
    capabilities: structuredClone(bootstrap.capabilities),
    limits: structuredClone(bootstrap.limits),
    dataset: structuredClone(bootstrap.dataset),
    identityWarning
  };
}

const IDENTITY_FIELDS = Object.freeze([
  "profileId",
  "demoSha",
  "eaclSha",
  "artifactSha256",
  "deploymentId",
  "dataManifestSha256"
]);
const DEPLOYMENT_FIELDS = Object.freeze(IDENTITY_FIELDS.filter((field) => field !== "profileId"));

function assertProfileIdentity(actual, profileId, source) {
  if (!actual || IDENTITY_FIELDS.some((field) => typeof actual[field] !== "string") || actual.profileId !== profileId) {
    throw identityError(`${source} profile identity does not match registry`);
  }
}

function assertSameIdentity(healthIdentity, bootstrapIdentity) {
  if (IDENTITY_FIELDS.some((field) => healthIdentity[field] !== bootstrapIdentity[field])) {
    throw identityError("health and bootstrap service identity mismatch");
  }
}

function deploymentIdentityWarning(expected, actual) {
  const differences = DEPLOYMENT_FIELDS
    .filter((field) => expected[field] !== actual[field])
    .map((field) => ({ field, expected: expected[field], actual: actual[field] }));
  if (differences.length === 0) return null;
  return {
    code: "deployment-identity-drift",
    message: differences.some(({ field }) => field === "eaclSha")
      ? "The service is running an out-of-date EACL version."
      : "The service deployment differs from the published registry version.",
    expected: structuredClone(expected),
    actual: structuredClone(actual),
    differences
  };
}

function identityError(message) {
  const error = new Error(message);
  error.code = "identity-mismatch";
  return error;
}
