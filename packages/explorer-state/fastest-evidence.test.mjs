import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { fastestEvidence } from "./support/fastest-evidence-fixture.mjs";
import { computeEvidenceId, isEvidenceCurrent, sealFastestEvidence, validateFastestEvidence } from "./src/fastest-evidence.mjs";

const schema = JSON.parse(await readFile(new URL("../../schemas/fastest-storage-evidence.v1.schema.json", import.meta.url), "utf8"));
const workloadBytes = await readFile(new URL("../../benchmarks/datahike-storage/workload.v1.json", import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

test("complete content-addressed comparable evidence validates", () => {
  const evidence = fastestEvidence();
  assert.equal(validateFastestEvidence(evidence), evidence);
  assert.equal(validateSchema(evidence), true, JSON.stringify(validateSchema.errors));
  assert.equal(evidence.evidenceId, computeEvidenceId(evidence));
  assert.equal(evidence.workload.digest, `sha256:${createHash("sha256").update(workloadBytes).digest("hex")}`);
});

test("scope, operation weights, production path, deployment binding, decision rule, and lifetime are fixed", () => {
  const mutations = [
    (evidence) => { evidence.methodVersion = "marketing-v2"; },
    (evidence) => { evidence.workload.operationWeights.checkPermission = 39; evidence.workload.operationWeights.bootstrap = 6; },
    (evidence) => { evidence.environment.productionPath = "direct-origin"; },
    (evidence) => { evidence.candidates[0].storage = "dynamodb"; },
    (evidence) => { evidence.candidates[0].deploymentId = ""; },
    (evidence) => { evidence.decision.minimumEffectFraction = 0; },
    (evidence) => { evidence.expiresAt = "2027-08-25T12:00:00Z"; }
  ];
  for (const mutate of mutations) {
    const evidence = fastestEvidence();
    mutate(evidence);
    const resealed = reseal(evidence);
    assert.throws(() => validateFastestEvidence(resealed));
  }
  const schemaDrift = fastestEvidence();
  schemaDrift.candidates[0].extra = true;
  assert.equal(validateSchema(schemaDrift), false);
  const evidence = fastestEvidence();
  assert.equal(isEvidenceCurrent(evidence, "2026-08-25T11:59:59Z"), false);
  assert.equal(isEvidenceCurrent(evidence, "2026-08-25T12:00:00Z"), true);
});

test("content mutation without resealing is rejected", () => {
  const evidence = fastestEvidence();
  evidence.results[0].warmWeightedP95Ms += 1;
  assert.throws(() => validateFastestEvidence(evidence), /evidence ID does not match/u);
});

test("incomparable fixture, workload, source, runtime, cache, or memory bindings are rejected", () => {
  const mutations = [
    (evidence) => { evidence.candidates[1].dataManifestDigest = `sha256:${"0".repeat(64)}`; },
    (evidence) => { evidence.candidates[1].workloadDigest = `sha256:${"1".repeat(64)}`; },
    (evidence) => { evidence.candidates[1].demoSha = "2".repeat(40); },
    (evidence) => { evidence.candidates[1].runtime = "java21"; },
    (evidence) => { evidence.candidates[1].cacheLanesDigest = `sha256:${"3".repeat(64)}`; },
    (evidence) => { evidence.candidates[1].memoryMb = 4096; },
    (evidence) => { evidence.candidates[1].snapStart = "None"; }
  ];
  for (const mutate of mutations) {
    const evidence = fastestEvidence();
    mutate(evidence);
    const resealed = reseal(evidence);
    assert.throws(() => validateFastestEvidence(resealed), /incomparable|environment differs/u);
  }
});

test("partial candidates, expired qualification, errors, and insufficient samples fail closed", () => {
  assert.throws(() => validateFastestEvidence(fastestEvidence({ candidates: [fastestEvidence().candidates[0]] })), /exactly match/u);
  const expired = fastestEvidence();
  expired.candidates[0].qualificationExpiresAt = "2026-08-25T11:00:00Z";
  assert.throws(() => validateFastestEvidence(reseal(expired)), /qualification does not cover/u);
  const errorEvidence = fastestEvidence();
  errorEvidence.results[0].errorRate = 0.01;
  assert.throws(() => validateFastestEvidence(reseal(errorEvidence)), /correctness or availability errors/u);
  const lowSamples = fastestEvidence();
  lowSamples.results[0].coldSamples = 29;
  assert.throws(() => validateFastestEvidence(reseal(lowSamples)), /insufficient samples/u);
});

function reseal(evidence) {
  const copy = structuredClone(evidence);
  delete copy.evidenceId;
  return sealFastestEvidence(copy);
}
