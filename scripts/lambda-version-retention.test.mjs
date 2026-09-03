import assert from "node:assert/strict";
import test from "node:test";
import { stalePublishedVersions } from "./lib/lambda-version-retention.mjs";

test("retains the newest three numbered Lambda packages", () => {
  assert.deepEqual(stalePublishedVersions([
    { Version: "8" }, { Version: "$LATEST" }, { Version: "11" },
    { Version: "9" }, { Version: "10" }, { Version: "7" }
  ]), {
    retained: ["11", "10", "9"],
    stale: ["8", "7"]
  });
});

test("keeps all packages when fewer than the retention limit exist", () => {
  assert.deepEqual(stalePublishedVersions([
    { Version: "$LATEST" }, { Version: "2" }, { Version: "1" }
  ]), {
    retained: ["2", "1"],
    stale: []
  });
});

test("rejects an invalid retention limit", () => {
  assert.throws(() => stalePublishedVersions([], 0), /positive integer/u);
});
