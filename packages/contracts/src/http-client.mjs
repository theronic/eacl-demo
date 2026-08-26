const MAXIMUM_RESPONSE_BYTES = 1_048_576;
const SHA256 = /^[0-9a-f]{64}$/u;

export async function jsonPayloadSha256(body, { cryptoImpl = globalThis.crypto } = {}) {
  if (typeof body !== "string") throw new TypeError("JSON payload body must be a string");
  if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.digest !== "function") throw new Error("Web Crypto SHA-256 is unavailable");
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const value = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!SHA256.test(value)) throw new Error("SHA-256 implementation returned an invalid digest");
  return value;
}

export async function readBoundedJsonResponse(response, { maximumBytes = MAXIMUM_RESPONSE_BYTES } = {}) {
  const text = await readBoundedTextResponse(response, { maximumBytes });
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("response is not an object");
    return value;
  } catch (error) {
    if (error?.code === "response-too-large") throw error;
    const failure = new Error(`HTTP target returned invalid JSON object with status ${response.status ?? "unknown"}`);
    failure.code = "invalid-response";
    throw failure;
  }
}

export async function readBoundedTextResponse(response, { maximumBytes = MAXIMUM_RESPONSE_BYTES } = {}) {
  if (!response || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAXIMUM_RESPONSE_BYTES) throw new TypeError("bounded response configuration is invalid");
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined) {
    if (!/^[0-9]+$/u.test(declared) || Number(declared) > maximumBytes) throw responseTooLarge();
  }
  let text;
  if (typeof response.body?.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let total = 0;
    const parts = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new Error("HTTP response stream returned a non-byte chunk");
        total += value.byteLength;
        if (total > maximumBytes) {
          await reader.cancel("response-too-large");
          throw responseTooLarge();
        }
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
      text = parts.join("");
    } finally {
      reader.releaseLock?.();
    }
  } else if (typeof response.text === "function") {
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes) throw responseTooLarge();
  } else {
    throw new TypeError("HTTP response body is unreadable");
  }
  return text;
}

function responseTooLarge() {
  const error = new Error("HTTP response exceeds the one-megabyte client limit");
  error.code = "response-too-large";
  return error;
}
