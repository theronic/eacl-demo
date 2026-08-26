export function createProfileController({ transportFactory, onState = () => {} }) {
  if (typeof transportFactory !== "function") throw new Error("transportFactory is required");
  let epoch = 0;
  let lifecycle = null;
  let state = initialState();
  const released = new WeakSet();

  function publish(patch) {
    state = { ...state, ...patch };
    onState(structuredClone(state));
  }

  async function release(transport) {
    if (!transport || released.has(transport)) return;
    released.add(transport);
    await transport.release?.();
  }

  async function switchProfile(profile, portableIntent = {}) {
    validateEnabledProfile(profile);
    const nextEpoch = ++epoch;
    const previous = lifecycle;
    lifecycle = null;
    previous?.controller.abort("profile-switch");
    publish({
      epoch: nextEpoch,
      status: "switching",
      profileId: profile.id,
      page: 1,
      cursor: null,
      basis: null,
      pages: [],
      cache: null,
      error: null,
      portableIntent: sanitizePortableIntent(portableIntent)
    });
    await release(previous?.transport);
    if (nextEpoch !== epoch) return { outcome: "stale", epoch: nextEpoch };

    const controller = new AbortController();
    const transport = transportFactory(profile, { epoch: nextEpoch, signal: controller.signal });
    lifecycle = { epoch: nextEpoch, controller, transport };
    try {
      const descriptor = await transport.bootstrap({ signal: controller.signal, epoch: nextEpoch });
      if (controller.signal.aborted || nextEpoch !== epoch) {
        await release(transport);
        return { outcome: "stale", epoch: nextEpoch };
      }
      assertDescriptorIdentity(profile, descriptor);
      publish({ status: "ready", descriptor });
      return { outcome: "ready", epoch: nextEpoch, descriptor };
    } catch (error) {
      if (controller.signal.aborted || nextEpoch !== epoch) {
        await release(transport);
        return { outcome: "stale", epoch: nextEpoch };
      }
      await release(transport);
      lifecycle = null;
      publish({ status: "error", descriptor: null, error: publicError(error) });
      throw error;
    }
  }

  async function request(operation, input) {
    const current = lifecycle;
    if (!current || state.status !== "ready") throw new Error("profile transport is not ready");
    const requestEpoch = current.epoch;
    try {
      const result = await current.transport.request(operation, input, { signal: current.controller.signal, epoch: requestEpoch });
      if (requestEpoch !== epoch || current.controller.signal.aborted) return { outcome: "stale", epoch: requestEpoch };
      return { outcome: "success", epoch: requestEpoch, value: result };
    } catch (error) {
      if (requestEpoch !== epoch || current.controller.signal.aborted) return { outcome: "stale", epoch: requestEpoch };
      throw error;
    }
  }

  async function close() {
    const current = lifecycle;
    lifecycle = null;
    ++epoch;
    current?.controller.abort("controller-close");
    await release(current?.transport);
    publish({ ...initialState(), epoch, status: "closed" });
  }

  return { switchProfile, request, close, getState: () => structuredClone(state) };
}

export function assertDescriptorIdentity(profile, descriptor) {
  const actual = descriptor?.identity;
  if (!actual || actual.profileId !== profile.id) throw new Error("descriptor profile identity mismatch");
  if (descriptor.profile && (descriptor.profile.backend !== profile.backend || descriptor.profile.storage !== profile.storage)) throw new Error("descriptor backend/storage mapping mismatch");
  const expected = profile.deployment;
  if (!expected || !actual || actual.demoSha !== expected.demoSha || actual.eaclSha !== expected.eaclSha || actual.artifactSha256 !== expected.artifact.sha256 || actual.deploymentId !== expected.deploymentId || actual.dataManifestSha256 !== expected.dataManifestSha256) {
    throw new Error("descriptor deployment identity mismatch");
  }
  return descriptor;
}

function validateEnabledProfile(profile) {
  if (!profile || profile.state !== "enabled" || !profile.deployment) throw new Error(profile?.reason ?? "profile is not enabled");
}

function sanitizePortableIntent(intent) {
  const allowed = ["subject", "resourceType", "resourceId", "permission", "relation", "view"];
  return Object.fromEntries(allowed.filter((key) => typeof intent[key] === "string" && intent[key].length <= 256).map((key) => [key, intent[key]]));
}

function initialState() {
  return { epoch: 0, status: "idle", profileId: null, page: 1, cursor: null, basis: null, pages: [], cache: null, error: null, descriptor: null, portableIntent: {} };
}

function publicError(error) {
  return { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : "Profile switch failed" };
}
