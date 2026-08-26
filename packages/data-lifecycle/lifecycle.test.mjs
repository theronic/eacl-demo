import assert from "node:assert/strict";
import test from "node:test";

import {
  planBlueGreenPromotion,
  requireOrdinaryDeployManifest,
  transitionLifecycle,
  validateLifecycle
} from "./lifecycle.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const staging = {
  schema: "eacl-demo.data-lifecycle.v1",
  lifecycleId: "datahike-dynamodb:fixture-v1-green",
  profileId: "datahike-dynamodb",
  storageResourceId: "arn:aws:dynamodb:us-east-1:843761893873:table/eacl-demo-green",
  manifestDigest: digest("a"), fixtureDigest: digest("b"), previousLifecycleId: "datahike-dynamodb:fixture-v0-blue",
  createdAt: "2026-08-25T12:00:00Z", state: "staging", verifiedAt: null, servingAt: null, retiredAt: null
};

test("only forward lifecycle transitions may add their declared timestamp", () => {
  const verified = { ...staging, state: "verified", verifiedAt: "2026-08-25T13:00:00Z" };
  const serving = { ...verified, state: "serving", servingAt: "2026-08-25T14:00:00Z" };
  const retired = { ...serving, state: "retired", retiredAt: "2026-09-25T14:00:00Z" };
  assert.equal(transitionLifecycle(staging, verified), verified);
  assert.equal(transitionLifecycle(verified, serving), serving);
  assert.equal(transitionLifecycle(serving, retired), retired);
  assert.throws(() => transitionLifecycle(staging, serving), /forbidden/u);
  assert.throws(() => transitionLifecycle(serving, verified), /forbidden|must be null/u);
});

test("manifest, fixture, lifecycle, and physical resource identities never mutate in place", () => {
  const verified = { ...staging, state: "verified", verifiedAt: "2026-08-25T13:00:00Z" };
  for (const [field, value] of [["manifestDigest", digest("c")], ["fixtureDigest", digest("d")], ["lifecycleId", "datahike-dynamodb:other"], ["storageResourceId", "other-table"]]) {
    assert.throws(() => transitionLifecycle(staging, { ...verified, [field]: value }), /immutable/u, field);
  }
});

test("ordinary deploys verify exact serving data but cannot migrate it", () => {
  const serving = { ...staging, state: "serving", verifiedAt: "2026-08-25T13:00:00Z", servingAt: "2026-08-25T14:00:00Z" };
  assert.equal(requireOrdinaryDeployManifest(serving, staging.manifestDigest), serving);
  assert.throws(() => requireOrdinaryDeployManifest(serving, digest("e")), (error) => error.code === "stateful-migration-required");
});

test("blue-green promotion requires a distinct verified candidate and predecessor link", () => {
  const current = {
    ...staging,
    lifecycleId: "datahike-dynamodb:fixture-v0-blue",
    storageResourceId: "old-table",
    previousLifecycleId: null,
    state: "serving",
    verifiedAt: "2026-08-01T13:00:00Z",
    servingAt: "2026-08-01T14:00:00Z"
  };
  const candidate = { ...staging, state: "verified", verifiedAt: "2026-08-25T13:00:00Z" };
  assert.deepEqual(planBlueGreenPromotion(current, candidate), {
    profileId: "datahike-dynamodb",
    fromLifecycleId: current.lifecycleId,
    toLifecycleId: candidate.lifecycleId,
    expectedManifestDigest: candidate.manifestDigest,
    operation: "atomic-profile-data-pointer-update",
    mutateAcceptedLifecycle: false
  });
  assert.throws(() => planBlueGreenPromotion(current, { ...candidate, storageResourceId: current.storageResourceId }), /distinct/u);
  assert.equal(validateLifecycle(candidate), candidate);
});
