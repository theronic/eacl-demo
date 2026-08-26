import { logicalOperations } from "./routes.mjs";

const allowed = new Set(logicalOperations);

export function createReadOnlyDispatcher(handlers) {
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) throw new Error("handlers must be an object");
  const keys = Object.keys(handlers).sort();
  const expected = [...logicalOperations].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error("public handlers must be exactly the closed read-only operation set");
  for (const [operation, handler] of Object.entries(handlers)) {
    if (!allowed.has(operation) || typeof handler !== "function") throw new Error(`invalid public handler: ${operation}`);
  }
  const dispatchTable = new Map(logicalOperations.map((operation) => [operation, handlers[operation]]));

  return Object.freeze({
    operations: Object.freeze([...logicalOperations]),
    async dispatch(request, context) {
      if (!request || request.ok !== true || !allowed.has(request.operation)) return { ok: false, code: "route-not-found" };
      return dispatchTable.get(request.operation)(request.input, context);
    }
  });
}
