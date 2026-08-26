import { createComponent, createContext, useContext, type ParentComponent } from "solid-js";
import type { ApiFailure, ApiSuccess } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, failure: ApiFailure) {
    super(failure.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = failure.error.code;
    this.details = failure.error.details;
  }
}
export type FetchImplementation = typeof fetch;
let fetchImplementation: FetchImplementation = (...args) => fetch(...args);
let requestTimeoutMs = 35_000;

export function apiPath(
  path: string,
  basePath = import.meta.env.BASE_URL,
  apiBaseUrl = import.meta.env.VITE_EACL_API_BASE_URL ?? "",
): string {
  if (!path.startsWith("/api")) return path;
  const apiBase = apiBaseUrl.replace(/\/$/, "");
  if (apiBase) return `${apiBase}${path}`;
  const base = basePath.replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export function setFetchImplementation(implementation?: FetchImplementation): void {
  fetchImplementation = implementation ?? ((...args) => fetch(...args));
}

export function setRequestTimeoutMs(value = 35_000): void {
  requestTimeoutMs = value;
}

function isSuccess<T>(value: unknown): value is ApiSuccess<T> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "data" in value &&
      "meta" in value &&
      typeof (value as ApiSuccess<T>).meta?.revision === "string",
  );
}

function isFailure(value: unknown): value is ApiFailure {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value &&
      typeof (value as ApiFailure).error?.code === "string" &&
      typeof (value as ApiFailure).error?.message === "string",
  );
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiSuccess<T>> {
  const callerSignal = options.signal;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, requestTimeoutMs);

  try {
    const response = await fetchImplementation(apiPath(path), {
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (
        timedOut ||
        callerSignal?.aborted ||
        error instanceof TypeError ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw error;
      }
      throw new ApiError(response.status || 500, {
        error: {
          code: "invalid-json-response",
          message: "The server returned an invalid JSON response.",
        },
      });
    }

    if (!response.ok) {
      if (isFailure(payload)) throw new ApiError(response.status, payload);
      throw new ApiError(response.status, {
        error: {
          code: "unexpected-api-response",
          message: "The server returned an unexpected error response.",
        },
      });
    }

    if (!isSuccess<T>(payload)) {
      throw new ApiError(500, {
        error: {
          code: "invalid-api-envelope",
          message: "The server returned an invalid success envelope.",
        },
      });
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) {
      throw new ApiError(408, {
        error: {
          code: "client-timeout",
          message: `The request did not finish within ${Math.max(1, Math.ceil(requestTimeoutMs / 1000))} seconds.`,
        },
      });
    }
    if (callerSignal?.aborted) throw error;
    throw new ApiError(0, {
      error: {
        code: "network-error",
        message: "The request could not reach the server. Check the connection and retry.",
      },
    });
  } finally {
    window.clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export type ApiDispatcher = <T>(
  path: string,
  options?: RequestInit,
) => Promise<ApiSuccess<T>>;

const ApiRuntime = createContext<ApiDispatcher>(apiRequest);

export const ApiProvider: ParentComponent<{ dispatcher: ApiDispatcher }> = (props) =>
  createComponent(ApiRuntime.Provider, {
    value: props.dispatcher,
    get children() {
      return props.children;
    },
  });

export class LatestRequest {
  private controller?: AbortController;
  private sequence = 0;

  constructor(private readonly dispatcher: ApiDispatcher = useContext(ApiRuntime)) {}

  async run<T>(path: string, options: RequestInit = {}): Promise<ApiSuccess<T>> {
    this.controller?.abort();
    const controller = new AbortController();
    const sequence = ++this.sequence;
    this.controller = controller;

    try {
      const result = await this.dispatcher<T>(path, {
        ...options,
        signal: controller.signal,
      });
      if (sequence !== this.sequence) {
        throw new DOMException("Superseded request", "AbortError");
      }
      return result;
    } finally {
      if (sequence === this.sequence) this.controller = undefined;
    }
  }

  abort(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.sequence += 1;
  }
}

export function jsonBody(value: unknown): Pick<RequestInit, "method" | "body"> {
  return { method: "POST", body: JSON.stringify(value) };
}
