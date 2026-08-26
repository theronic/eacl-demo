const SHA256 = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_KEYS = ["profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId"];

export function summarizeDemoSmoke({ profileId, expectedIdentity, health, bootstrap, decisions, mutation }) {
  const healthIdentity = health?.envelope?.data?.identity;
  const bootstrapData = bootstrap?.envelope?.data;
  const bootstrapIdentity = bootstrapData?.identity;
  const dataManifestSha = bootstrapIdentity?.dataManifestSha256;

  for (const [source, identity] of [["health", healthIdentity], ["bootstrap", bootstrapIdentity]]) {
    if (DEPLOYMENT_KEYS.some((key) => identity?.[key] !== expectedIdentity?.[key])) {
      throw new Error(`${profileId} ${source} deployment identity differs from the candidate`);
    }
  }
  if (!SHA256.test(dataManifestSha ?? "")) {
    throw new Error(`${profileId} smoke data manifest identity is invalid`);
  }
  if (healthIdentity?.dataManifestSha256 !== dataManifestSha) {
    throw new Error(`${profileId} health and bootstrap data manifests differ`);
  }
  if (bootstrapData?.dataset?.manifestSha256 !== dataManifestSha) {
    throw new Error(`${profileId} bootstrap dataset manifest differs from its identity`);
  }

  return {
    dataManifestSha,
    evidence: JSON.stringify([health, bootstrap, ...decisions, mutation])
  };
}
