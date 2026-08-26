const KEY = /^[a-z][a-z0-9-]{0,63}$/u;

/** Prevents late async work from moving focus across requests/profile epochs. */
export function createAsyncFocusManager({ document = globalThis.document, enqueue = queueMicrotask } = {}) {
  let activeEpoch = 0;
  const pending = new Map();

  return {
    reset(epoch) {
      if (!Number.isSafeInteger(epoch) || epoch < 0) throw new TypeError("invalid focus epoch");
      activeEpoch = epoch;
      pending.clear();
    },
    expect(key, { epoch, requestId, targetId }) {
      validate(key, epoch, requestId, targetId);
      if (epoch !== activeEpoch) return false;
      pending.set(key, { epoch, requestId, targetId });
      return true;
    },
    settle(key, { epoch, requestId, fallbackId = null }) {
      if (!KEY.test(key)) throw new TypeError("invalid focus key");
      const expected = pending.get(key);
      if (!expected || epoch !== activeEpoch || expected.epoch !== epoch || expected.requestId !== requestId) return false;
      pending.delete(key);
      enqueue(() => {
        if (epoch !== activeEpoch) return;
        const preferred = focusable(document?.getElementById?.(expected.targetId));
        const fallback = fallbackId === null ? null : focusable(document?.getElementById?.(fallbackId));
        (preferred ?? fallback)?.focus({ preventScroll: false });
      });
      return true;
    },
    cancel(key) { return pending.delete(key); },
    getEpoch: () => activeEpoch
  };
}

function validate(key, epoch, requestId, targetId) {
  if (!KEY.test(key) || !Number.isSafeInteger(epoch) || epoch < 0 || typeof requestId !== "string" || requestId.length < 1 || requestId.length > 128 || typeof targetId !== "string" || targetId.length < 1 || targetId.length > 128) throw new TypeError("invalid focus request");
}

function focusable(element) {
  if (!element || element.isConnected === false || element.disabled === true || typeof element.focus !== "function") return null;
  return element;
}
