import assert from "node:assert/strict";
import test from "node:test";
import { negotiateContract, requireCompatibleEvolution } from "./src/compatibility.mjs";

const identity = (routeMajor, revision) => ({ contract: `explorer.v${routeMajor}`, routeMajor, revision });

test("an N shell accepts only N and N-1 profile revisions on the same route", () => {
  assert.deepEqual(negotiateContract(identity(1, 1), identity(1, 1)), { compatible: true, mode: "N" });
  assert.deepEqual(negotiateContract(identity(1, 1), identity(1, 0)), { compatible: true, mode: "N-1" });
  assert.deepEqual(negotiateContract(identity(1, 2), identity(1, 0)), { compatible: false, reason: "profile-outside-n-minus-one-window" });
  assert.deepEqual(negotiateContract(identity(1, 0), identity(1, 1)), { compatible: false, reason: "profile-newer-than-client" });
  assert.deepEqual(negotiateContract(identity(2, 0), identity(1, 1)), { compatible: false, reason: "route-major-mismatch" });
});

test("incompatible semantics cannot reuse a route major", () => {
  assert.throws(() => requireCompatibleEvolution({ from: identity(1, 1), to: identity(1, 2), semantics: "incompatible" }), /new API route major/u);
  assert.equal(requireCompatibleEvolution({ from: identity(1, 1), to: identity(2, 0), semantics: "incompatible" }), true);
});

test("additive same-major evolution increments exactly one revision", () => {
  assert.equal(requireCompatibleEvolution({ from: identity(1, 1), to: identity(1, 2), semantics: "additive" }), true);
  assert.throws(() => requireCompatibleEvolution({ from: identity(1, 1), to: identity(1, 3), semantics: "additive" }), /increment contract revision by one/u);
});
