import errorCatalog from "../error-codes.v1.json" with { type: "json" };

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const errors = new Map(errorCatalog.errors.map((error) => [error.code, error]));

export function createSuccess(context, data) {
  return { ok: true, meta: createMeta(context), data };
}

export function createFailure(context, code, details = []) {
  const definition = errors.get(code);
  if (!definition) throw new Error(`unknown stable error code: ${code}`);
  if (!Array.isArray(details) || details.length > 32 || details.some((detail) => typeof detail !== "string" || detail.length > 256)) throw new Error("failure details exceed contract limits");
  return {
    ok: false,
    meta: createMeta(context),
    error: { code, message: definition.message, retryable: definition.retryable, details: [...details] }
  };
}

export function httpStatusForError(code) {
  const definition = errors.get(code);
  if (!definition) throw new Error(`unknown stable error code: ${code}`);
  return definition.httpStatus;
}

function createMeta(context) {
  exactKeys(context, ["requestId", "operation", "identity", "basis"], "response context");
  if (typeof context.requestId !== "string" || context.requestId.length < 1 || context.requestId.length > 128) throw new Error("request ID is invalid");
  if (!new Set(["health", "bootstrap", "list-subjects", "get-object", "list-relationships", "reverse-relationships", "authorize", "lookup-resources", "lookup-subjects", "count-resources", "get-schema", "get-cache-info", "count-objects"]).has(context.operation)) throw new Error("response operation is invalid");
  const identity = validateIdentity(context.identity);
  return { contractVersion: "explorer.v1", requestId: context.requestId, operation: context.operation, identity: { ...identity }, basis: context.basis === null ? null : structuredClone(context.basis) };
}

function validateIdentity(identity) {
  exactKeys(identity, ["profileId", "demoSha", "eaclSha", "artifactSha256", "deploymentId", "dataManifestSha256"], "response identity");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(identity.profileId)) throw new Error("profile identity is invalid");
  if (!SHA1.test(identity.demoSha) || !SHA1.test(identity.eaclSha)) throw new Error("source identity is invalid");
  if (!SHA256.test(identity.artifactSha256) || !SHA256.test(identity.dataManifestSha256)) throw new Error("artifact or data identity is invalid");
  if (typeof identity.deploymentId !== "string" || identity.deploymentId.length < 1 || identity.deploymentId.length > 256) throw new Error("deployment identity is invalid");
  return identity;
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}
