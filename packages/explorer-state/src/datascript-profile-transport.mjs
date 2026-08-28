import { validateDescriptorHandshake } from "../../contracts/src/descriptor-handshake.mjs";

export function createDataScriptProfileTransport({
  profile,
  runtimeProvider = () => globalThis.EaclDataScriptRuntime,
  cryptoImpl = globalThis.crypto,
}) {
  if (!profile || profile.id !== "datascript-browser-memory" || profile.state !== "enabled" || !profile.deployment) {
    throw identityError("The DataScript profile is not an enabled immutable deployment.");
  }
  if (profile.deployment.artifact.kind !== "static") {
    throw identityError("The DataScript profile does not identify its static browser runtime.");
  }
  let runtime;
  let initialized = false;
  let bootstrapped = false;
  let released = false;

  async function bootstrap({ signal } = {}) {
    assertOpen();
    throwIfAborted(signal);
    runtime ??= runtimeProvider();
    if (!runtime || typeof runtime.initialize !== "function" || typeof runtime.request !== "function") {
      throw identityError("The DataScript browser runtime did not load.");
    }
    if (!initialized) {
      await runtime.initialize(identity(profile));
      initialized = true;
    }
    const [bootstrapResponse, healthResponse] = await Promise.all([
      directRequest("bootstrap", {}, signal),
      directRequest("health", {}, signal),
    ]);
    if (bootstrapResponse.error || healthResponse.error) {
      throw identityError("The DataScript browser runtime did not complete its descriptor handshake.");
    }
    const handshake = validateDescriptorHandshake({
      registryProfile: profile,
      route: "/datascript/",
      health: healthResponse.data,
      bootstrap: bootstrapResponse.data,
    });
    bootstrapped = true;
    return {
      ...bootstrapResponse.data,
      ...(handshake.identityWarning ? { identityWarning: handshake.identityWarning } : {})
    };
  }

  async function request(operation, input = {}, { signal } = {}) {
    assertOpen();
    if (!bootstrapped) throw identityError("The DataScript descriptor handshake has not completed.");
    return directRequest(operation, input, signal);
  }

  async function directRequest(operation, input, signal) {
    throwIfAborted(signal);
    const response = await runtime.request(operation, input, requestId(cryptoImpl));
    throwIfAborted(signal);
    return response;
  }

  async function release() {
    if (released) return false;
    released = true;
    bootstrapped = false;
    initialized = false;
    return runtime?.release?.() ?? true;
  }

  function assertOpen() {
    if (released) throw new Error("DataScript profile transport is released");
  }

  return Object.freeze({ bootstrap, request, cancel: () => false, release });
}

function identity(profile) {
  return {
    profileId: profile.id,
    demoSha: profile.deployment.demoSha,
    eaclSha: profile.deployment.eaclSha,
    artifactSha256: profile.deployment.artifact.sha256,
    deploymentId: profile.deployment.deploymentId,
    dataManifestSha256: profile.deployment.dataManifestSha256,
  };
}

function requestId(cryptoImpl) {
  if (typeof cryptoImpl?.randomUUID === "function") return cryptoImpl.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The request was canceled.", "AbortError");
}

function identityError(message) {
  const error = new Error(message);
  error.code = "identity-mismatch";
  error.publicMessage = message;
  error.retryable = false;
  return error;
}
