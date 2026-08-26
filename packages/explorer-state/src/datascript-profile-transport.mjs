import { validateDescriptorHandshake } from "../../contracts/src/descriptor-handshake.mjs";
import { loadVerifiedDataScriptWorker } from "./verified-datascript-worker.mjs";
import { createDataScriptWorkerTransport } from "./worker-transport.mjs";

export function createDataScriptProfileTransport({
  profile,
  baseUrl,
  profileDefinitions,
  baseRegistry,
  validateEvent,
  onProgress = () => {},
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  createWorker,
  createBlob,
  createObjectUrl,
  revokeObjectUrl
}) {
  if (!profile || profile.id !== "datascript-browser-memory" || profile.state !== "enabled" || !profile.deployment) throw identityError("The DataScript profile is not an enabled immutable deployment.");
  if (typeof validateEvent !== "function") throw new TypeError("DataScript worker event validation is required");
  const lifecycle = new AbortController();
  let sessionPromise = null;
  let bootstrapped = false;
  let released = false;

  async function bootstrap({ signal } = {}) {
    assertOpen();
    const unlink = forwardAbort(signal, lifecycle);
    try {
      const session = await ensureSession();
      const bootstrapRequest = session.transport.request("bootstrap", {}, { signal: lifecycle.signal });
      const healthRequest = session.transport.request("health", {}, { signal: lifecycle.signal });
      const [bootstrapResponse, healthResponse] = await Promise.all([bootstrapRequest, healthRequest]);
      validateDescriptorHandshake({
        registryProfile: profile,
        route: "/datascript/",
        health: healthResponse.data,
        bootstrap: bootstrapResponse.data
      });
      bootstrapped = true;
      return bootstrapResponse.data;
    } finally {
      unlink();
    }
  }

  async function request(operation, input = {}, { signal } = {}) {
    assertOpen();
    if (!bootstrapped) throw identityError("The DataScript descriptor handshake has not completed.");
    const session = await ensureSession();
    try {
      return await session.transport.request(operation, input, { signal });
    } catch (error) {
      if (error?.response) return error.response;
      throw error;
    }
  }

  async function release() {
    if (released) return false;
    released = true;
    lifecycle.abort("transport-release");
    try {
      const session = await sessionPromise;
      session?.transport.close();
    } catch {
      // Failed initialization has no live worker transport to retain.
    }
    return true;
  }

  function cancel() {
    return false;
  }

  function ensureSession() {
    if (!sessionPromise) sessionPromise = initializeSession();
    return sessionPromise;
  }

  async function initializeSession() {
    let loaded;
    let transport;
    try {
      loaded = await loadVerifiedDataScriptWorker({
        baseUrl,
        profileDefinitions,
        baseRegistry,
        fetchImpl,
        cryptoImpl,
        signal: lifecycle.signal,
        ...(createWorker ? { createWorker } : {}),
        ...(createBlob ? { createBlob } : {}),
        ...(createObjectUrl ? { createObjectUrl } : {}),
        ...(revokeObjectUrl ? { revokeObjectUrl } : {})
      });
      assertSameProfile(loaded.profile, profile);
      transport = createDataScriptWorkerTransport({ worker: loaded.worker, expectedIdentity: loaded.identity, validateEvent, onProgress });
      await transport.initialize({ signal: lifecycle.signal });
      return { transport, identity: loaded.identity, assetUrl: loaded.assetUrl };
    } catch (error) {
      transport?.close();
      if (!transport) loaded?.worker?.terminate();
      throw error;
    }
  }

  function assertOpen() {
    if (released) throw new Error("DataScript profile transport is released");
  }

  return Object.freeze({ bootstrap, request, cancel, release });
}

function assertSameProfile(actual, expected) {
  if (!actual || actual.id !== expected.id || actual.backend !== expected.backend || actual.storage !== expected.storage || actual.route !== expected.route || actual.state !== "enabled") throw identityError("The current DataScript publication changed profile mapping.");
  const left = actual.deployment;
  const right = expected.deployment;
  if (!left || !right || left.demoSha !== right.demoSha || left.eaclSha !== right.eaclSha || left.artifact.kind !== right.artifact.kind || left.artifact.sha256 !== right.artifact.sha256 || left.artifact.version !== right.artifact.version || left.deploymentId !== right.deploymentId || left.dataManifestSha256 !== right.dataManifestSha256 || left.deployedAt !== right.deployedAt) throw identityError("The current DataScript publication changed immutable deployment identity.");
}

function forwardAbort(signal, controller) {
  if (!signal?.addEventListener) return () => {};
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function identityError(message) {
  const error = new Error(message);
  error.code = "identity-mismatch";
  error.publicMessage = message;
  error.retryable = false;
  return error;
}
