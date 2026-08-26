import {
  computeEvidenceDecision,
  isEvidenceCurrent,
  validateFastestEvidence
} from "./fastest-evidence.mjs";

export function selectDefaultStorage({ backend, profileDefinitions, availability, evidence = null, now = new Date() }) {
  const byId = new Map(profileDefinitions.profiles.map((profile) => [profile.id, profile]));
  const qualified = availability.profiles
    .filter((entry) => entry.state === "enabled" && byId.get(entry.id)?.backend === backend)
    .map((entry) => byId.get(entry.id));

  if (qualified.length === 0) return { outcome: "none", profileId: null, storage: null, claim: null, evidenceId: null, measuredAt: null, reason: "No qualified storage choice is enabled." };
  if (qualified.length === 1) return { outcome: "sole-qualified", profileId: qualified[0].id, storage: qualified[0].storage, claim: null, evidenceId: null, measuredAt: null, reason: "Only one qualified storage choice is enabled." };
  const fallback = () => ({ outcome: "fallback", profileId: qualified[0].id, storage: qualified[0].storage, claim: null, evidenceId: null, measuredAt: null, reason: "Comparable current benchmark evidence is unavailable; using the stable qualified fallback." });
  if (!evidence) return fallback();

  validateFastestEvidence(evidence);
  if (evidence.backend !== backend) throw new Error("fastest evidence backend does not match selection backend");
  const qualifiedIds = qualified.map(({ id }) => id).sort();
  if (JSON.stringify([...evidence.profiles].sort()) !== JSON.stringify(qualifiedIds)) throw new Error("fastest evidence candidates must exactly equal qualified storage choices");
  if (!isEvidenceCurrent(evidence, now)) return fallback();
  const computed = computeEvidenceDecision(evidence);
  if (computed.outcome === "unresolved") return fallback();
  const profile = byId.get(computed.defaultProfileId);
  return {
    outcome: computed.outcome,
    profileId: profile.id,
    storage: profile.storage,
    claim: computed.outcome === "winner" ? "fastest-qualified" : "benchmark-selected",
    evidenceId: evidence.evidenceId,
    measuredAt: evidence.measuredAt,
    reason: null
  };
}

export const computeDecision = computeEvidenceDecision;
