export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
    );
  }
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0))) {
    throw new TypeError(`canonical fixture JSON requires safe non-negative integers: ${value}`);
  }
  if (typeof value === "bigint") throw new TypeError("encode big integers as decimal strings");
  if (value === undefined) throw new TypeError("undefined is not canonical JSON");
  return value;
}
