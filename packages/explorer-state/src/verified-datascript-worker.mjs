import { loadProfilePublication } from "./profile-publication.mjs";

const PROFILE_ID = "datascript-browser-memory";
const PROFILE_ROUTE = "/datascript/";
const MAXIMUM_WORKER_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const SHA256 = /^[0-9a-f]{64}$/u;
const JAVASCRIPT_MEDIA_TYPE = /^(?:application|text)\/(?:java|ecma)script(?:\s*;|$)/iu;

export async function loadVerifiedDataScriptWorker({
  baseUrl,
  profileDefinitions,
  baseRegistry,
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  signal,
  now = new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maximumBytes = MAXIMUM_WORKER_BYTES,
  createWorker = (url, options) => new Worker(url, options),
  createBlob = (parts, options) => new Blob(parts, options),
  createObjectUrl = (blob) => URL.createObjectURL(blob),
  revokeObjectUrl = (url) => URL.revokeObjectURL(url)
}) {
  if (typeof fetchImpl !== "function") throw new TypeError("DataScript worker fetch is unavailable");
  if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.digest !== "function") throw new TypeError("Web Crypto SHA-256 is unavailable");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new RangeError("worker timeout must be 100..30000 milliseconds");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAXIMUM_WORKER_BYTES) throw new RangeError("worker byte limit must be 1..4194304");

  const publication = await loadProfilePublication({
    baseUrl,
    profileId: PROFILE_ID,
    profileDefinitions,
    baseRegistry,
    fetchImpl,
    cryptoImpl,
    signal,
    now
  });
  const profile = publication.profile;
  if (profile.state !== "enabled" || !profile.deployment) throw workerError("profile-unavailable", "The DataScript profile is not enabled by a verified publication.");
  if (profile.route !== PROFILE_ROUTE || profile.backend !== "datascript" || profile.storage !== "browser-memory") throw workerError("identity-mismatch", "The DataScript publication does not match the closed browser profile.");
  if (profile.deployment.artifact.kind !== "browser-worker" || !SHA256.test(profile.deployment.artifact.sha256)) throw workerError("identity-mismatch", "The DataScript publication does not identify a browser worker artifact.");

  const origin = validateOrigin(baseUrl);
  const digest = profile.deployment.artifact.sha256;
  const assetPath = `${PROFILE_ROUTE}assets/datascript-worker-${digest}.js`;
  const assetUrl = new URL(assetPath, origin);
  const bytes = await fetchWorkerBytes(assetUrl, { fetchImpl, signal, timeoutMs, maximumBytes });
  const actualDigest = await sha256Hex(bytes, cryptoImpl);
  if (actualDigest !== digest) throw workerError("artifact-digest-mismatch", "The DataScript worker bytes do not match the published artifact digest.");

  const identity = Object.freeze({
    profileId: profile.id,
    demoSha: profile.deployment.demoSha,
    eaclSha: profile.deployment.eaclSha,
    artifactSha256: digest,
    deploymentId: profile.deployment.deploymentId,
    dataManifestSha256: profile.deployment.dataManifestSha256
  });
  const blob = createBlob([bytes], { type: "text/javascript;charset=utf-8" });
  const objectUrl = createObjectUrl(blob);
  let worker;
  try {
    worker = createWorker(objectUrl, { name: "eacl-datascript", type: "classic" });
  } finally {
    revokeObjectUrl(objectUrl);
  }
  if (!worker || typeof worker.postMessage !== "function" || typeof worker.terminate !== "function") throw workerError("worker-start-failed", "The verified DataScript worker could not be started.");
  return Object.freeze({ worker, profile: structuredClone(profile), identity, assetUrl: assetUrl.href, artifactBytes: bytes.byteLength });
}

async function fetchWorkerBytes(url, { fetchImpl, signal, timeoutMs, maximumBytes }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener?.("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("DataScript worker request timed out")), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "text/javascript, application/javascript;q=0.9" },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
    if (!response?.ok || response.status !== 200) throw workerError("worker-http-failed", "The DataScript worker returned a non-success status.");
    if (response.redirected === true || (typeof response.url === "string" && response.url.length > 0 && response.url !== url.href)) throw workerError("worker-redirected", "The DataScript worker redirected or resolved to another URL.");
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!JAVASCRIPT_MEDIA_TYPE.test(contentType)) throw workerError("worker-content-type-invalid", "The DataScript worker response is not JavaScript.");
    const declaredLength = parseContentLength(response.headers?.get?.("content-length"));
    if (declaredLength !== null && declaredLength > maximumBytes) throw workerError("response-too-large", "The DataScript worker exceeds its byte limit.");
    return readBoundedBytes(response, maximumBytes);
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw workerError("worker-timeout", "The DataScript worker request timed out.");
    if (controller.signal.aborted) throw workerError("canceled", "The DataScript worker request was canceled.");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
}

async function readBoundedBytes(response, maximumBytes) {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw workerError("response-too-large", "The DataScript worker exceeds its byte limit.");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw workerError("response-too-large", "The DataScript worker exceeds its byte limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validateOrigin(baseUrl) {
  const url = new URL(baseUrl ?? globalThis.location?.href);
  const browserOrigin = globalThis.window?.location?.origin;
  if (browserOrigin && url.origin !== browserOrigin) throw workerError("worker-origin-invalid", "The DataScript worker must use the shell origin.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) throw workerError("worker-origin-invalid", "The DataScript worker requires HTTPS outside loopback preview.");
  return url;
}

function parseContentLength(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw workerError("worker-content-length-invalid", "The DataScript worker content length is invalid.");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw workerError("worker-content-length-invalid", "The DataScript worker content length is invalid.");
  return length;
}

async function sha256Hex(bytes, cryptoImpl) {
  const hash = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", bytes));
  return [...hash].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function workerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
