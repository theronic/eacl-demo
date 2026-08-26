import { initialSelection } from "./selection.mjs";

const MAX_SEARCH_BYTES = 2048;
const FIELDS = [
  field("subject-type", "subjectType", 64, /^[A-Za-z][A-Za-z0-9._-]*$/u),
  field("subject", "subject", 128, /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u),
  field("resource-type", "resourceType", 64, /^[A-Za-z][A-Za-z0-9._-]*$/u),
  field("resource-id", "resourceId", 128, /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u),
  field("permission", "permission", 64, /^[A-Za-z][A-Za-z0-9._-]*$/u),
  field("relation", "relation", 64, /^[A-Za-z][A-Za-z0-9._-]*$/u),
  field("view", "view", 32, /^(?:objects|relationships|authorization|schema|cache)$/u),
  field("page-size", "pageSize", 4, /^(?:[1-9]|[1-9][0-9]{1,2}|1000)$/u, Number, String),
  field("cache", "cacheEnabled", 3, /^(?:on|off)$/u, (value) => value === "on", (value) => value ? "on" : "off"),
  field("consistency", "consistencyMode", 15, /^(?:current|minimize|authoritative|at-least|exact|historical-date)$/u)
];
const ALLOWED = new Set(["backend", "storage", ...FIELDS.map(({ parameter }) => parameter)]);
const FORBIDDEN = /(?:cursor|token|basis|revision|request|secret|password|credential|seed|cache-state|page)/iu;

export function parseCanonicalUrl(search, catalog) {
  const issues = [];
  const searchText = search.startsWith("?") ? search.slice(1) : search;
  if (byteLength(searchText) > MAX_SEARCH_BYTES) {
    const selection = initialSelection(catalog, new URLSearchParams());
    const state = { ...selection };
    return { state, issues: [{ code: "url-too-large", field: null }], canonicalSearch: serializeCanonicalUrl(state, catalog) };
  }

  const parameters = new URLSearchParams(searchText);
  const seen = new Set();
  for (const [key] of parameters) {
    if (seen.has(key)) issues.push({ code: "duplicate-field", field: key });
    seen.add(key);
    if (!ALLOWED.has(key)) issues.push({ code: FORBIDDEN.test(key) ? "forbidden-field" : "unknown-field", field: key });
  }

  const requestedBackend = parameters.get("backend");
  const requestedStorage = parameters.get("storage");
  const selection = initialSelection(catalog, parameters);
  if (requestedBackend !== null && requestedBackend !== selection.backend) issues.push({ code: "invalid-backend", field: "backend" });
  if (requestedStorage !== null && requestedStorage !== selection.storage) issues.push({ code: "invalid-storage", field: "storage" });
  const state = { ...selection };
  for (const { parameter, property, maxBytes, pattern, decode } of FIELDS) {
    const values = parameters.getAll(parameter);
    if (values.length === 0) continue;
    const value = values[0];
    if (byteLength(value) > maxBytes || !pattern.test(value)) issues.push({ code: "invalid-value", field: parameter });
    else state[property] = decode(value);
  }
  return { state, issues, canonicalSearch: serializeCanonicalUrl(state, catalog) };
}

export function serializeCanonicalUrl(state, catalog) {
  const selection = initialSelection(catalog, new URLSearchParams(`backend=${encodeURIComponent(state.backend ?? "")}&storage=${encodeURIComponent(state.storage ?? "")}`));
  const parameters = new URLSearchParams();
  parameters.set("backend", selection.backend);
  parameters.set("storage", selection.storage);
  for (const { parameter, property, maxBytes, pattern, encode } of FIELDS) {
    const value = state[property];
    if (value === undefined || value === null) continue;
    const encoded = encode(value);
    if (typeof encoded === "string" && byteLength(encoded) <= maxBytes && pattern.test(encoded)) parameters.set(parameter, encoded);
  }
  return `?${parameters.toString()}`;
}

export const canonicalUrlLimits = Object.freeze({ maxSearchBytes: MAX_SEARCH_BYTES, fields: Object.freeze(Object.fromEntries(FIELDS.map(({ parameter, maxBytes }) => [parameter, maxBytes]))) });

function field(parameter, property, maxBytes, pattern, decode = String, encode = String) {
  return Object.freeze({ parameter, property, maxBytes, pattern, decode, encode });
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}
