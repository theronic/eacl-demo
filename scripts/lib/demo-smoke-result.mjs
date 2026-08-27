const SHA256 = /^[0-9a-f]{64}$/u;
const DEPLOYMENT_KEYS = ["profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId"];
const META_KEYS = new Set(["revision", "requestId", "elapsedMs", "cacheStatus"]);
const CACHE_STATUSES = new Set(["hit", "miss", "disabled"]);

export function validateDemoSmokeEnvelope(envelope) {
  if (!plainObject(envelope) || !plainObject(envelope.meta)) throw new Error("demo smoke envelope is invalid");
  const success = Object.hasOwn(envelope, "data") && !Object.hasOwn(envelope, "error");
  const failure = Object.hasOwn(envelope, "error") && !Object.hasOwn(envelope, "data");
  if ((!success && !failure) || Object.keys(envelope).length !== 2) throw new Error("demo smoke envelope shape is invalid");
  const metaKeys = Object.keys(envelope.meta);
  if (!metaKeys.every((key) => META_KEYS.has(key)) ||
      typeof envelope.meta.revision !== "string" || envelope.meta.revision.length < 1 || envelope.meta.revision.length > 256 ||
      typeof envelope.meta.requestId !== "string" || envelope.meta.requestId.length < 1 || envelope.meta.requestId.length > 128 ||
      (envelope.meta.elapsedMs !== undefined && (!Number.isFinite(envelope.meta.elapsedMs) || envelope.meta.elapsedMs < 0)) ||
      (envelope.meta.cacheStatus !== undefined && !CACHE_STATUSES.has(envelope.meta.cacheStatus))) {
    throw new Error("demo smoke response metadata is invalid");
  }
  if (success && !plainObject(envelope.data)) throw new Error("demo smoke response data is invalid");
  if (failure && (!plainObject(envelope.error) ||
      JSON.stringify(Object.keys(envelope.error).sort()) !== JSON.stringify(["code", "message"]) ||
      typeof envelope.error.code !== "string" || envelope.error.code.length < 1 || envelope.error.code.length > 128 ||
      typeof envelope.error.message !== "string" || envelope.error.message.length < 1 || envelope.error.message.length > 512)) {
    throw new Error("demo smoke response error is invalid");
  }
  return envelope;
}

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

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
