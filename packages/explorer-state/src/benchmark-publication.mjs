import { jsonPayloadSha256, readBoundedJsonResponse, readBoundedTextResponse } from "../../contracts/src/http-client.mjs";
import { validateFastestEvidence } from "./fastest-evidence.mjs";

const INDEX_SCHEMA_PATH = "../../schemas/benchmark-evidence-index.v1.schema.json";
const INDEX_ID = /^sha256:[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const EVIDENCE_PATH = /^registry\/benchmark-evidence\/[a-z0-9][a-z0-9._-]*\.json$/u;
const MAXIMUM_INDEX_BYTES = 65_536;
const MAXIMUM_EVIDENCE_BYTES = 262_144;

export async function createBenchmarkEvidenceIndex({ evidenceRecords, publishedAt }, { cryptoImpl = globalThis.crypto, now = new Date() } = {}) {
  validateIndexTime(publishedAt, now);
  const evidence = evidenceRecords.map(validateEvidenceRecord).map(summary).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  validateUniqueSummaries(evidence);
  if (evidence.some(({ measuredAt }) => Date.parse(measuredAt) > Date.parse(publishedAt))) throw typedError("benchmark-index-time-invalid", "benchmark evidence index predates a measurement");
  const unsigned = { $schema: INDEX_SCHEMA_PATH, schema: "eacl-demo.benchmark-evidence-index.v1", contractVersion: "explorer.v1", publishedAt, evidence };
  return { ...unsigned, indexId: `sha256:${await jsonPayloadSha256(canonicalJson(unsigned), { cryptoImpl })}` };
}

export async function verifyBenchmarkEvidenceIndex(index, { cryptoImpl = globalThis.crypto, now = new Date() } = {}) {
  exactKeys(index, ["$schema", "schema", "contractVersion", "indexId", "publishedAt", "evidence"], "benchmark evidence index");
  if (index.$schema !== INDEX_SCHEMA_PATH || index.schema !== "eacl-demo.benchmark-evidence-index.v1" || index.contractVersion !== "explorer.v1" || !INDEX_ID.test(index.indexId)) throw typedError("benchmark-index-invalid", "benchmark evidence index contract is invalid");
  validateIndexTime(index.publishedAt, now);
  if (!Array.isArray(index.evidence) || index.evidence.length > 32) throw typedError("benchmark-index-invalid", "benchmark evidence index is unbounded");
  for (const item of index.evidence) validateSummary(item);
  validateUniqueSummaries(index.evidence);
  if (index.evidence.some(({ measuredAt }) => Date.parse(measuredAt) > Date.parse(index.publishedAt))) throw typedError("benchmark-index-time-invalid", "benchmark evidence index predates a measurement");
  const { indexId: _indexId, ...unsigned } = index;
  const expected = `sha256:${await jsonPayloadSha256(canonicalJson(unsigned), { cryptoImpl })}`;
  if (index.indexId !== expected) throw typedError("benchmark-index-digest-mismatch", "benchmark evidence index content does not match its digest");
  return index;
}

export async function loadBenchmarkEvidence({ baseUrl, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto, signal, now = new Date(), timeoutMs = 5_000 }) {
  try {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw typedError("benchmark-timeout-invalid", "benchmark timeout must be 100..30000 milliseconds");
    const origin = validateOrigin(baseUrl);
    const indexUrl = new URL("/registry/benchmark-evidence/index.v1.json", origin);
    const indexResponse = await fetchBounded(indexUrl, { fetchImpl, signal, timeoutMs, maximumBytes: MAXIMUM_INDEX_BYTES, asText: false });
    const index = await verifyBenchmarkEvidenceIndex(indexResponse, { cryptoImpl, now });
    const outcomes = await Promise.all(index.evidence.map(async (expected) => {
      try {
        const url = new URL(`/${expected.path}`, origin);
        const text = await fetchBounded(url, { fetchImpl, signal, timeoutMs, maximumBytes: MAXIMUM_EVIDENCE_BYTES, asText: true });
        if (await jsonPayloadSha256(text, { cryptoImpl }) !== expected.sha256) throw typedError("benchmark-file-digest-mismatch", "benchmark evidence file digest is invalid");
        const evidence = JSON.parse(text);
        validateFastestEvidence(evidence);
        if (JSON.stringify(summary({ evidence, path: expected.path, sha256: expected.sha256 })) !== JSON.stringify(expected)) throw typedError("benchmark-summary-mismatch", "benchmark evidence does not match its index summary");
        return { ok: true, record: { evidence, path: expected.path, sha256: expected.sha256 } };
      } catch (error) {
        return { ok: false, failure: { evidenceId: expected.evidenceId, code: error?.code ?? "benchmark-evidence-invalid" } };
      }
    }));
    return { index, evidenceRecords: outcomes.filter(({ ok }) => ok).map(({ record }) => record), failures: outcomes.filter(({ ok }) => !ok).map(({ failure }) => failure) };
  } catch (error) {
    return { index: null, evidenceRecords: [], failures: [{ evidenceId: null, code: error?.code ?? "benchmark-index-fetch-failed" }] };
  }
}

async function fetchBounded(url, { fetchImpl, signal, timeoutMs, maximumBytes, asText }) {
  if (typeof fetchImpl !== "function") throw typedError("benchmark-fetch-unavailable", "benchmark evidence fetch is unavailable");
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener?.("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("benchmark evidence request timed out")), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
    if (!response?.ok || response.status !== 200) throw typedError("benchmark-http-failed", "benchmark evidence returned a non-success status");
    if (response.redirected === true || (typeof response.url === "string" && response.url.length > 0 && response.url !== url.href)) throw typedError("benchmark-redirected", "benchmark evidence redirected or resolved to another URL");
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/iu.test(contentType)) throw typedError("benchmark-content-type-invalid", "benchmark evidence is not JSON");
    return asText ? readBoundedTextResponse(response, { maximumBytes }) : readBoundedJsonResponse(response, { maximumBytes });
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw typedError("benchmark-timeout", "benchmark evidence request timed out");
    if (controller.signal.aborted) throw typedError("benchmark-cancelled", "benchmark evidence request was cancelled");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
}

function validateEvidenceRecord(record) {
  if (!record || !record.evidence || typeof record.path !== "string" || !SHA256.test(record.sha256)) throw typedError("benchmark-evidence-invalid", "published evidence record is invalid");
  validateFastestEvidence(record.evidence);
  if (!EVIDENCE_PATH.test(record.path) || record.path.endsWith("/index.v1.json")) throw typedError("benchmark-evidence-invalid", "benchmark evidence path is invalid");
  return record;
}

function summary(record) {
  return { evidenceId: record.evidence.evidenceId, backend: record.evidence.backend, profiles: record.evidence.profiles, measuredAt: record.evidence.measuredAt, expiresAt: record.evidence.expiresAt, path: record.path, sha256: record.sha256 };
}

function validateSummary(value) {
  exactKeys(value, ["evidenceId", "backend", "profiles", "measuredAt", "expiresAt", "path", "sha256"], "benchmark evidence summary");
  if (!INDEX_ID.test(value.evidenceId) || !new Set(["datahike", "datomic", "datalevin", "jank", "datascript"]).has(value.backend) || !Array.isArray(value.profiles) || value.profiles.length < 2 || new Set(value.profiles).size !== value.profiles.length || !EVIDENCE_PATH.test(value.path) || value.path.endsWith("/index.v1.json") || !SHA256.test(value.sha256) || !Number.isFinite(Date.parse(value.measuredAt)) || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.parse(value.measuredAt)) throw typedError("benchmark-index-invalid", "benchmark evidence summary is invalid");
}

function validateUniqueSummaries(values) {
  if (new Set(values.map(({ evidenceId }) => evidenceId)).size !== values.length || new Set(values.map(({ path }) => path)).size !== values.length) throw typedError("benchmark-index-invalid", "benchmark evidence index contains duplicates");
}

function validateIndexTime(publishedAt, now) {
  const timestamp = Date.parse(publishedAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(current) || timestamp > current + 300_000) throw typedError("benchmark-index-time-invalid", "benchmark evidence index timestamp is invalid");
}

function validateOrigin(baseUrl) {
  const url = new URL(baseUrl ?? globalThis.location?.href);
  const browserOrigin = globalThis.window?.location?.origin;
  if (browserOrigin && url.origin !== browserOrigin) throw typedError("benchmark-origin-invalid", "benchmark evidence must use the shell origin");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) throw typedError("benchmark-origin-invalid", "benchmark evidence requires HTTPS outside loopback preview");
  return url;
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw typedError("benchmark-index-invalid", `${name} has unknown or missing fields`);
}

function typedError(code, message) { const error = new Error(message); error.code = code; return error; }

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw typedError("benchmark-index-invalid", "benchmark evidence index contains a non-canonical value");
}
