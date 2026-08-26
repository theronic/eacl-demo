import { selectDefaultStorage } from "./default-storage.mjs";
import { isEvidenceCurrent, validateFastestEvidence } from "./fastest-evidence.mjs";
import { containsLatestClaim, validateProfileEntry } from "./profile-entry.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;

export { canonicalProfileRoute, validateProfileEntry } from "./profile-entry.mjs";

export function validateProfileRegistry(registry, profileDefinitions, { evidenceRecords = [], now = new Date() } = {}) {
  exactKeys(registry, ["$schema", "schema", "contractVersion", "benchmarkEvidence", "storageDefaults", "profiles"], "registry");
  if (registry.schema !== "eacl-demo.profile-registry.v1" || registry.contractVersion !== "explorer.v1") throw new Error("unsupported registry contract");
  const definitions = new Map(profileDefinitions.profiles.map((profile) => [profile.id, profile]));
  if (registry.profiles.length !== definitions.size) throw new Error("registry must contain every profile exactly once");
  const seen = new Set();
  for (const profile of registry.profiles) {
    const definition = definitions.get(profile.id);
    if (!definition || seen.has(profile.id)) throw new Error(`profile mapping is not canonical: ${profile.id}`);
    seen.add(profile.id);
    validateProfileEntry(profile, definition);
  }

  const normalizedEvidence = evidenceRecords.map(normalizeEvidenceRecord);
  const expectedSummaries = normalizedEvidence.map(evidenceSummary).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  if (JSON.stringify(registry.benchmarkEvidence) !== JSON.stringify(expectedSummaries)) throw new Error("registry benchmark evidence summaries do not match published evidence files");
  const expectedDefaults = deriveStorageDefaults(registry.profiles, profileDefinitions, normalizedEvidence, now);
  if (JSON.stringify(registry.storageDefaults) !== JSON.stringify(expectedDefaults)) throw new Error("registry storage defaults do not match qualified profiles and comparable evidence");
  if (containsLatestClaim(registry)) throw new Error("registry must not claim latest source or fleet convergence");
  return registry;
}

export function deriveStorageDefaults(profiles, profileDefinitions, evidenceRecords = [], now = new Date()) {
  const backends = [...new Set(profileDefinitions.profiles.map(({ backend }) => backend))];
  return backends.map((backend) => {
    const evidence = evidenceRecords
      .map((record) => record.evidence)
      .filter((candidate) => candidate.backend === backend && isEvidenceCurrent(candidate, now) && evidenceMatchesActiveDeployments(candidate, profiles))
      .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt))[0] ?? null;
    return {
      ...selectDefaultStorage({ backend, profileDefinitions, availability: { profiles }, evidence, now }),
      backend
    };
  });
}

function evidenceMatchesActiveDeployments(evidence, profiles) {
  const active = new Map(profiles.filter(({ state, deployment }) => state === "enabled" && deployment).map((profile) => [profile.id, profile.deployment]));
  if (evidence.profiles.some((id) => !active.has(id))) return false;
  return evidence.candidates.every((candidate) => {
    const deployment = active.get(candidate.profileId);
    return deployment
      && candidate.demoSha === deployment.demoSha
      && candidate.eaclSha === deployment.eaclSha
      && candidate.artifactDigest === `sha256:${deployment.artifact.sha256}`
      && candidate.deploymentId === deployment.deploymentId
      && candidate.dataManifestDigest === `sha256:${deployment.dataManifestSha256}`;
  });
}

export function evidenceSummary(record) {
  return {
    evidenceId: record.evidence.evidenceId,
    backend: record.evidence.backend,
    profiles: record.evidence.profiles,
    measuredAt: record.evidence.measuredAt,
    expiresAt: record.evidence.expiresAt,
    path: record.path,
    sha256: record.sha256
  };
}

function normalizeEvidenceRecord(record) {
  if (!record || !record.evidence || typeof record.path !== "string" || !SHA256.test(record.sha256)) throw new Error("published evidence record requires evidence, repository path, and file digest");
  validateFastestEvidence(record.evidence);
  if (!record.path.startsWith("registry/benchmark-evidence/") || !record.path.endsWith(".json")) throw new Error("benchmark evidence path is outside the registry evidence directory");
  return record;
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}
