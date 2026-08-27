import assert from "node:assert/strict";
import test from "node:test";

import { projectDescriptorPresentation } from "./src/descriptor-presentation.mjs";
import { mockCapabilityScenarios } from "./support/mock-transports.mjs";

test("every profile derives controls and truthful text only from its descriptor", () => {
  for (const { descriptor } of mockCapabilityScenarios) {
    const presentation = projectDescriptorPresentation(descriptor);
    assert.equal(presentation.operations.length, descriptor.capabilities.operations.length);
    assert.equal(presentation.consistency.modes.length, descriptor.capabilities.consistencyModes.length);
    assert.deepEqual(presentation.limitations.map(({ id }) => id), descriptor.capabilities.limitations);
    assert.equal(Object.values(presentation.controls).every((value) => typeof value === "boolean"), true);
    for (const item of [presentation.snapshot, presentation.cache, presentation.mutation, ...presentation.limitations]) {
      assert.equal(item.label.length > 3, true);
      assert.equal(item.description.length > 20, true);
    }
  }
});

test("the Jank store label and exclusions are explicit", () => {
  const descriptor = mockCapabilityScenarios.find(({ profile }) => profile.id === "jank-memory")?.descriptor;
  const presentation = projectDescriptorPresentation(descriptor);
  const byId = Object.fromEntries(presentation.limitations.map((item) => [item.id, item]));
  assert.equal(byId["datomic-like-not-datomic-pro"].label, "Bundled in-memory Datomic-like conformance store");
  for (const id of ["no-durability", "no-datalog-api", "no-distribution", "not-production-database"]) assert.ok(byId[id]);
});

test("fixed-snapshot consistency controls derive from capabilities without inspecting backend name", () => {
  const fixed = structuredClone(mockCapabilityScenarios.find(({ profile }) => profile.id === "datomic-dynamodb").descriptor);
  const original = projectDescriptorPresentation(fixed);
  fixed.profileId = "made-up-profile";
  fixed.profile.backend = "datahike";
  fixed.profile.storage = "s3";
  const renamed = projectDescriptorPresentation(fixed);
  assert.deepEqual(renamed.consistency, original.consistency);
  assert.deepEqual(renamed.snapshot, original.snapshot);
  assert.deepEqual(renamed.limitations, original.limitations);
  assert.deepEqual(original.consistency.modes.map(({ id }) => id),
    ["minimize", "authoritative", "at-least", "exact"]);
});

test("unknown capability terms fail closed instead of rendering invented prose", () => {
  const descriptor = structuredClone(mockCapabilityScenarios[0].descriptor);
  descriptor.capabilities.limitations.push("probably-consistent");
  assert.throws(() => projectDescriptorPresentation(descriptor), /unknown descriptor limitation/u);
});
