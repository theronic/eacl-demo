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
  assertIdentityPrefix(health.identity, expected, "health");
  assertIdentityPrefix(bootstrap.identity, expected, "bootstrap");
  if (!bootstrap.profile || bootstrap.profile.backend !== registryProfile.backend || bootstrap.profile.storage !== registryProfile.storage) throw identityError("bootstrap profile mapping mismatch");
  if (health.identity.dataManifestSha256 !== bootstrap.identity.dataManifestSha256) throw identityError("health and bootstrap data identity mismatch");
  if (!health.basis || !bootstrap.basis || health.basis.id !== bootstrap.basis.id || health.basis.behavior !== bootstrap.basis.behavior || health.basis.fixedForEnvironment !== bootstrap.basis.fixedForEnvironment) {
    throw identityError("health and bootstrap basis identity mismatch");
  }
  if (bootstrap.dataset.manifestSha256 !== bootstrap.identity.dataManifestSha256) throw identityError("bootstrap dataset identity mismatch");

  return {
    profileId: expected.profileId,
    route,
    contract: structuredClone(bootstrap.contract),
    deployment: { demoSha: expected.demoSha, eaclSha: expected.eaclSha, artifactSha256: expected.artifactSha256, deploymentId: expected.deploymentId },
    dataManifestSha256: bootstrap.identity.dataManifestSha256,
    basis: structuredClone(bootstrap.basis),
    profile: structuredClone(bootstrap.profile),
    runtime: structuredClone(bootstrap.runtime),
    capabilities: structuredClone(bootstrap.capabilities),
    limits: structuredClone(bootstrap.limits),
    dataset: structuredClone(bootstrap.dataset)
  };
}

function assertIdentityPrefix(actual, expected, source) {
  if (!actual || Object.entries(expected).some(([key, value]) => actual[key] !== value)) throw identityError(`${source} identity does not match registry`);
}

function identityError(message) {
  const error = new Error(message);
  error.code = "identity-mismatch";
  return error;
}
