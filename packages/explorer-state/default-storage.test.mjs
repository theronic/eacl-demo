import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fastestEvidence } from "./support/fastest-evidence-fixture.mjs";
import { sealFastestEvidence } from "./src/fastest-evidence.mjs";
import { computeDecision, selectDefaultStorage } from "./src/default-storage.mjs";

const profiles = JSON.parse(await readFile(new URL("../contracts/profiles.v1.json", import.meta.url), "utf8"));
const enabledDatahike = {
  profiles: profiles.profiles.map(({ id }) => ({ id, state: id.startsWith("datahike-") ? "enabled" : "disabled", reason: id.startsWith("datahike-") ? null : "Not part of this focused test." }))
};

test("a primary benchmark winner becomes the fastest qualified default", () => {
  const evidence = fastestEvidence();
  assert.deepEqual(computeDecision(evidence), evidence.decision);
  assert.deepEqual(selectDefaultStorage({ backend: "datahike", profileDefinitions: profiles, availability: enabledDatahike, evidence, now: "2026-08-26T00:00:00Z" }), {
    outcome: "winner", profileId: "datahike-dynamodb", storage: "dynamodb", claim: "fastest-qualified", evidenceId: evidence.evidenceId, measuredAt: evidence.measuredAt, reason: null
  });
});

test("missing or stale evidence uses stable S3 fallback without a speed claim", () => {
  for (const evidence of [null, fastestEvidence()]) {
    const selected = selectDefaultStorage({ backend: "datahike", profileDefinitions: profiles, availability: enabledDatahike, evidence, now: "2026-10-01T00:00:00Z" });
    assert.deepEqual(selected, {
      outcome: "fallback", profileId: "datahike-s3", storage: "s3", claim: null, evidenceId: null, measuredAt: null,
      reason: "Comparable current benchmark evidence is unavailable; using the stable qualified fallback."
    });
  }
});

test("incomparable candidates and false published decisions are rejected", () => {
  const crossBackend = fastestEvidence({ profiles: ["datahike-s3", "datomic-dynamodb"] });
  assert.throws(() => selectDefaultStorage({ backend: "datahike", profileDefinitions: profiles, availability: enabledDatahike, evidence: crossBackend }), /comparison scope|evidence backend|exactly equal/u);
  const falseDecision = fastestEvidence();
  falseDecision.decision.defaultProfileId = "datahike-s3";
  assert.throws(() => selectDefaultStorage({ backend: "datahike", profileDefinitions: profiles, availability: enabledDatahike, evidence: reseal(falseDecision) }), /does not match/u);
});

test("uncertain primary result uses declared cold tie-break without claiming fastest", () => {
  const evidence = fastestEvidence();
  evidence.results[0] = { ...evidence.results[0], warmWeightedP95Ms: 20.5, warmP95Ci95Ms: [19.5, 21.5], coldOrRestoreP95Ms: 700 };
  evidence.decision = { ...evidence.decision, outcome: "benchmark-tiebreak", defaultProfileId: "datahike-s3", selectionBasis: "cold-or-restore-p95" };
  const sealed = reseal(evidence);
  assert.deepEqual(computeDecision(sealed), sealed.decision);
  assert.equal(selectDefaultStorage({ backend: "datahike", profileDefinitions: profiles, availability: enabledDatahike, evidence: sealed, now: "2026-08-26T00:00:00Z" }).claim, "benchmark-selected");
});

test("one or zero qualified choices carry no comparative claim", () => {
  const one = structuredClone(enabledDatahike);
  one.profiles.find(({ id }) => id === "datahike-dynamodb").state = "qualifying";
  assert.deepEqual(selectDefaultStorage({ backend: "datahike", profileDefinitions: profiles, availability: one }), {
    outcome: "sole-qualified", profileId: "datahike-s3", storage: "s3", claim: null, evidenceId: null, measuredAt: null, reason: "Only one qualified storage choice is enabled."
  });
  const none = { profiles: enabledDatahike.profiles.map((entry) => ({ ...entry, state: "qualifying" })) };
  assert.deepEqual(selectDefaultStorage({ backend: "datahike", profileDefinitions: profiles, availability: none }), {
    outcome: "none", profileId: null, storage: null, claim: null, evidenceId: null, measuredAt: null, reason: "No qualified storage choice is enabled."
  });
});

function reseal(evidence) {
  const copy = structuredClone(evidence);
  delete copy.evidenceId;
  return sealFastestEvidence(copy);
}
