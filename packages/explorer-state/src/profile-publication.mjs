import { jsonPayloadSha256, readBoundedJsonResponse } from "../../contracts/src/http-client.mjs";
import { canonicalProfileRoute, validateProfileEntry } from "./profile-entry.mjs";
import { deriveStorageDefaults, evidenceSummary, validateProfileRegistry } from "./profile-registry.mjs";

const PUBLICATION_SCHEMA = "eacl-demo.profile-publication.v1";
const PUBLICATION_SCHEMA_PATH = "../../schemas/profile-publication.v1.schema.json";
const PUBLICATION_ID = /^sha256:[0-9a-f]{64}$/u;
const MAXIMUM_PUBLICATION_BYTES = 65_536;
const DEFAULT_TIMEOUT_MS = 5_000;
const FALLBACK_REASON = "The current independently published profile status could not be verified, so this profile is not selectable.";

export async function createProfilePublication({ profile, definition, publishedAt, gate }, { cryptoImpl = globalThis.crypto, now = new Date() } = {}) {
  validateProfileEntry(profile, definition);
  validatePublicationTime(publishedAt, profile, now);
  validatePublicationGate(gate);
  const unsigned = {
    $schema: PUBLICATION_SCHEMA_PATH,
    schema: PUBLICATION_SCHEMA,
    contractVersion: "explorer.v1",
    publishedAt,
    gate: structuredClone(gate),
    profile: structuredClone(profile)
  };
  return {
    ...unsigned,
    publicationId: `sha256:${await jsonPayloadSha256(canonicalJson(unsigned), { cryptoImpl })}`
  };
}

export function validateProfilePublication(publication, definition, expectedProfile, { now = new Date() } = {}) {
  exactKeys(publication, ["$schema", "schema", "contractVersion", "publicationId", "publishedAt", "gate", "profile"], "profile publication");
  if (publication.$schema !== PUBLICATION_SCHEMA_PATH || publication.schema !== PUBLICATION_SCHEMA || publication.contractVersion !== "explorer.v1") throw publicationError("publication-contract-invalid", "profile publication contract is unsupported");
  if (!PUBLICATION_ID.test(publication.publicationId)) throw publicationError("publication-digest-invalid", "profile publication digest is malformed");
  validatePublicationGate(publication.gate);
  validateProfileEntry(publication.profile, definition);
  if (!expectedProfile || publication.profile.id !== expectedProfile.id || publication.profile.backend !== expectedProfile.backend || publication.profile.storage !== expectedProfile.storage || publication.profile.route !== expectedProfile.route) {
    throw publicationError("publication-identity-mismatch", "profile publication identity or route does not match the closed catalog");
  }
  validatePublicationTime(publication.publishedAt, publication.profile, now);
  return publication;
}

export async function verifyProfilePublication(publication, definition, expectedProfile, { cryptoImpl = globalThis.crypto, now = new Date() } = {}) {
  validateProfilePublication(publication, definition, expectedProfile, { now });
  const { publicationId: _publicationId, ...unsigned } = publication;
  const expectedId = `sha256:${await jsonPayloadSha256(canonicalJson(unsigned), { cryptoImpl })}`;
  if (publication.publicationId !== expectedId) throw publicationError("publication-digest-mismatch", "profile publication content does not match its digest");
  return publication;
}

export function createBaseRegistry(profileDefinitions, { now = new Date() } = {}) {
  const profiles = profileDefinitions.profiles.map(({ id, backend, storage }) => ({
    id,
    backend,
    storage,
    state: "unavailable",
    reason: FALLBACK_REASON,
    route: canonicalProfileRoute(id),
    deployment: null,
    lastOutcome: {
      outcome: "never-deployed",
      attemptedDemoSha: null,
      attemptedEaclSha: null,
      artifactSha256: null,
      at: null,
      message: "No consolidated candidate has been deployed."
    }
  }));
  const registry = {
    $schema: "../schemas/profile-registry.v1.schema.json",
    schema: "eacl-demo.profile-registry.v1",
    contractVersion: "explorer.v1",
    benchmarkEvidence: [],
    storageDefaults: deriveStorageDefaults(profiles, profileDefinitions, [], now),
    profiles
  };
  return validateProfileRegistry(registry, profileDefinitions, { evidenceRecords: [], now });
}

export function createFailClosedRegistry(baseRegistry, profileDefinitions, { evidenceRecords = [], now = new Date() } = {}) {
  validateProfileRegistry(baseRegistry, profileDefinitions, { evidenceRecords: [], now });
  const profiles = baseRegistry.profiles.map(failClosedProfile);
  const registry = {
    ...structuredClone(baseRegistry),
    benchmarkEvidence: evidenceRecords.map(evidenceSummary).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
    storageDefaults: deriveStorageDefaults(profiles, profileDefinitions, evidenceRecords, now),
    profiles
  };
  validateProfileRegistry(registry, profileDefinitions, { evidenceRecords, now });
  return registry;
}

export async function composeProfileRegistry({ baseRegistry, profileDefinitions, publications = [], evidenceRecords = [], now = new Date(), cryptoImpl = globalThis.crypto }) {
  const registry = createFailClosedRegistry(baseRegistry, profileDefinitions, { evidenceRecords, now });
  const definitions = new Map(profileDefinitions.profiles.map((profile) => [profile.id, profile]));
  const expected = new Map(baseRegistry.profiles.map((profile) => [profile.id, profile]));
  const candidates = new Map(profileDefinitions.profiles.map(({ id }) => [id, []]));
  const failures = [];

  for (const publication of publications) {
    const id = publication?.profile?.id;
    if (!candidates.has(id)) {
      failures.push(failure(id ?? null, "publication-identity-mismatch"));
      continue;
    }
    candidates.get(id).push(publication);
  }

  const profiles = [];
  for (const fallback of registry.profiles) {
    const matches = candidates.get(fallback.id);
    if (matches.length === 0) {
      failures.push(failure(fallback.id, "publication-missing"));
      profiles.push(fallback);
      continue;
    }
    if (matches.length !== 1) {
      failures.push(failure(fallback.id, "publication-duplicate"));
      profiles.push(fallback);
      continue;
    }
    try {
      const publication = await verifyProfilePublication(matches[0], definitions.get(fallback.id), expected.get(fallback.id), { cryptoImpl, now });
      profiles.push(structuredClone(publication.profile));
    } catch (error) {
      failures.push(failure(fallback.id, error?.code ?? "publication-invalid"));
      profiles.push(fallback);
    }
  }

  registry.profiles = profiles;
  registry.storageDefaults = deriveStorageDefaults(profiles, profileDefinitions, evidenceRecords, now);
  validateProfileRegistry(registry, profileDefinitions, { evidenceRecords, now });
  return { registry, failures };
}

export async function loadProfilePublications({
  baseUrl,
  profileDefinitions,
  baseRegistry,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  signal,
  now = new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maximumBytes = MAXIMUM_PUBLICATION_BYTES
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("profile publication fetch is unavailable");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new RangeError("profile publication timeout must be 100..30000 milliseconds");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAXIMUM_PUBLICATION_BYTES) throw new RangeError("profile publication limit must be 1..65536 bytes");
  validateProfileRegistry(baseRegistry, profileDefinitions, { evidenceRecords: [] });
  const expected = new Map(baseRegistry.profiles.map((profile) => [profile.id, profile]));
  const definitions = new Map(profileDefinitions.profiles.map((profile) => [profile.id, profile]));
  const origin = validatePublicationOrigin(baseUrl);

  const outcomes = await Promise.all(profileDefinitions.profiles.map(async ({ id }) => {
    const url = new URL(`/registry/profiles/${id}.json`, origin);
    try {
      const publication = await fetchPublication(url, { fetchImpl, signal, timeoutMs, maximumBytes });
      await verifyProfilePublication(publication, definitions.get(id), expected.get(id), { cryptoImpl, now });
      return { ok: true, id, publication };
    } catch (error) {
      return { ok: false, id, code: error?.code ?? (signal?.aborted ? "publication-cancelled" : "publication-fetch-failed") };
    }
  }));

  return {
    publications: outcomes.filter(({ ok }) => ok).map(({ publication }) => publication),
    failures: outcomes.filter(({ ok }) => !ok).map(({ id, code }) => failure(id, code))
  };
}

export async function loadProfilePublication({
  baseUrl,
  profileId,
  profileDefinitions,
  baseRegistry,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  signal,
  now = new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maximumBytes = MAXIMUM_PUBLICATION_BYTES
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("profile publication fetch is unavailable");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new RangeError("profile publication timeout must be 100..30000 milliseconds");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAXIMUM_PUBLICATION_BYTES) throw new RangeError("profile publication limit must be 1..65536 bytes");
  validateProfileRegistry(baseRegistry, profileDefinitions, { evidenceRecords: [] });
  const expected = baseRegistry.profiles.find(({ id }) => id === profileId);
  const definition = profileDefinitions.profiles.find(({ id }) => id === profileId);
  if (!expected || !definition) throw publicationError("publication-identity-mismatch", "profile publication identity is outside the closed catalog");
  const origin = validatePublicationOrigin(baseUrl);
  const url = new URL(`/registry/profiles/${profileId}.json`, origin);
  const publication = await fetchPublication(url, { fetchImpl, signal, timeoutMs, maximumBytes });
  return verifyProfilePublication(publication, definition, expected, { cryptoImpl, now });
}

async function fetchPublication(url, { fetchImpl, signal, timeoutMs, maximumBytes }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener?.("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("profile publication request timed out")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    if (!response?.ok || response.status !== 200) throw publicationError("publication-http-failed", "profile publication returned a non-success status");
    if (response.redirected === true || (typeof response.url === "string" && response.url.length > 0 && response.url !== url.href)) throw publicationError("publication-redirected", "profile publication redirected or resolved to another URL");
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/iu.test(contentType)) throw publicationError("publication-content-type-invalid", "profile publication is not JSON");
    return await readBoundedJsonResponse(response, { maximumBytes });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw publicationError("publication-timeout", "profile publication request timed out");
    if (controller.signal.aborted) throw publicationError("publication-cancelled", "profile publication request was cancelled");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
}

function validatePublicationOrigin(baseUrl) {
  const url = new URL(baseUrl ?? globalThis.location?.href);
  const browserOrigin = globalThis.window?.location?.origin;
  if (browserOrigin && url.origin !== browserOrigin) throw publicationError("publication-origin-invalid", "profile publications must use the shell origin");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) throw publicationError("publication-origin-invalid", "profile publications require HTTPS outside loopback preview");
  return url;
}

function validatePublicationTime(publishedAt, profile, now) {
  const timestamp = Date.parse(publishedAt);
  if (typeof publishedAt !== "string" || Number.isNaN(timestamp)) throw publicationError("publication-time-invalid", "profile publication timestamp is invalid");
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(current) || timestamp > current + 300_000) throw publicationError("publication-time-invalid", "profile publication timestamp is implausibly far in the future");
  for (const earlier of [profile.deployment?.deployedAt, profile.lastOutcome.at].filter(Boolean)) {
    if (timestamp < Date.parse(earlier)) throw publicationError("publication-time-invalid", "profile publication predates its deployment outcome");
  }
}

function validatePublicationGate(gate) {
  exactKeys(gate, ["kind", "evidenceId"], "profile publication gate");
  if (gate.kind === "failure-outcome") {
    if (gate.evidenceId !== null) throw publicationError("publication-gate-invalid", "a failure outcome cannot claim passing gate evidence");
  } else if (!new Set(["initial-qualification", "merge-smoke", "demo-smoke"]).has(gate.kind) || !PUBLICATION_ID.test(gate.evidenceId)) {
    throw publicationError("publication-gate-invalid", "profile publication gate evidence is invalid");
  }
}

function failClosedProfile(profile) {
  return { ...structuredClone(profile), state: "unavailable", reason: FALLBACK_REASON };
}

function failure(profileId, code) {
  return Object.freeze({ profileId, code });
}

function publicationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw publicationError("publication-contract-invalid", `${name} has unknown or missing fields`);
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw publicationError("publication-contract-invalid", "profile publication contains a non-canonical value");
}
