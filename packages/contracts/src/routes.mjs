const OPERATION_ROUTES = Object.freeze([
  ["health", "GET"],
  ["bootstrap", "GET"],
  ["list-subjects", "POST"],
  ["get-object", "POST"],
  ["list-relationships", "POST"],
  ["reverse-relationships", "POST"],
  ["authorize", "POST"],
  ["get-schema", "POST"],
  ["get-cache-info", "POST"],
  ["count-objects", "POST"]
]);
const METHOD_BY_OPERATION = new Map(OPERATION_ROUTES);
const SERVER_PROFILES = new Set(["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory", "jank-memory"]);

export function parseApiRoute(pathname, method) {
  if (typeof pathname !== "string" || typeof method !== "string") return failure("route-not-found");
  const match = /^\/api\/v1\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(pathname);
  if (!match) return failure("route-not-found");
  const [, profileId, operation] = match;
  if (!SERVER_PROFILES.has(profileId) || !METHOD_BY_OPERATION.has(operation)) return failure("route-not-found");
  const expectedMethod = METHOD_BY_OPERATION.get(operation);
  if (method.toUpperCase() !== expectedMethod) return { ok: false, code: "method-not-allowed", allowedMethods: [expectedMethod] };
  return { ok: true, contractVersion: "explorer.v1", transport: "http", profileId, operation };
}

export function parseWorkerMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return failure("validation-error");
  const keys = Object.keys(message).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["clientEpoch", "contractVersion", "input", "operation", "profileId", "requestId", "type"])) return failure("validation-error");
  if (message.contractVersion !== "explorer.v1" || message.profileId !== "datascript-browser-memory") return failure("identity-mismatch");
  if (message.type !== "request" || !Number.isSafeInteger(message.clientEpoch) || message.clientEpoch < 1 || message.clientEpoch > 2_147_483_647) return failure("validation-error");
  if (!METHOD_BY_OPERATION.has(message.operation)) return failure("route-not-found");
  if (typeof message.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(message.requestId) || !message.input || typeof message.input !== "object" || Array.isArray(message.input) || Object.keys(message.input).length > 32) return failure("validation-error");
  return { ok: true, contractVersion: "explorer.v1", transport: "worker", profileId: message.profileId, operation: message.operation, requestId: message.requestId, clientEpoch: message.clientEpoch, input: message.input };
}

export const logicalOperations = Object.freeze(OPERATION_ROUTES.map(([operation]) => operation));
export const operationRoutes = Object.freeze(Object.fromEntries(OPERATION_ROUTES));

function failure(code) {
  return { ok: false, code };
}
