import errorCatalog from "../error-codes.v1.json" with { type: "json" };

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const errors = new Map(errorCatalog.errors.map((error) => [error.code, error]));

export function createSuccess(context, data) {
  return { data, meta: createMeta(context) };
}

export function createFailure(context, code) {
  const definition = errors.get(code);
  if (!definition) throw new Error(`unknown stable error code: ${code}`);
  return {
    meta: createMeta(context),
    error: { code, message: definition.message }
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
  if (!new Set(["health", "bootstrap", "list-subjects", "get-object", "list-relationships", "reverse-relationships", "check-permission", "lookup-resources", "lookup-subjects", "count-resources", "get-schema", "get-cache-info", "count-objects"]).has(context.operation)) throw new Error("response operation is invalid");
  const identity = validateIdentity(context.identity);
  const revision = context.basis?.id ?? identity.deploymentId;
  if (typeof revision !== "string" || revision.length < 1 || revision.length > 256) throw new Error("response revision is invalid");
  return { revision, requestId: context.requestId };
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
