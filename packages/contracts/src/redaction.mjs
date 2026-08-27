import limits from "../limits.v1.json" with { type: "json" };
import { createFailure } from "./envelopes.mjs";

const SENSITIVE_KEY = /(?:secret|token|password|passwd|credential|authorization|cookie|signing|private.?key|access.?key|connection.?string|database.?url|datomic.?uri)/iu;
const STABLE_CODES = new Set(["validation-error", "request-too-large", "method-not-allowed", "route-not-found", "unsupported-media-type", "cursor-invalid", "cursor-expired", "cursor-scope-mismatch", "unsupported-consistency", "freshness-unavailable", "cancelled", "deadline-exceeded", "overloaded", "throttled", "dependency-unavailable", "storage-missing", "storage-corrupt", "identity-mismatch", "response-too-large", "internal-error"]);

export function redactRecord(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 256 ? `${value.slice(0, 253)}...` : value;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => redactRecord(item, depth + 1));
  if (value instanceof Error) return { name: value.name, code: STABLE_CODES.has(value.code) ? value.code : "internal-error" };
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactRecord(item, depth + 1)]));
  }
  return "[UNSUPPORTED]";
}

export function createSafeFailure(context, error) {
  const code = STABLE_CODES.has(error?.code) ? error.code : "internal-error";
  const envelope = createFailure(context, code);
  if (new TextEncoder().encode(JSON.stringify(envelope.error)).length > limits.diagnosticBytes) return createFailure(context, "internal-error");
  return envelope;
}
