import { assertDescriptorIdentity } from "./profile-controller.mjs";

const PANEL_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const PORTABLE_FIELDS = new Set(["subject", "subjectType", "resourceType", "resourceId", "permission", "relation", "view"]);
const THEMES = new Set(["system", "light", "dark"]);
const MAX_PAGE_SIZE = 1000;
const DEFAULT_PREFERENCES = Object.freeze({ theme: "system", pageSize: 20, cacheEnabled: true, consistencyMode: "current", expanded: [] });
let announcementSequence = 0;

/**
 * Framework-neutral explorer state. A SolidJS adapter can subscribe through
 * onState without putting transport ownership or stale-response rules in UI
 * components.
 */
export function createExplorerController({
  transportFactory,
  onState = () => {},
  initialPreferences = {},
  clock = () => Date.now(),
  scheduleInterval = (callback, milliseconds) => setInterval(callback, milliseconds),
  clearScheduledInterval = (handle) => clearInterval(handle),
  startupTickMs = 1_000
}) {
  if (typeof transportFactory !== "function") throw new TypeError("transportFactory is required");
  if (typeof onState !== "function") throw new TypeError("onState must be a function");

  let epoch = 0;
  let requestSequence = 0;
  let session = null;
  let state = initialState(validatePreferences({ ...DEFAULT_PREFERENCES, ...initialPreferences }));
  let startupTimer = null;
  let lastProfile = null;
  let lastPortableIntent = {};
  const released = new WeakSet();
  const panelRequests = new Map();
  const retryInputs = new Map();

  function publish(patch) {
    state = { ...state, ...patch };
    onState(structuredClone(state));
  }

  function publishPanel(panelId, patch, message = null, politeness = "polite") {
    publish({
      panels: { ...state.panels, [panelId]: { ...(state.panels[panelId] ?? emptyPanel()), ...patch } },
      ...(message === null ? {} : { announcement: announcement(message, politeness) })
    });
  }

  async function release(transport) {
    if (!transport || released.has(transport)) return;
    released.add(transport);
    await transport.release?.();
  }

  async function switchProfile(profile, portableIntent = state.portableIntent) {
    validateEnabledProfile(profile);
    stopStartupTimer();
    const nextEpoch = ++epoch;
    lastProfile = structuredClone(profile);
    lastPortableIntent = sanitizePortableIntent(portableIntent);
    const previous = session;
    session = null;
    previous?.controller.abort("profile-switch");
    abortPanels("profile-switch");
    retryInputs.clear();
    publish({
      epoch: nextEpoch,
      status: "switching",
      profile: publicProfile(profile),
      descriptor: null,
      portableIntent: sanitizePortableIntent(portableIntent),
      panels: {},
      error: null,
      startup: { phase: "initializing", kind: "cold-or-restore", startedAt: clock(), elapsedMs: 0 },
      announcement: announcement(`Initializing ${profile.backend} with ${profile.storage}.`)
    });
    startStartupTimer(nextEpoch);
    try {
      await release(previous?.transport);
    } catch (error) {
      if (nextEpoch === epoch) {
        stopStartupTimer();
        publish({ status: "error", descriptor: null, startup: finishStartup("error"), error: safeError(error, "The previous profile could not be released safely."), announcement: announcement("The previous profile could not be released safely.", "assertive") });
      }
      throw error;
    }
    if (nextEpoch !== epoch) return { outcome: "stale", epoch: nextEpoch };

    const controller = new AbortController();
    let transport = null;
    try {
      transport = transportFactory(profile, { epoch: nextEpoch, signal: controller.signal });
      if (!transport || typeof transport.bootstrap !== "function" || typeof transport.request !== "function") throw new TypeError("transport must implement bootstrap and request");
      session = { epoch: nextEpoch, controller, transport };
      const descriptor = await transport.bootstrap({ epoch: nextEpoch, signal: controller.signal });
      if (controller.signal.aborted || nextEpoch !== epoch) {
        await release(transport);
        return { outcome: "stale", epoch: nextEpoch };
      }
      assertDescriptorIdentity(profile, descriptor);
      validateDescriptorCapabilities(profile, descriptor);
      const preferences = normalizePreferencesForDescriptor(state.preferences, descriptor);
      stopStartupTimer();
      publish({ status: "ready", descriptor, preferences, startup: finishStartup("ready", descriptor), error: null, announcement: announcement(`${profile.backend} with ${profile.storage} is ready.`) });
      return { outcome: "ready", epoch: nextEpoch, descriptor: structuredClone(descriptor) };
    } catch (error) {
      if (controller.signal.aborted || nextEpoch !== epoch) {
        stopStartupTimer();
        await release(transport);
        return { outcome: "stale", epoch: nextEpoch };
      }
      stopStartupTimer();
      await release(transport);
      if (transport && session?.transport === transport) session = null;
      publish({ status: "error", descriptor: null, startup: finishStartup("error"), error: safeError(error, "Profile initialization failed."), announcement: announcement("Profile initialization failed.", "assertive") });
      throw error;
    }
  }

  async function runPanel(panelId, operation, input = {}, { validate = (value) => value } = {}) {
    validatePanelId(panelId);
    const current = session;
    if (!current || state.status !== "ready" || !state.descriptor) throw new Error("profile transport is not ready");
    if (!state.descriptor.capabilities.operations.includes(operation)) {
      const error = typedError("unsupported-capability", "This profile does not advertise that operation.", false);
      publishPanel(panelId, { phase: "error", operation, error: safeError(error), retryable: false }, `${panelId} is unavailable.`, "assertive");
      throw error;
    }

    panelRequests.get(panelId)?.controller.abort("superseded");
    const controller = new AbortController();
    const unlink = forwardAbort(current.controller.signal, controller);
    const requestId = `${current.epoch}-${++requestSequence}`;
    const request = { controller, epoch: current.epoch, requestId, operation };
    panelRequests.set(panelId, request);
    retryInputs.set(panelId, { operation, input: structuredClone(input), validate });
    publishPanel(panelId, { phase: "loading", operation, requestId, error: null, retryable: false });

    try {
      const result = await current.transport.request(operation, structuredClone(input), {
        epoch: current.epoch,
        requestId,
        signal: controller.signal
      });
      if (!isCurrentPanelRequest(panelId, request) || controller.signal.aborted || current.epoch !== epoch) return { outcome: "stale", epoch: current.epoch, requestId };
      if (result?.ok === false) {
        const error = safeEnvelopeError(result.error);
        publishPanel(panelId, { phase: "error", requestId, error, retryable: error.retryable, meta: result.meta ?? null }, `${panelId} failed.`, "assertive");
        return { outcome: "failure", epoch: current.epoch, requestId, error };
      }
      const value = validate(result?.ok === true ? result.data : result);
      publishPanel(panelId, { phase: "ready", requestId, value, error: null, retryable: false, meta: result?.ok === true ? result.meta : null }, `${panelId} updated.`);
      return { outcome: "success", epoch: current.epoch, requestId, value: structuredClone(value) };
    } catch (error) {
      if (!isCurrentPanelRequest(panelId, request) || current.epoch !== epoch) return { outcome: "stale", epoch: current.epoch, requestId };
      if (controller.signal.aborted) {
        publishPanel(panelId, { phase: "canceled", requestId, error: null, retryable: true }, `${panelId} canceled.`);
        return { outcome: "canceled", epoch: current.epoch, requestId };
      }
      const publicFailure = safeError(error);
      publishPanel(panelId, { phase: "error", requestId, error: publicFailure, retryable: publicFailure.retryable }, `${panelId} failed.`, "assertive");
      return { outcome: "failure", epoch: current.epoch, requestId, error: publicFailure };
    } finally {
      unlink();
      if (isCurrentPanelRequest(panelId, request)) panelRequests.delete(panelId);
    }
  }

  function cancelPanel(panelId) {
    validatePanelId(panelId);
    const request = panelRequests.get(panelId);
    if (!request) return false;
    request.controller.abort("user-cancel");
    session?.transport.cancel?.(request.requestId);
    return true;
  }

  function retryPanel(panelId) {
    validatePanelId(panelId);
    const previous = retryInputs.get(panelId);
    if (!previous) throw new Error("panel has no request to retry");
    return runPanel(panelId, previous.operation, previous.input, { validate: previous.validate });
  }

  async function cancelStartup() {
    const current = session;
    if (state.status !== "switching") return false;
    session = null;
    ++epoch;
    current?.controller.abort("user-cancel");
    abortPanels("user-cancel");
    stopStartupTimer();
    try {
      await release(current?.transport);
      publish({ epoch, status: "canceled", descriptor: null, panels: {}, startup: finishStartup("canceled"), error: null, announcement: announcement("Profile initialization canceled.") });
      return true;
    } catch (error) {
      publish({ epoch, status: "error", descriptor: null, panels: {}, startup: finishStartup("error"), error: safeError(error, "Profile cancellation cleanup failed."), announcement: announcement("Profile cancellation cleanup failed.", "assertive") });
      throw error;
    }
  }

  function retryProfile() {
    if (!lastProfile) throw new Error("profile has not been selected");
    return switchProfile(lastProfile, lastPortableIntent);
  }

  function setPortableIntent(intent) {
    publish({ portableIntent: sanitizePortableIntent(intent) });
    return structuredClone(state.portableIntent);
  }

  function setPreferences(patch) {
    const next = validatePreferences({ ...state.preferences, ...patch });
    const normalized = state.descriptor ? normalizePreferencesForDescriptor(next, state.descriptor) : next;
    publish({ preferences: normalized });
    return structuredClone(normalized);
  }

  async function close() {
    const current = session;
    session = null;
    ++epoch;
    stopStartupTimer();
    current?.controller.abort("controller-close");
    abortPanels("controller-close");
    retryInputs.clear();
    await release(current?.transport);
    publish({ ...initialState(state.preferences), epoch, status: "closed" });
  }

  return {
    switchProfile,
    runPanel,
    cancelPanel,
    retryPanel,
    cancelStartup,
    retryProfile,
    setPortableIntent,
    setPreferences,
    close,
    getState: () => structuredClone(state)
  };

  function abortPanels(reason) {
    for (const { controller } of panelRequests.values()) controller.abort(reason);
    panelRequests.clear();
  }

  function isCurrentPanelRequest(panelId, request) {
    return panelRequests.get(panelId) === request;
  }

  function startStartupTimer(startupEpoch) {
    startupTimer = scheduleInterval(() => {
      if (startupEpoch !== epoch || state.status !== "switching" || !state.startup) return;
      publish({ startup: { ...state.startup, elapsedMs: Math.max(0, clock() - state.startup.startedAt) } });
    }, startupTickMs);
  }

  function stopStartupTimer() {
    if (startupTimer === null) return;
    clearScheduledInterval(startupTimer);
    startupTimer = null;
  }

  function finishStartup(phase, descriptor = null) {
    const startedAt = state.startup?.startedAt ?? clock();
    return {
      phase,
      kind: descriptor ? startupKind(descriptor) : (state.startup?.kind ?? "cold-or-restore"),
      startedAt,
      elapsedMs: Math.max(0, clock() - startedAt)
    };
  }
}

export function validateDescriptorCapabilities(profile, descriptor) {
  const capabilities = descriptor?.capabilities;
  if (!capabilities || !Array.isArray(capabilities.operations) || !Array.isArray(capabilities.consistencyModes)) throw new Error("descriptor capabilities are missing");
  if (!descriptor.profile || descriptor.profile.backend !== profile.backend || descriptor.profile.storage !== profile.storage) throw new Error("descriptor profile mapping mismatch");
  if (!capabilities.operations.includes("health") || !capabilities.operations.includes("bootstrap")) throw new Error("descriptor must advertise health and bootstrap");
  if (!capabilities.consistencyModes.includes("current")) throw new Error("descriptor must advertise current consistency");
  for (const field of ["snapshotBehavior", "cacheBehavior", "mutationLocality"]) if (typeof capabilities[field] !== "string") throw new Error(`descriptor ${field} is missing`);
  if (!Array.isArray(capabilities.limitations)) throw new Error("descriptor limitations are missing");
  return descriptor;
}

function normalizePreferencesForDescriptor(preferences, descriptor) {
  const modes = descriptor.capabilities.consistencyModes;
  return { ...preferences, consistencyMode: modes.includes(preferences.consistencyMode) ? preferences.consistencyMode : modes[0] };
}

function validatePreferences(preferences) {
  if (!THEMES.has(preferences.theme)) throw new TypeError("invalid theme preference");
  if (!Number.isSafeInteger(preferences.pageSize) || preferences.pageSize < 1 || preferences.pageSize > MAX_PAGE_SIZE) throw new TypeError("page size must be between 1 and 1000");
  if (typeof preferences.cacheEnabled !== "boolean") throw new TypeError("cache preference must be boolean");
  if (typeof preferences.consistencyMode !== "string" || preferences.consistencyMode.length > 32) throw new TypeError("invalid consistency preference");
  if (!Array.isArray(preferences.expanded) || preferences.expanded.some((value) => typeof value !== "string" || value.length > 64)) throw new TypeError("invalid expanded panel preferences");
  return { ...preferences, expanded: [...new Set(preferences.expanded)].slice(0, 32) };
}

function sanitizePortableIntent(intent) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) return {};
  return Object.fromEntries(Object.entries(intent).filter(([key, value]) => PORTABLE_FIELDS.has(key) && typeof value === "string" && new TextEncoder().encode(value).length <= 256));
}

function publicProfile(profile) {
  return { id: profile.id, backend: profile.backend, storage: profile.storage, state: profile.state };
}

function safeEnvelopeError(error) {
  return {
    code: typeof error?.code === "string" ? error.code.slice(0, 64) : "internal-error",
    message: typeof error?.message === "string" ? error.message.slice(0, 512) : "The explorer request failed.",
    retryable: error?.retryable === true,
    details: Array.isArray(error?.details) ? error.details.filter((item) => typeof item === "string").slice(0, 32).map((item) => item.slice(0, 256)) : []
  };
}

function safeError(error, fallback = "The explorer request failed.") {
  if (error && typeof error === "object" && typeof error.code === "string" && typeof error.publicMessage === "string") {
    return { code: error.code.slice(0, 64), message: error.publicMessage.slice(0, 512), retryable: error.retryable === true, details: [] };
  }
  return { code: "internal-error", message: fallback, retryable: false, details: [] };
}

function typedError(code, publicMessage, retryable) {
  const error = new Error(code);
  error.code = code;
  error.publicMessage = publicMessage;
  error.retryable = retryable;
  return error;
}

function validateEnabledProfile(profile) {
  if (!profile || profile.state !== "enabled" || !profile.deployment) throw new Error(profile?.reason ?? "profile is not enabled");
  if (typeof profile.backend !== "string" || typeof profile.storage !== "string") throw new Error("profile backend/storage mapping is missing");
}

function validatePanelId(panelId) {
  if (typeof panelId !== "string" || !PANEL_ID.test(panelId)) throw new TypeError("invalid panel ID");
}

function forwardAbort(parent, child) {
  if (parent.aborted) child.abort(parent.reason);
  const abort = () => child.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}

function emptyPanel() {
  return { phase: "idle", operation: null, requestId: null, value: null, error: null, retryable: false, meta: null };
}

function initialState(preferences) {
  return { epoch: 0, status: "idle", profile: null, descriptor: null, portableIntent: {}, preferences, panels: {}, startup: null, error: null, announcement: null };
}

function startupKind(descriptor) {
  if (descriptor.runtime.execution === "browser-worker") return "worker-initialization";
  return descriptor.runtime.snapStart === "enabled" ? "cold-or-restore" : "cold-start";
}

function announcement(message, politeness = "polite") {
  return { id: `announcement-${++announcementSequence}`, politeness, message: message.slice(0, 256) };
}

export const explorerDefaults = Object.freeze({ preferences: DEFAULT_PREFERENCES, maximumPageSize: MAX_PAGE_SIZE });
