import assert from "node:assert/strict";
import test from "node:test";
import { localSeed, client } from "./src/generated/runtime-validators.mjs";

test("seed inputs are a local-only contract with bounded integer counts", () => {
  for (const count of [1, 1000, 100000]) assert.equal(localSeed({ operation: "seed-start", input: { resourceCount: count } }), true);
  for (const count of [0, -1, 1.5, 100001, Number.MAX_SAFE_INTEGER, "1000"]) {
    assert.equal(localSeed({ operation: "seed-start", input: { resourceCount: count } }), false);
  }
  assert.equal(localSeed({ operation: "seed-retry", input: {} }), true);
  assert.equal(localSeed({ operation: "seed-status", input: {} }), true);
  assert.equal(localSeed({ operation: "seed-start", input: { resourceCount: 1, unsafe: true } }), false);
  const serverRequest = { contractVersion: "explorer.v1", profileId: "datahike-s3", requestId: "local-test", operation: "bootstrap", input: {} };
  assert.equal(client(serverRequest), true);
  for (const operation of ["seed-start", "seed-status", "seed-retry"]) {
    assert.equal(client({ ...serverRequest, operation, input: operation === "seed-start" ? { resourceCount: 1 } : {} }), false);
  }
});

test("progress and modified dataset descriptor carry actual local counts", () => {
  const progress = { status: "ready", resourcesAdded: 1000, resourcesCompleted: 1000, resourcesTarget: 1000, totalResources: 11000, totalServers: 10922 };
  assert.equal(localSeed(progress), true);
  assert.equal(localSeed({ maximumResources: 100000, modified: true, progress }), true);
  assert.equal(localSeed({ ...progress, totalResources: -1 }), false);
});
