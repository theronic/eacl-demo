import limits from "../limits.v1.json" with { type: "json" };
import { parseApiRoute } from "./routes.mjs";

const CONSISTENCY = new Set(["current", "minimize", "authoritative", "at-least", "exact", "historical-date"]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const BODY_FIELDS = Object.freeze({
  "list-subjects": { optional: ["type", "pageSize", "cursor"] },
  "get-object": { required: ["type", "id"], optional: ["consistency"] },
  "list-relationships": { required: ["resourceType", "resourceId"], optional: ["relation", "pageSize", "cursor", "consistency"] },
  "reverse-relationships": { required: ["subjectType", "subjectId"], optional: ["relation", "pageSize", "cursor", "consistency"] },
  "authorize": { required: ["subjectType", "subjectId", "resourceType", "resourceId", "permission"], optional: ["consistency"] },
  "lookup-resources": { required: ["subjectType", "subjectId", "resourceType", "permission"], optional: ["pageSize", "cursor", "cache", "populateCache", "consistency"] },
  "lookup-subjects": { required: ["resourceType", "resourceId", "subjectType", "permission"], optional: ["pageSize", "cursor", "cache", "populateCache", "consistency"] },
  "count-resources": { required: ["subjectType", "subjectId", "resourceType", "permission"], optional: ["ceiling", "cache", "populateCache", "consistency"] },
  "get-schema": { optional: ["consistency"] },
  "get-cache-info": { optional: [] },
  "count-objects": { required: ["kind"], optional: ["type", "ceiling", "consistency"] }
});

export function validateHttpRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return rejected("validation-error");
  const { path, method, contentType = null, query = "", body = null, requestId } = request;
  if (typeof path !== "string" || path.includes("%") || path.includes("//") || path.endsWith("/")) return rejected("route-not-found");
  if (typeof query !== "string" || query.length > 0) return rejected("validation-error");
  const route = parseApiRoute(path, method);
  if (!route.ok) return route;
  if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 128) return rejected("validation-error");

  if (method.toUpperCase() === "GET") {
    if (contentType !== null || (body !== null && body !== "")) return rejected("unsupported-media-type");
    return { ...route, requestId, input: {} };
  }
  if (!new Set(["application/json", "application/json; charset=utf-8"]).has(contentType?.toLowerCase())) return rejected("unsupported-media-type");
  if (typeof body !== "string" || byteLength(body) > limits.requestBodyBytes) return rejected("request-too-large");
  let input;
  try { input = JSON.parse(body); } catch { return rejected("validation-error"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return rejected("validation-error");
  const fields = BODY_FIELDS[route.operation];
  if (!fields || !validKeys(input, fields.required ?? [], fields.optional)) return rejected("validation-error");
  if (!validValues(input)) return rejected("validation-error");
  return { ...route, requestId, input };
}

function validKeys(input, required, optional) {
  const keys = Object.keys(input);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in input) && keys.every((key) => allowed.has(key)) && keys.length <= limits.arrayItems;
}

function validValues(input) {
  for (const [key, value] of Object.entries(input)) {
    if (["pageSize"].includes(key) && (!Number.isSafeInteger(value) || value < 1 || value > limits.maximumPageSize)) return false;
    if (key === "ceiling" && (!Number.isSafeInteger(value) || value < 1 || value > limits.countCeiling)) return false;
    if (key === "cursor" && (typeof value !== "string" || byteLength(value) > limits.cursorBytes)) return false;
    if (["cache", "populateCache"].includes(key) && typeof value !== "boolean") return false;
    if (key === "consistency" && !CONSISTENCY.has(value)) return false;
    if (!["pageSize", "ceiling", "cursor", "cache", "populateCache", "consistency"].includes(key) && (typeof value !== "string" || byteLength(value) > limits.identifierBytes || !IDENTIFIER.test(value))) return false;
  }
  return true;
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function rejected(code) {
  return { ok: false, code };
}
