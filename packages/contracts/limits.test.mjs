import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = (url) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [limits, explorer] = await Promise.all([readJson("./limits.v1.json"), readJson("../../schemas/explorer.v1.schema.json")]);

test("request, response, strings, arrays, pages, counts, cursors, diagnostics and total output are bounded", () => {
  for (const [key, value] of Object.entries(limits)) {
    if (key === "$schema" || key === "schema") continue;
    assert.equal(Number.isSafeInteger(value) && value > 0, true, key);
  }
  assert.equal(limits.totalOutputBytes <= limits.responseBodyBytes, true);
  assert.equal(limits.defaultPageSize <= limits.maximumPageSize, true);
  assert.equal(limits.maximumPageSize <= limits.arrayItems, true);
  assert.equal(limits.diagnosticBytes < limits.responseBodyBytes, true);
});

test("wire-schema page, cursor, and identifier bounds match the central record", () => {
  assert.equal(explorer.$defs.pageInfo.properties.pageSize.maximum, limits.maximumPageSize);
  assert.equal(explorer.$defs.pageInfo.properties.endCursor.maxLength, limits.cursorBytes);
  assert.equal(explorer.$defs.identifier.maxLength, limits.identifierBytes);
});
