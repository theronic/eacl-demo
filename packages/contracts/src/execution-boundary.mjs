import limits from "../limits.v1.json" with { type: "json" };

export class BoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BoundaryError";
    this.code = code;
  }
}

export function createExecutionBoundary(options = {}) {
  const maximumConcurrency = options.maximumConcurrency ?? limits.admissionConcurrency;
  const deadlineMs = options.deadlineMs ?? limits.requestDeadlineMs;
  const maximumResponseBytes = options.maximumResponseBytes ?? limits.responseBodyBytes;
  let active = 0;

  async function execute(handler, request, parentSignal = null) {
    if (active >= maximumConcurrency) throw new BoundaryError("overloaded", "Admission limit reached");
    active += 1;
    const controller = new AbortController();
    const cleanups = [];
    let deadlineReached = false;
    let cleaned = false;
    const parentAbort = () => controller.abort("parent-cancelled");
    parentSignal?.addEventListener("abort", parentAbort, { once: true });
    if (parentSignal?.aborted) parentAbort();
    const timer = setTimeout(() => { deadlineReached = true; controller.abort("deadline"); }, deadlineMs);
    const abortPromise = new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new BoundaryError(deadlineReached ? "deadline-exceeded" : "cancelled", deadlineReached ? "Request deadline exceeded" : "Request cancelled")), { once: true }));

    try {
      const handlerPromise = Promise.resolve().then(() => handler(request, {
        signal: controller.signal,
        deadlineAt: Date.now() + deadlineMs,
        onCleanup(cleanup) {
          if (typeof cleanup !== "function") throw new Error("cleanup must be a function");
          cleanups.push(cleanup);
        }
      }));
      const response = await Promise.race([handlerPromise, abortPromise]);
      if (controller.signal.aborted) throw new BoundaryError(deadlineReached ? "deadline-exceeded" : "cancelled", "Request no longer active");
      let encoded;
      try { encoded = JSON.stringify(response); } catch { throw new BoundaryError("internal-error", "Response is not JSON serializable"); }
      if (new TextEncoder().encode(encoded).length > maximumResponseBytes) throw new BoundaryError("response-too-large", "Response exceeds configured limit");
      return response;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", parentAbort);
      if (!cleaned) {
        cleaned = true;
        for (const cleanup of cleanups.reverse()) await cleanup();
      }
      active -= 1;
    }
  }

  return { execute, activeCount: () => active, limits: Object.freeze({ maximumConcurrency, deadlineMs, maximumResponseBytes }) };
}
