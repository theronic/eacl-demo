import { jsonPayloadSha256, readBoundedJsonResponse } from "../../contracts/src/http-client.mjs";
import { validateDescriptorHandshake } from "../../contracts/src/descriptor-handshake.mjs";
import { assertDescriptorIdentity } from "./profile-controller.mjs";

const OPERATIONS = new Set([
  "health", "bootstrap", "list-subjects", "get-object",
  "list-relationships", "reverse-relationships", "authorize", "get-schema",
  "get-cache-info", "count-objects", "lookup-resources", "lookup-subjects",
  "count-resources"
]);
const GET_OPERATIONS = new Set(["health", "bootstrap"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * Same-origin browser transport for one immutable, enabled server profile.
 * Every response is schema checked and correlated to its request. Profile
 * identity is established by the health/bootstrap handshake before ordinary
 * Explorer operations can run.
 */
export function createServerProfileTransport({
  profile,
  baseUrl,
  validateRequest,
  validateResponse,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  timeoutMs = 35_000,
  maximumResponseBytes = 1_048_576
}) {
  validateProfile(profile);
  if (typeof fetchImpl !== "function" || typeof validateRequest !== "function" || typeof validateResponse !== "function") {
    throw new TypeError("HTTP profile transport dependencies are required");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new RangeError("HTTP profile timeout is invalid");
  if (!Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1 || maximumResponseBytes > 1_048_576) throw new RangeError("HTTP response limit is invalid");
  const base = validateBaseUrl(baseUrl);
  const route = `/api/v1/${profile.id}`;
  if (profile.route !== route) throw new Error("enabled profile route is not canonical");
  const lifecycle = new AbortController();
  let released = false;
  let sequence = 0;
  let requestTail = Promise.resolve();

  function request(operation, input = {}, options = {}) {
    const pending = requestTail.then(() => performRequest(operation, input, options));
    requestTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function performRequest(operation, input, options) {
    if (released) throw publicError("cancelled", "The selected profile transport has been released.", true);
    if (!OPERATIONS.has(operation)) throw new TypeError("HTTP profile operation is not closed");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("HTTP profile input must be an object");
    const requestId = options.requestId ?? `browser-${options.epoch ?? 0}-${++sequence}`;
    if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) throw new TypeError("HTTP profile request ID is invalid");
    const logicalRequest = validateRequest({ contractVersion: "explorer.v1", profileId: profile.id, requestId, operation, input });
    const method = GET_OPERATIONS.has(operation) ? "GET" : "POST";
    const body = method === "POST" ? JSON.stringify(logicalRequest.input) : null;
    const headers = method === "POST"
      ? { "content-type": "application/json; charset=utf-8", "x-amz-content-sha256": await jsonPayloadSha256(body, { cryptoImpl }), "x-eacl-request-id": requestId }
      : { "x-eacl-request-id": requestId };
    const url = new URL(`${route}/${operation}`, base.origin);
    if (url.origin !== base.origin || url.pathname !== `${route}/${operation}` || url.search || url.hash) throw new Error("HTTP profile request escaped its route");
    const bounded = boundedSignal([lifecycle.signal, options.signal], timeoutMs);
    try {
      const response = await fetchImpl(url.href, {
        method,
        headers,
        ...(body === null ? {} : { body }),
        signal: bounded.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer"
      });
      if (!response || response.redirected === true) throw publicError("invalid-response", "The profile returned an invalid response.", false);
      const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("application/json")) throw publicError("invalid-response", "The profile returned an invalid response.", false);
      const envelope = validateResponse(await readBoundedJsonResponse(response, { maximumBytes: maximumResponseBytes }));
      validateEnvelopeBinding(envelope, requestId, response.status);
      return envelope;
    } catch (error) {
      if (bounded.timedOut()) throw publicError("deadline-exceeded", "The profile request exceeded its client deadline.", true);
      throw error;
    } finally {
      bounded.close();
    }
  }

  return Object.freeze({
    async bootstrap(options = {}) {
      const { requestId: _ignoredRequestId, ...startupOptions } = options;
      const health = await request("health", {}, startupOptions);
      if (health.error) throw publicError(health.error.code, health.error.message, retryableError(health.error.code));
      const bootstrap = await request("bootstrap", {}, startupOptions);
      if (bootstrap.error) throw publicError(bootstrap.error.code, bootstrap.error.message, retryableError(bootstrap.error.code));
      validateDescriptorHandshake({ registryProfile: profile, route: profile.route, health: health.data, bootstrap: bootstrap.data });
      assertDescriptorIdentity(profile, bootstrap.data);
      return bootstrap.data;
    },
    request,
    cancel() { return false; },
    async release() {
      if (released) return false;
      released = true;
      lifecycle.abort("transport-release");
      return true;
    }
  });
}

export function validateEnvelopeBinding(envelope, requestId, status = null) {
  if (!envelope || typeof envelope !== "object" || !envelope.meta) throw publicError("invalid-response", "The profile returned an invalid response.", false);
  if (envelope.meta.requestId !== requestId) throw publicError("identity-mismatch", "The profile response did not match this request.", false);
  const success = "data" in envelope && !("error" in envelope);
  const failure = "error" in envelope && !("data" in envelope);
  if (!success && !failure) throw publicError("invalid-response", "The profile returned an invalid response.", false);
  if (status !== null) {
    if (!Number.isInteger(status) || status < 200 || status > 599) throw publicError("invalid-response", "The profile returned an invalid HTTP status.", false);
    if (success && status !== 200) throw publicError("invalid-response", "The profile success status was invalid.", false);
    if (failure && status < 400) throw publicError("invalid-response", "The profile failure status was invalid.", false);
  }
  return envelope;
}

function validateProfile(profile) {
  if (!profile || profile.state !== "enabled" || !profile.deployment || typeof profile.id !== "string" || !PROFILE_ID.test(profile.id)) throw new Error(profile?.reason ?? "profile is not enabled");
  if (typeof profile.backend !== "string" || typeof profile.storage !== "string") throw new Error("profile mapping is missing");
}

function validateBaseUrl(value) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("HTTP profile base URL cannot contain credentials");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) throw new Error("HTTP profile transport requires HTTPS or loopback");
  return url;
}

function boundedSignal(signals, timeoutMs) {
  const controller = new AbortController();
  let timeout = false;
  const listeners = [];
  const abort = (signal) => controller.abort(signal?.reason ?? "parent-abort");
  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) abort(signal);
    else {
      const listener = () => abort(signal);
      signal.addEventListener("abort", listener, { once: true });
      listeners.push([signal, listener]);
    }
  }
  const timer = setTimeout(() => { timeout = true; controller.abort("client-deadline"); }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    close() {
      clearTimeout(timer);
      for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    }
  };
}

function publicError(code, publicMessage, retryable) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  error.retryable = retryable;
  return error;
}

function retryableError(code) {
  return new Set(["cancelled", "canceled", "deadline-exceeded", "overloaded", "throttled", "dependency-unavailable"]).has(code);
}
