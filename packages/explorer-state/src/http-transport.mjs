import { readBoundedJsonResponse } from "../../contracts/src/http-client.mjs";
import { validateDescriptorHandshake } from "../../contracts/src/descriptor-handshake.mjs";

const OPERATIONS = new Set([
  "health", "bootstrap", "list-subjects", "get-object",
  "list-relationships", "reverse-relationships", "check-permission", "get-schema",
  "get-cache-info", "count-objects", "lookup-resources", "lookup-subjects",
  "count-resources"
]);
const GET_OPERATIONS = new Set(["health", "bootstrap"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const FUNCTION_URL_HOST = /^[a-z0-9]+\.lambda-url\.[a-z0-9-]+\.on\.aws$/u;
const APPROVED_HTTPS_HOST = new Set([
  "datomic.demo.eacl.dev",
  "datalevin.demo.eacl.dev"
]);
const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * Browser transport for one immutable, enabled server profile deployment.
 * Every response is schema checked and correlated to its request. Profile
 * identity is established by the health/bootstrap handshake before ordinary
 * Explorer operations can run.
 */
export function createServerProfileTransport({
  profile,
  validateRequest,
  validateResponse,
  fetchImpl = globalThis.fetch,
  startupDeadlineMs = 30_000,
  maximumResponseBytes = 1_048_576,
  sequential = false
}) {
  validateProfile(profile);
  if (typeof fetchImpl !== "function" || typeof validateRequest !== "function" || typeof validateResponse !== "function") {
    throw new TypeError("HTTP profile transport dependencies are required");
  }
  if (typeof sequential !== "boolean") throw new TypeError("HTTP profile sequential flag must be a boolean");
  if (!Number.isSafeInteger(startupDeadlineMs) || startupDeadlineMs < 1_000 || startupDeadlineMs > 60_000) throw new RangeError("HTTP profile startup deadline is invalid");
  if (!Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1 || maximumResponseBytes > 1_048_576) throw new RangeError("HTTP response limit is invalid");
  const apiOrigin = validateApiOrigin(profile.apiOrigin);
  const route = "/";
  if (profile.route !== route) throw new Error("enabled profile route is not canonical");
  const lifecycle = new AbortController();
  let released = false;
  let sequence = 0;
  // A Lambda execution environment serves one request at a time and starts
  // with an empty index-node cache. Concurrent Explorer requests therefore
  // fan out to separate cold environments that each re-read the same index
  // nodes from storage. A sequential transport issues one request at a time
  // so a browsing session keeps landing on the environment that already
  // holds the nodes its previous requests touched. Nothing is primed: every
  // request still pays for whatever it touches first.
  let lane = Promise.resolve();

  function request(operation, input = {}, options = {}) {
    if (!sequential) return performRequest(operation, input, options);
    const turn = lane.then(() => performRequest(operation, input, options));
    lane = turn.then(() => undefined, () => undefined);
    return turn;
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
      ? { "content-type": "application/json; charset=utf-8", "x-eacl-request-id": requestId }
      : { "x-eacl-request-id": requestId };
    const path = `/${operation}`;
    const url = new URL(path, apiOrigin);
    if (url.origin !== apiOrigin || url.pathname !== path || url.search || url.hash) throw new Error("HTTP profile request escaped its deployment route");
    // Operations carry no client deadline: server-side deadlines already bound
    // them. Only the startup handshake in bootstrap() gives up on the client.
    const linked = linkedSignal([lifecycle.signal, options.signal]);
    try {
      const response = await fetchImpl(url.href, {
        method,
        headers,
        ...(body === null ? {} : { body }),
        signal: linked.signal,
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
    } finally {
      linked.close();
    }
  }

  async function performHandshake(startupOptions) {
    // Health and bootstrap are independent reads, so they go out together and
    // startup costs one round trip. A sequential transport still runs them one
    // at a time, health first, through its lane.
    const [firstHealth, bootstrap] = await Promise.all([
      request("health", {}, startupOptions),
      request("bootstrap", {}, startupOptions)
    ]);
    let health = firstHealth;
    if (health.error) throw publicError(health.error.code, health.error.message, retryableError(health.error.code));
    if (bootstrap.error) throw publicError(bootstrap.error.code, bootstrap.error.message, retryableError(bootstrap.error.code));
    if (!sameBasis(health.data?.basis, bootstrap.data?.basis)) {
      health = await request("health", {}, startupOptions);
      if (health.error) throw publicError(health.error.code, health.error.message, retryableError(health.error.code));
    }
    const handshake = validateDescriptorHandshake({ registryProfile: profile, route: profile.route, health: health.data, bootstrap: bootstrap.data });
    // The descriptor is immutable, but request-snapshot profiles capture a
    // fresh basis during the health half of this handshake. Preserve that
    // newly captured basis so Refresh Snapshot visibly advances the UI.
    return {
      ...bootstrap.data,
      basis: health.data.basis,
      ...(handshake.identityWarning ? { identityWarning: handshake.identityWarning } : {})
    };
  }

  return Object.freeze({
    async bootstrap(options = {}) {
      const { requestId: _ignoredRequestId, signal, ...startupOptions } = options;
      // A runtime that has not finished the handshake by the startup deadline
      // becomes a retryable failure instead of an endless wait. The abandoned
      // handshake is cancelled, including a request still queued in the lane.
      const expiry = new AbortController();
      const startup = linkedSignal([signal, expiry.signal]);
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(publicError("startup-timeout", `Stopped waiting after ${Math.round(startupDeadlineMs / 1000)} seconds.`, true));
          expiry.abort("startup-deadline");
        }, startupDeadlineMs);
      });
      try {
        return await Promise.race([performHandshake({ ...startupOptions, signal: startup.signal }), deadline]);
      } finally {
        clearTimeout(timer);
        startup.close();
      }
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

function sameBasis(left, right) {
  return left?.id === right?.id && left?.capturedAt === right?.capturedAt;
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

function validateApiOrigin(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("enabled server profile requires a deployment origin");
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port) throw new Error("HTTP profile API origin must be an origin without credentials or a path");
  const loopback = LOOPBACK.has(url.hostname);
  if (loopback ? !new Set(["http:", "https:"]).has(url.protocol) : url.protocol !== "https:" || (!FUNCTION_URL_HOST.test(url.hostname) && !APPROVED_HTTPS_HOST.has(url.hostname))) {
    throw new Error("HTTP profile transport requires an approved HTTPS deployment origin or loopback origin");
  }
  return url.origin;
}

function linkedSignal(signals) {
  const controller = new AbortController();
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
  return {
    signal: controller.signal,
    close() {
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
