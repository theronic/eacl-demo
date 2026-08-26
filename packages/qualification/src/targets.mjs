import { jsonPayloadSha256, readBoundedJsonResponse } from "../../contracts/src/http-client.mjs";

const PROFILE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
export const SERVER_PROFILE_IDS = Object.freeze([
  "datahike-s3", "datahike-dynamodb", "datomic-dynamodb",
  "datalevin-memory", "jank-memory"
]);

export function qualificationTarget({ kind, baseUrl, profileId, authorize = null }) {
  if (!new Set(["local", "staged-origin", "staged-cloudfront", "production-cloudfront"]).has(kind)) throw new TypeError("qualification target kind is invalid");
  if (typeof profileId !== "string" || !PROFILE.test(profileId) || !SERVER_PROFILE_IDS.includes(profileId)) throw new TypeError("qualification profile ID is not a registered server profile");
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error("qualification URL cannot contain credentials, query, or fragment");
  if (kind === "local" && (!LOOPBACK.has(url.hostname) || !new Set(["http:", "https:"]).has(url.protocol))) throw new Error("local qualification is restricted to loopback");
  if (kind !== "local" && url.protocol !== "https:") throw new Error("staged qualification requires HTTPS");
  if (kind === "staged-origin" && typeof authorize !== "function") throw new Error("a staged origin requires a request authorization provider");
  if (kind !== "staged-origin" && authorize !== null) throw new Error("authorization providers are restricted to staged origins");
  if (url.pathname.replace(/\/$/u, "") !== `/api/v1/${profileId}`) throw new Error("qualification URL path does not match the exact profile route");
  return Object.freeze({ kind, baseUrl: url.href.replace(/\/$/u, ""), profileId, authorize });
}

export function createHttpQualificationTransport(target, { fetchImpl = globalThis.fetch, requestIdPrefix = "qualification", requestTimeoutMs = 30000 } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
  if (typeof requestIdPrefix !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,95}$/u.test(requestIdPrefix)) throw new TypeError("qualification request ID prefix is invalid");
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 30000) throw new TypeError("qualification request timeout is invalid");
  let released = false;
  let sequence = 0;
  return Object.freeze({
    async request(operation, input = {}, { signal } = {}) {
      if (released) throw new Error("qualification transport is released");
      const method = new Set(["health", "bootstrap"]).has(operation) ? "GET" : "POST";
      const url = `${target.baseUrl}/${operation}`;
      const body = method === "POST" ? JSON.stringify(input) : null;
      const requestId = `${requestIdPrefix}-${++sequence}`;
      const headers = {
        "x-eacl-request-id": requestId,
        ...(method === "POST" ? {
          "content-type": "application/json; charset=utf-8",
          "x-amz-content-sha256": await jsonPayloadSha256(body)
        } : {})
      };
      const authorization = target.authorize ? await target.authorize({ method, url, headers: { ...headers }, body }) : {};
      const mergedHeaders = mergeAuthorizationHeaders(headers, authorization);
      const response = await fetchImpl(url, { method, headers: mergedHeaders, ...(body === null ? {} : { body }), signal: boundedSignal(signal, requestTimeoutMs), redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
      const envelope = await readBoundedJsonResponse(response);
      if (envelope?.meta?.requestId !== requestId) throw new Error("qualification response correlation mismatch");
      return envelope;
    },
    async probeFault(kind) {
      if (released) throw new Error("qualification transport is released");
      const probe = faultProbe(kind, target.baseUrl, `${requestIdPrefix}-${++sequence}`);
      if (probe.aborted) {
        const controller = new AbortController();
        const cancellation = setTimeout(() => controller.abort(new DOMException("manual qualification cancellation", "AbortError")), 1);
        try {
          await fetchImpl(probe.url, { method: probe.method, headers: probe.headers, signal: controller.signal, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
        } catch (error) {
          if (controller.signal.aborted && error?.name === "AbortError") return { kind, aborted: true };
          throw error;
        } finally {
          clearTimeout(cancellation);
        }
        throw new Error("cancelled fault probe unexpectedly reached a response");
      }
      const headers = {
        ...probe.headers,
        ...(probe.body === null ? {} : { "x-amz-content-sha256": await jsonPayloadSha256(probe.body) })
      };
      const response = await fetchImpl(probe.url, { method: probe.method, headers, ...(probe.body === null ? {} : { body: probe.body }), signal: AbortSignal.timeout(requestTimeoutMs), redirect: "error", credentials: "omit", referrerPolicy: "no-referrer" });
      const envelope = await readBoundedJsonResponse(response);
      if (envelope?.meta?.requestId !== probe.requestId) throw new Error("fault-probe response correlation mismatch");
      return { kind, aborted: false, status: response.status, envelope };
    },
    async release() { if (released) return false; released = true; return true; }
  });
}

function boundedSignal(signal, timeoutMs) {
  const deadline = AbortSignal.timeout(timeoutMs);
  if (signal === undefined) return deadline;
  if (!(signal instanceof AbortSignal)) throw new TypeError("qualification request signal is invalid");
  return AbortSignal.any([signal, deadline]);
}

function faultProbe(kind, baseUrl, requestId) {
  const common = { "x-eacl-request-id": requestId };
  switch (kind) {
    case "invalid-json":
      return { kind, requestId, method: "POST", url: `${baseUrl}/authorize`, headers: { ...common, "content-type": "application/json; charset=utf-8" }, body: "{" };
    case "oversized-body":
      return { kind, requestId, method: "POST", url: `${baseUrl}/authorize`, headers: { ...common, "content-type": "application/json; charset=utf-8" }, body: `{"padding":"${"a".repeat(65536)}"}` };
    case "unsupported-media-type":
      return { kind, requestId, method: "POST", url: `${baseUrl}/authorize`, headers: { ...common, "content-type": "text/plain" }, body: "{}" };
    case "wrong-method":
      return { kind, requestId, method: "GET", url: `${baseUrl}/authorize`, headers: common, body: null };
    case "mutation-route":
      return { kind, requestId, method: "POST", url: `${baseUrl}/seed`, headers: { ...common, "content-type": "application/json; charset=utf-8" }, body: "{}" };
    case "client-cancel":
      return { kind, requestId, method: "GET", url: `${baseUrl}/health`, headers: common, body: null, aborted: true };
    default:
      throw new TypeError("fault probe kind is invalid");
  }
}

function mergeAuthorizationHeaders(fixed, authorization) {
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) throw new TypeError("request authorization headers are invalid");
  const merged = {};
  for (const [key, value] of Object.entries(authorization)) {
    const normalized = key.toLowerCase();
    if (!/^[a-z0-9-]+$/u.test(normalized) || typeof value !== "string") throw new TypeError("request authorization header is invalid");
    if (Object.hasOwn(merged, normalized)) throw new Error("request authorization contains a duplicate header");
    merged[normalized] = value;
  }
  for (const [key, value] of Object.entries(fixed)) {
    if (Object.hasOwn(merged, key) && merged[key] !== value) throw new Error(`request authorization changed fixed header ${key}`);
    merged[key] = value;
  }
  return merged;
}

export function reportableTarget(target) {
  const url = new URL(target.baseUrl);
  return Object.freeze({ kind: target.kind, origin: url.origin, path: url.pathname, profileId: target.profileId });
}

export function assertTrustedCloudFrontOrigin(target, expectedOrigin) {
  if (!target || !new Set(["staged-cloudfront", "production-cloudfront"]).has(target.kind)) throw new TypeError("trusted-origin binding requires a CloudFront target");
  const expected = new URL(expectedOrigin);
  if (expected.protocol !== "https:" || expected.username || expected.password || expected.pathname !== "/" || expected.search || expected.hash || expected.port) throw new Error("trusted CloudFront origin is invalid");
  const actual = new URL(target.baseUrl ?? target.origin);
  if (actual.origin !== expected.origin) throw new Error("qualification target does not match the trusted CloudFront origin");
  return true;
}
