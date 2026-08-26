import { createFailure, httpStatusForError } from "./envelopes.mjs";
import { validateHttpRequest } from "./http-boundary.mjs";

const EVENT_KEYS = new Set(["version", "routeKey", "rawPath", "rawQueryString", "headers", "requestContext", "isBase64Encoded", "body", "cookies"]);

export function normalizeFunctionUrlEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event) || event.version !== "2.0" || Object.keys(event).some((key) => !EVENT_KEYS.has(key))) return { ok: false, code: "validation-error" };
  const http = event.requestContext?.http;
  const requestId = event.requestContext?.requestId;
  if (!http || typeof http.method !== "string" || typeof requestId !== "string" || !event.headers || typeof event.headers !== "object" || Array.isArray(event.headers)) return { ok: false, code: "validation-error" };
  let body = event.body ?? null;
  if (event.isBase64Encoded === true && typeof body === "string") {
    try { body = new TextDecoder().decode(fromBase64(body)); } catch { return { ok: false, code: "validation-error" }; }
  } else if (event.isBase64Encoded !== false) return { ok: false, code: "validation-error" };
  const headers = Object.fromEntries(Object.entries(event.headers).map(([key, value]) => [key.toLowerCase(), value]));
  return validateHttpRequest({ path: event.rawPath, method: http.method, contentType: headers["content-type"] ?? null, query: event.rawQueryString ?? "", body, requestId });
}

export function createFunctionUrlResponse(envelope, { allowedMethods = null } = {}) {
  const statusCode = envelope.ok ? 200 : httpStatusForError(envelope.error.code);
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (statusCode === 405 && Array.isArray(allowedMethods) && allowedMethods.length > 0) headers.allow = [...allowedMethods].sort().join(", ");
  return { statusCode, headers, body: JSON.stringify(envelope), isBase64Encoded: false };
}

export function rejectionResponse(context, normalized) {
  const envelope = createFailure(context, normalized.code);
  return createFunctionUrlResponse(envelope, { allowedMethods: normalized.allowedMethods ?? null });
}

export async function runFunctionUrlContractSuite(adapter, suite) {
  const failures = [];
  for (const testCase of suite.events) {
    const actual = await adapter.normalizeEvent(testCase.event);
    if (JSON.stringify(actual) !== JSON.stringify(testCase.expected)) failures.push({ id: testCase.id, expected: testCase.expected, actual });
  }
  return { schema: "eacl-demo.function-url-suite-result.v1", adapter: adapter.name, total: suite.events.length, passed: suite.events.length - failures.length, failures };
}

function fromBase64(value) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new Error("invalid base64");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
