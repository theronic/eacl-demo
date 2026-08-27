const OPERATION_ROUTES = Object.freeze([
  ["health", "GET"],
  ["bootstrap", "GET"],
  ["list-subjects", "POST"],
  ["get-object", "POST"],
  ["list-relationships", "POST"],
  ["reverse-relationships", "POST"],
  ["check-permission", "POST"],
  ["lookup-resources", "POST"],
  ["lookup-subjects", "POST"],
  ["count-resources", "POST"],
  ["get-schema", "POST"],
  ["get-cache-info", "POST"],
  ["count-objects", "POST"]
]);
const METHOD_BY_OPERATION = new Map(OPERATION_ROUTES);
export function parseApiRoute(pathname, method) {
  if (typeof pathname !== "string" || typeof method !== "string") return failure("route-not-found");
  const match = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(pathname);
  if (!match) return failure("route-not-found");
  const [, operation] = match;
  if (!METHOD_BY_OPERATION.has(operation)) return failure("route-not-found");
  const expectedMethod = METHOD_BY_OPERATION.get(operation);
  if (method.toUpperCase() !== expectedMethod) return { ok: false, code: "method-not-allowed", allowedMethods: [expectedMethod] };
  return { ok: true, contractVersion: "explorer.v1", transport: "http", operation };
}

export const logicalOperations = Object.freeze(OPERATION_ROUTES.map(([operation]) => operation));
export const operationRoutes = Object.freeze(Object.fromEntries(OPERATION_ROUTES));

function failure(code) {
  return { ok: false, code };
}
