const CONTRACT_VERSION = "explorer.v1";
const PROFILE_ID = "datascript-browser-memory";
const MAX_EPOCH = 2_147_483_647;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTITY_KEYS = ["artifactSha256", "dataManifestSha256", "demoSha", "deploymentId", "eaclSha", "profileId"];

export function createDataScriptWorkerTransport({ worker, expectedIdentity, validateEvent = (value) => value, onProgress = () => {}, initialEpoch = 1 }) {
  if (!worker || typeof worker.postMessage !== "function" || typeof worker.terminate !== "function") throw new TypeError("worker is required");
  if (!Number.isSafeInteger(initialEpoch) || initialEpoch < 1 || initialEpoch > MAX_EPOCH) throw new RangeError("initialEpoch is invalid");
  validateIdentity(expectedIdentity);

  let epoch = initialEpoch;
  let sequence = 0;
  let closed = false;
  let initialized = false;
  let initializing = false;
  const pending = new Map();

  const onMessage = (event) => {
    let message;
    try {
      message = validateEvent(event.data);
    } catch (error) {
      rejectAddressable(event.data, error);
      return;
    }
    if (closed || message.profileId !== PROFILE_ID || message.contractVersion !== CONTRACT_VERSION || message.clientEpoch !== epoch) return;
    if (message.type === "initialized") {
      settleInitialized(message);
      return;
    }
    if (message.type === "progress") {
      if (pending.has(message.requestId)) onProgress(structuredClone(message));
      return;
    }
    const request = pending.get(message.requestId);
    if (!request) return;
    if (message.type === "protocol-error") {
      pending.delete(message.requestId);
      request.cleanup();
      request.reject(typedError(message.error.code, message.error.message, message.error.retryable));
      return;
    }
    if (message.type !== "response") return;
    try {
      if (!initialized || request.kind === "initialize") throw identityError("The worker responded before the identity handshake completed.");
      if (message.response?.meta?.requestId !== message.requestId) throw identityError("The worker response correlation does not match its request.");
    } catch (error) {
      pending.delete(message.requestId);
      request.cleanup();
      request.reject(error);
      return;
    }
    pending.delete(message.requestId);
    request.cleanup();
    if (message.response && "data" in message.response && !("error" in message.response)) request.resolve(message.response);
    else request.reject(typedError(message.response.error.code, message.response.error.message, retryableError(message.response.error.code), message.response));
  };
  worker.addEventListener("message", onMessage);

  function initialize({ signal } = {}) {
    assertOpen();
    if (initialized) return Promise.resolve(structuredClone(expectedIdentity));
    if (initializing) throw new Error("DataScript worker identity initialization is already in progress");
    initializing = true;
    const requestId = nextRequestId();
    return enqueue({ ...base("initialize", requestId, epoch), identity: structuredClone(expectedIdentity) }, signal, "initialize")
      .finally(() => { initializing = false; });
  }

  function request(operation, input = {}, { signal } = {}) {
    assertOpen();
    assertInitialized();
    const requestId = nextRequestId();
    const message = base("request", requestId, epoch);
    Object.assign(message, { operation, input });
    return enqueue(message, signal, "request");
  }

  function reset({ signal } = {}) {
    assertOpen();
    assertInitialized();
    if (epoch === MAX_EPOCH) throw new RangeError("client epoch exhausted");
    rejectAll("canceled", "The DataScript worker epoch was replaced.");
    epoch += 1;
    const requestId = nextRequestId();
    return enqueue(base("reset", requestId, epoch), signal, "reset");
  }

  function cancel(requestId) {
    const request = pending.get(requestId);
    if (!request || closed) return false;
    worker.postMessage(base("cancel", requestId, epoch));
    pending.delete(requestId);
    request.cleanup();
    request.reject(abortError());
    return true;
  }

  function close() {
    if (closed) return false;
    closed = true;
    rejectAll("canceled", "The DataScript worker transport was closed.");
    worker.removeEventListener("message", onMessage);
    worker.terminate();
    return true;
  }

  function enqueue(message, signal, kind) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const abort = () => cancel(message.requestId);
      const cleanup = () => signal?.removeEventListener("abort", abort);
      pending.set(message.requestId, { resolve, reject, cleanup, kind });
      signal?.addEventListener("abort", abort, { once: true });
      worker.postMessage(structuredClone(message));
    });
  }

  function settleInitialized(message) {
    const request = pending.get(message.requestId);
    if (!request || request.kind !== "initialize") return;
    try {
      assertExactIdentity(message.identity, expectedIdentity);
      initialized = true;
      pending.delete(message.requestId);
      request.cleanup();
      request.resolve(structuredClone(expectedIdentity));
    } catch (error) {
      pending.delete(message.requestId);
      request.cleanup();
      request.reject(error);
    }
  }

  function rejectAddressable(candidate, error) {
    if (!candidate || typeof candidate !== "object" || candidate.clientEpoch !== epoch || typeof candidate.requestId !== "string") return;
    const request = pending.get(candidate.requestId);
    if (!request) return;
    pending.delete(candidate.requestId);
    request.cleanup();
    request.reject(error);
  }

  function rejectAll(code, message) {
    for (const request of pending.values()) {
      request.cleanup();
      request.reject(typedError(code, message, true));
    }
    pending.clear();
  }

  function nextRequestId() {
    sequence += 1;
    return `datascript-${epoch}-${sequence}`;
  }

  function assertOpen() {
    if (closed) throw new Error("DataScript worker transport is closed");
  }

  function assertInitialized() {
    if (!initialized) throw identityError("DataScript worker identity has not been initialized.");
  }

  return Object.freeze({
    initialize,
    request,
    reset,
    cancel,
    close,
    get initialized() { return initialized; },
    get clientEpoch() { return epoch; },
    get pendingCount() { return pending.size; }
  });
}

function validateIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity) || JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify(IDENTITY_KEYS)) throw identityError("DataScript worker identity has unknown or missing fields.");
  if (identity.profileId !== PROFILE_ID || !SHA1.test(identity.demoSha) || !SHA1.test(identity.eaclSha) || !SHA256.test(identity.artifactSha256) || !SHA256.test(identity.dataManifestSha256)) throw identityError("DataScript worker identity is invalid.");
  if (typeof identity.deploymentId !== "string" || identity.deploymentId.length < 1 || identity.deploymentId.length > 256) throw identityError("DataScript worker deployment identity is invalid.");
  return identity;
}

function assertExactIdentity(actual, expected) {
  validateIdentity(actual);
  if (IDENTITY_KEYS.some((key) => actual[key] !== expected[key])) throw identityError("DataScript worker response identity does not match its verified publication.");
}

function identityError(message) {
  return typedError("identity-mismatch", message, false);
}

function base(type, requestId, clientEpoch) {
  return { type, contractVersion: CONTRACT_VERSION, profileId: PROFILE_ID, requestId, clientEpoch };
}

function abortError() {
  const error = new Error("The DataScript worker request was canceled.");
  error.name = "AbortError";
  error.code = "canceled";
  return error;
}

function typedError(code, message, retryable, response = null) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  error.response = response;
  return error;
}

function retryableError(code) {
  return new Set(["cancelled", "canceled", "deadline-exceeded", "overloaded", "throttled", "dependency-unavailable"]).has(code);
}
