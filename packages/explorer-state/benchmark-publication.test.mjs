import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createBenchmarkEvidenceIndex, loadBenchmarkEvidence, verifyBenchmarkEvidenceIndex } from "./src/benchmark-publication.mjs";
import { composeProfileRegistry, createProfilePublication } from "./src/profile-publication.mjs";
import { fastestEvidence } from "./support/fastest-evidence-fixture.mjs";

const readJson = (url) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [baseRegistry, definitions, schema] = await Promise.all([readJson("../../registry/profile-registry.v1.json"), readJson("../contracts/profiles.v1.json"), readJson("../../schemas/benchmark-evidence-index.v1.schema.json")]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

test("the benchmark index is closed, content-addressed, schema-valid, and tamper-evident", async () => {
  const { records } = evidenceFiles();
  const index = await createBenchmarkEvidenceIndex({ evidenceRecords: records, publishedAt: "2026-08-25T13:00:00Z" }, { cryptoImpl: webcrypto, now: "2026-08-25T13:00:01Z" });
  assert.equal(validateSchema(index), true, JSON.stringify(validateSchema.errors));
  assert.equal(await verifyBenchmarkEvidenceIndex(index, { cryptoImpl: webcrypto, now: "2026-08-25T13:00:01Z" }), index);
  const tampered = structuredClone(index);
  tampered.evidence[0].sha256 = "0".repeat(64);
  await assert.rejects(() => verifyBenchmarkEvidenceIndex(tampered, { cryptoImpl: webcrypto, now: "2026-08-25T13:00:01Z" }), (error) => error.code === "benchmark-index-digest-mismatch");
  await assert.rejects(() => createBenchmarkEvidenceIndex({ evidenceRecords: [records[0], records[0]], publishedAt: "2026-08-25T13:00:00Z" }, { cryptoImpl: webcrypto, now: "2026-08-25T13:00:01Z" }), /duplicates/u);
});

test("the browser loader verifies index, raw file digest, evidence seal, summary, origin, and bounds", async () => {
  const { records, texts } = evidenceFiles();
  const index = await createBenchmarkEvidenceIndex({ evidenceRecords: records, publishedAt: "2026-08-25T13:00:00Z" }, { cryptoImpl: webcrypto, now: "2026-08-25T13:00:01Z" });
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith("index.v1.json")) return jsonResponse(index);
    const path = url.pathname.slice(1);
    if (texts.has(path)) return new Response(texts.get(path), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
  };
  const loaded = await loadBenchmarkEvidence({ baseUrl: "https://demo.eacl.dev", fetchImpl, cryptoImpl: webcrypto, now: "2026-08-26T00:00:00Z" });
  assert.equal(loaded.evidenceRecords.length, 1);
  assert.equal(loaded.failures.length, 0);

  const corrupt = await loadBenchmarkEvidence({ baseUrl: "https://demo.eacl.dev", fetchImpl: async (url) => url.pathname.endsWith("index.v1.json") ? jsonResponse(index) : new Response(`${texts.values().next().value} `, { status: 200, headers: { "content-type": "application/json" } }), cryptoImpl: webcrypto, now: "2026-08-26T00:00:00Z" });
  assert.equal(corrupt.evidenceRecords.length, 0);
  assert.equal(corrupt.failures[0].code, "benchmark-file-digest-mismatch");
  const insecure = await loadBenchmarkEvidence({ baseUrl: "http://demo.eacl.dev", fetchImpl, cryptoImpl: webcrypto, now: "2026-08-26T00:00:00Z" });
  assert.equal(insecure.evidenceRecords.length, 0);
  assert.equal(insecure.failures[0].code, "benchmark-origin-invalid");
});

test("only evidence matching both active deployment identities can choose the fastest default", async () => {
  const { records } = evidenceFiles();
  const evidence = records[0].evidence;
  const publications = await Promise.all(evidence.candidates.map(async (candidate) => {
    const baseline = baseRegistry.profiles.find(({ id }) => id === candidate.profileId);
    const definition = definitions.profiles.find(({ id }) => id === candidate.profileId);
    const deployment = { demoSha: candidate.demoSha, eaclSha: candidate.eaclSha, artifact: { kind: "lambda-version", sha256: candidate.artifactDigest.slice(7), version: "42" }, deploymentId: candidate.deploymentId, dataManifestSha256: candidate.dataManifestDigest.slice(7), deployedAt: "2026-08-25T12:00:00Z" };
    const profile = { ...structuredClone(baseline), state: "enabled", reason: null, deployment, lastOutcome: { outcome: "succeeded", attemptedDemoSha: deployment.demoSha, attemptedEaclSha: deployment.eaclSha, artifactSha256: deployment.artifact.sha256, at: deployment.deployedAt, message: "Qualified benchmark candidate was promoted." } };
    return createProfilePublication({ profile, definition, publishedAt: "2026-08-25T12:00:01Z", gate: { kind: "merge-smoke", evidenceId: `sha256:${"7".repeat(64)}` } }, { cryptoImpl: webcrypto, now: "2026-08-25T13:00:00Z" });
  }));
  const matching = await composeProfileRegistry({ baseRegistry, profileDefinitions: definitions, publications, evidenceRecords: records, now: "2026-08-26T00:00:00Z", cryptoImpl: webcrypto });
  assert.equal(matching.registry.storageDefaults[0].outcome, "winner");
  assert.equal(matching.registry.storageDefaults[0].profileId, "datahike-dynamodb");
  assert.equal(matching.registry.storageDefaults[0].evidenceId, evidence.evidenceId);

  const redeployed = structuredClone(publications);
  const changed = redeployed.find(({ profile }) => profile.id === "datahike-dynamodb");
  changed.profile.deployment.deploymentId = "replacement-deployment";
  changed.profile.lastOutcome.attemptedDemoSha = changed.profile.deployment.demoSha;
  changed.profile.lastOutcome.attemptedEaclSha = changed.profile.deployment.eaclSha;
  changed.profile.lastOutcome.artifactSha256 = changed.profile.deployment.artifact.sha256;
  changed.publicationId = await resealPublication(changed);
  const stale = await composeProfileRegistry({ baseRegistry, profileDefinitions: definitions, publications: redeployed, evidenceRecords: records, now: "2026-08-26T00:00:00Z", cryptoImpl: webcrypto });
  assert.equal(stale.registry.storageDefaults[0].outcome, "fallback");
  assert.equal(stale.registry.storageDefaults[0].evidenceId, null);
});

function evidenceFiles() {
  const evidence = fastestEvidence();
  const path = "registry/benchmark-evidence/datahike-storage-example.json";
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  return { records: [{ evidence, path, sha256: createHash("sha256").update(text).digest("hex") }], texts: new Map([[path, text]]) };
}

function jsonResponse(value) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }

async function resealPublication(publication) {
  const { publicationId: _publicationId, ...unsigned } = publication;
  const text = canonicalJson(unsigned);
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
