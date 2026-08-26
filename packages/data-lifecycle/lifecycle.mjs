const STATES = ["staging", "verified", "serving", "retired"];
const IMMUTABLE_FIELDS = ["schema", "lifecycleId", "profileId", "storageResourceId", "manifestDigest", "fixtureDigest", "previousLifecycleId", "createdAt"];
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function validateLifecycle(record) {
  exactKeys(record, [...IMMUTABLE_FIELDS, "state", "verifiedAt", "servingAt", "retiredAt"], "data lifecycle");
  if (record.schema !== "eacl-demo.data-lifecycle.v1") throw new Error("unsupported data lifecycle schema");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9._-]+$/u.test(record.lifecycleId)) throw new Error("invalid data lifecycle ID");
  if (!DIGEST.test(record.manifestDigest) || !DIGEST.test(record.fixtureDigest)) throw new Error("data lifecycle requires exact manifest and fixture digests");
  if (!STATES.includes(record.state)) throw new Error("invalid data lifecycle state");
  parseDate(record.createdAt, "createdAt");
  const requiredTimestamps = {
    staging: [],
    verified: ["verifiedAt"],
    serving: ["verifiedAt", "servingAt"],
    retired: ["verifiedAt", "servingAt", "retiredAt"]
  }[record.state];
  for (const field of ["verifiedAt", "servingAt", "retiredAt"]) {
    if (requiredTimestamps.includes(field)) parseDate(record[field], field);
    else if (record[field] !== null) throw new Error(`${field} must be null in ${record.state}`);
  }
  return record;
}

export function transitionLifecycle(before, after) {
  validateLifecycle(before);
  validateLifecycle(after);
  for (const field of IMMUTABLE_FIELDS) if (before[field] !== after[field]) throw new Error(`accepted lifecycle field ${field} is immutable`);
  const allowed = new Set(["staging->verified", "verified->serving", "serving->retired"]);
  if (!allowed.has(`${before.state}->${after.state}`)) throw new Error(`forbidden data lifecycle transition ${before.state}->${after.state}`);
  return after;
}

export function requireOrdinaryDeployManifest(servingLifecycle, expectedManifestDigest) {
  validateLifecycle(servingLifecycle);
  if (servingLifecycle.state !== "serving") throw new Error("ordinary deployment requires a serving lifecycle");
  if (servingLifecycle.manifestDigest !== expectedManifestDigest) {
    const error = new Error("serving fixture differs from deployment; a separate stateful blue-green workflow is required");
    error.code = "stateful-migration-required";
    throw error;
  }
  return servingLifecycle;
}

export function planBlueGreenPromotion(current, candidate) {
  validateLifecycle(current);
  validateLifecycle(candidate);
  if (current.state !== "serving" || candidate.state !== "verified") throw new Error("promotion requires one serving and one separately verified lifecycle");
  if (current.profileId !== candidate.profileId) throw new Error("blue-green promotion cannot cross profiles");
  if (current.lifecycleId === candidate.lifecycleId || current.storageResourceId === candidate.storageResourceId) throw new Error("candidate must use a distinct lifecycle and physical storage resource");
  if (candidate.previousLifecycleId !== current.lifecycleId) throw new Error("candidate does not identify the serving predecessor");
  return {
    profileId: current.profileId,
    fromLifecycleId: current.lifecycleId,
    toLifecycleId: candidate.lifecycleId,
    expectedManifestDigest: candidate.manifestDigest,
    operation: "atomic-profile-data-pointer-update",
    mutateAcceptedLifecycle: false
  };
}

function parseDate(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an RFC 3339 timestamp`);
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}
