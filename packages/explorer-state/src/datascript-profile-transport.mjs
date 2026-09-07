import { localSeed as validateLocalSeed } from "../../contracts/src/generated/runtime-validators.mjs";
import { loadDataScriptRuntime } from "./datascript-runtime-loader.mjs";
import { validateDescriptorHandshake } from "../../contracts/src/descriptor-handshake.mjs";

export function createDataScriptProfileTransport({
  profile,
  runtimeProvider = loadDataScriptRuntime,
  cryptoImpl = globalThis.crypto,
}) {
  if (!profile || profile.id !== "datascript-browser-memory" || profile.state !== "enabled" || !profile.deployment) {
    throw identityError("The DataScript profile is not an enabled immutable deployment.");
  }
  if (profile.deployment.artifact.kind !== "static") {
    throw identityError("The DataScript profile does not identify its static browser runtime.");
  }
  let runtime;
  let initialization;
  const owner = requestId(cryptoImpl);
  let bootstrapped = false;
  let released = false;

  async function bootstrap({ signal } = {}) {
    assertOpen();
    throwIfAborted(signal);
    runtime ??= await runtimeProvider();
    assertOpen();
    throwIfAborted(signal);
    if (!runtime || typeof runtime.initialize !== "function" || typeof runtime.request !== "function") {
      throw identityError("The DataScript browser runtime did not load.");
    }
    initialization ??= Promise.resolve(runtime.initialize(identity(profile), owner)).catch((error) => {
      initialization = undefined;
      throw error;
    });
    await initialization;
    assertOpen();
    throwIfAborted(signal);
    const [bootstrapResponse, healthResponse] = await Promise.all([
      directRequest("bootstrap", {}, signal),
      directRequest("health", {}, signal),
    ]);
    if (bootstrapResponse.error || healthResponse.error) {
      throw identityError("The DataScript browser runtime did not complete its descriptor handshake.");
    }
    if (!validateLocalSeed(bootstrapResponse.data.localSeed)) throw identityError("Invalid local seed descriptor.");
    const handshake = validateDescriptorHandshake({
      registryProfile: profile,
      route: "/",
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
    assertOpen();
    throwIfAborted(signal);
    const local = ["seed-start", "seed-status", "seed-retry"].includes(operation);
    if (local && !validateLocalSeed({ operation, input })) throw new Error("Invalid local seed input.");
    const response = await runtime.request(operation, input, requestId(cryptoImpl), owner);
    if (local && response.data && !validateLocalSeed(response.data)) throw new Error("Invalid local seed progress.");
    assertOpen();
    throwIfAborted(signal);
    return response;
  }

  async function release() {
    if (released) return false;
    released = true;
    bootstrapped = false;
    initialization = undefined;
    return runtime?.release?.(owner) ?? true;
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
