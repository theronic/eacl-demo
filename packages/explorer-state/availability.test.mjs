import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { availabilityByProfile, choicesForBackend, selectableProfile } from "./src/availability.mjs";

const readJson = (url) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [catalog, definitions, initial] = await Promise.all([
  readJson("../contracts/backend-storage.v1.json"),
  readJson("../contracts/profiles.v1.json"),
  readJson("../contracts/profile-availability.initial.v1.json")
]);

test("every initial profile is honestly non-selectable with a reason", () => {
  const profiles = availabilityByProfile(definitions, initial);
  assert.equal(profiles.size, 6);
  for (const profile of profiles.values()) {
    assert.equal(profile.selectable, false);
    assert.equal(typeof profile.reason, "string");
    assert.throws(() => selectableProfile(profile), new RegExp(profile.reason.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

test("all four states are implemented and only enabled is selectable", () => {
  const states = ["enabled", "disabled", "qualifying", "unavailable"];
  for (const [index, state] of states.entries()) {
    const availability = structuredClone(initial);
    availability.profiles[index].state = state;
    availability.profiles[index].reason = state === "enabled" ? null : `Specific non-selectable reason for ${state}`;
    const profile = availabilityByProfile(definitions, availability).get(availability.profiles[index].id);
    assert.equal(profile.selectable, state === "enabled");
    if (state === "enabled") assert.equal(selectableProfile(profile), profile);
  }
});

test("Datahike choices retain independent states and explanations", () => {
  const choices = choicesForBackend(catalog, definitions, initial, "datahike");
  assert.deepEqual(choices.map(({ id, state }) => [id, state]), [["datahike-s3", "qualifying"], ["datahike-dynamodb", "unavailable"]]);
  assert.equal(choices.every(({ reason }) => reason.length > 12), true);
});
