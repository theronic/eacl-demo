import limits from "../limits.v1.json" with { type: "json" };

const PAYLOAD_KEYS = ["version", "contractVersion", "profileId", "deploymentId", "dataManifestSha256", "lifecycleId", "operation", "querySha256", "position", "issuedAt", "expiresAt"];

export async function createCursorCodec({ keyBytes, profileId, contractVersion = "explorer.v1", deploymentId, dataManifestSha256, lifecycleId, ttlMs = 900000, now = () => Date.now(), crypto = globalThis.crypto }) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length < 32) throw new Error("cursor HMAC key must contain at least 32 bytes");
  if (!crypto?.subtle) throw new Error("Web Crypto is required");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const scope = { contractVersion, profileId, deploymentId, dataManifestSha256, lifecycleId };
  if (Object.values(scope).some((value) => typeof value !== "string" || value.length < 1)) throw new Error("cursor scope is incomplete");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 86400000) throw new Error("cursor TTL is invalid");

  return Object.freeze({
    async encode({ operation, query, position }) {
      const issuedAt = now();
      const payload = { version: 1, ...scope, operation, querySha256: await sha256(canonicalJson(query), crypto), position, issuedAt, expiresAt: issuedAt + ttlMs };
      validatePayload(payload);
      const body = new TextEncoder().encode(canonicalJson(payload));
      const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
      const token = `${base64url(body)}.${base64url(signature)}`;
      if (new TextEncoder().encode(token).length > limits.cursorBytes) throw cursorError("cursor-invalid", "Cursor exceeds its byte limit");
      return token;
    },
    async decode(token, { operation, query }) {
      if (typeof token !== "string" || new TextEncoder().encode(token).length > limits.cursorBytes) throw cursorError("cursor-invalid", "Cursor is malformed");
      const parts = token.split(".");
      if (parts.length !== 2) throw cursorError("cursor-invalid", "Cursor is malformed");
      let body;
      let signature;
      try { body = fromBase64url(parts[0]); signature = fromBase64url(parts[1]); } catch { throw cursorError("cursor-invalid", "Cursor encoding is invalid"); }
      if (!(await crypto.subtle.verify("HMAC", key, signature, body))) throw cursorError("cursor-invalid", "Cursor signature is invalid");
      let payload;
      try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { throw cursorError("cursor-invalid", "Cursor payload is invalid"); }
      validatePayload(payload);
      if (payload.expiresAt <= now()) throw cursorError("cursor-expired", "Cursor has expired");
      const expectedQuery = await sha256(canonicalJson(query), crypto);
      const scoped = { ...scope, operation, querySha256: expectedQuery };
      if (Object.entries(scoped).some(([name, value]) => payload[name] !== value)) throw cursorError("cursor-scope-mismatch", "Cursor scope does not match request");
      return structuredClone(payload.position);
    }
  });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify([...PAYLOAD_KEYS].sort())) throw cursorError("cursor-invalid", "Cursor payload fields are invalid");
  if (payload.version !== 1 || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= payload.issuedAt) throw cursorError("cursor-invalid", "Cursor timing is invalid");
  for (const key of ["contractVersion", "profileId", "deploymentId", "dataManifestSha256", "lifecycleId", "operation", "querySha256"]) if (typeof payload[key] !== "string" || payload[key].length < 1) throw cursorError("cursor-invalid", "Cursor scope is invalid");
  canonicalJson(payload.position);
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw cursorError("cursor-invalid", "Cursor contains unsupported data");
}

async function sha256(value, crypto) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/gu, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

function fromBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function cursorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
