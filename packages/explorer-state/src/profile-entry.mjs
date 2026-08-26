const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const STATES = new Set(["enabled", "disabled", "qualifying", "unavailable"]);
const OUTCOMES = new Set(["never-deployed", "succeeded", "failed", "rolled-back"]);
const ARTIFACT_KINDS = new Set(["static", "lambda-version", "browser-worker"]);

export function validateProfileEntry(profile, definition) {
  exactKeys(profile, ["id", "backend", "storage", "state", "reason", "route", "deployment", "lastOutcome"], `profile ${profile?.id ?? "unknown"}`);
  if (!definition || definition.id !== profile.id || definition.backend !== profile.backend || definition.storage !== profile.storage) throw new Error(`profile mapping is not canonical: ${profile.id}`);
  if (!STATES.has(profile.state)) throw new Error(`profile ${profile.id} has an unknown state`);
  if (profile.route !== canonicalProfileRoute(profile.id)) throw new Error(`profile ${profile.id} route is not canonical`);
  if (profile.state === "enabled") {
    if (profile.reason !== null || !profile.deployment) throw new Error(`enabled profile ${profile.id} requires deployment identity and no reason`);
  } else if (typeof profile.reason !== "string" || profile.reason.length < 12 || profile.reason.length > 320) {
    throw new Error(`non-enabled profile ${profile.id} requires a bounded reason`);
  }
  if (profile.deployment !== null) validateDeployment(profile.deployment);
  validateOutcome(profile.lastOutcome);
  if (profile.deployment && profile.lastOutcome.outcome === "never-deployed") throw new Error(`deployed profile ${profile.id} cannot have a never-deployed outcome`);
  if (profile.lastOutcome.outcome === "succeeded") {
    if (!profile.deployment) throw new Error(`successful profile ${profile.id} requires the active deployment`);
    if (profile.lastOutcome.attemptedDemoSha !== profile.deployment.demoSha
      || profile.lastOutcome.attemptedEaclSha !== profile.deployment.eaclSha
      || profile.lastOutcome.artifactSha256 !== profile.deployment.artifact.sha256) {
      throw new Error(`successful profile ${profile.id} outcome does not match the active deployment`);
    }
  }
  return profile;
}

export function canonicalProfileRoute(profileId) {
  if (profileId === "datascript-browser-memory") return "/datascript/";
  if (["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory", "jank-memory"].includes(profileId)) return `/api/v1/${profileId}`;
  throw new Error(`unknown profile route: ${profileId}`);
}

export function containsLatestClaim(value) {
  return Object.entries(value).some(([key, item]) => /latest|converged/iu.test(key) || (typeof item === "string" && /\b(?:latest source|all profiles converged)\b/iu.test(item)) || (item && typeof item === "object" && containsLatestClaim(item)));
}

function validateDeployment(deployment) {
  exactKeys(deployment, ["demoSha", "eaclSha", "artifact", "deploymentId", "dataManifestSha256", "deployedAt"], "deployment");
  if (!SHA1.test(deployment.demoSha) || !SHA1.test(deployment.eaclSha)) throw new Error("deployed sources must be exact SHAs");
  exactKeys(deployment.artifact, ["kind", "sha256", "version"], "artifact");
  if (!ARTIFACT_KINDS.has(deployment.artifact.kind) || !SHA256.test(deployment.artifact.sha256) || typeof deployment.artifact.version !== "string" || deployment.artifact.version.length === 0) throw new Error("artifact identity is invalid");
  if (typeof deployment.deploymentId !== "string" || deployment.deploymentId.length === 0) throw new Error("deployment ID is invalid");
  if (!SHA256.test(deployment.dataManifestSha256)) throw new Error("deployment data manifest digest is invalid");
  if (Number.isNaN(Date.parse(deployment.deployedAt))) throw new Error("deployment timestamp is invalid");
}

function validateOutcome(outcome) {
  exactKeys(outcome, ["outcome", "attemptedDemoSha", "attemptedEaclSha", "artifactSha256", "at", "message"], "last outcome");
  if (!OUTCOMES.has(outcome.outcome)) throw new Error("deployment outcome is unknown");
  if (typeof outcome.message !== "string" || outcome.message.length === 0 || outcome.message.length > 320) throw new Error("deployment outcome message is invalid");
  if (outcome.outcome === "never-deployed") {
    if ([outcome.attemptedDemoSha, outcome.attemptedEaclSha, outcome.artifactSha256, outcome.at].some((value) => value !== null)) throw new Error("never-deployed outcome cannot carry attempted identity");
  } else if (!SHA1.test(outcome.attemptedDemoSha) || !SHA1.test(outcome.attemptedEaclSha) || !SHA256.test(outcome.artifactSha256) || Number.isNaN(Date.parse(outcome.at))) {
    throw new Error("deployment outcome requires exact attempted identity");
  }
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}
