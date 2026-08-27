import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  composeProfileRegistry,
  createFailClosedRegistry,
  createProfilePublication,
  loadProfilePublication,
  loadProfilePublications,
  verifyProfilePublication
} from "./src/profile-publication.mjs";

const readJson = (url) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [baseRegistry, definitions, publicationSchema] = await Promise.all([
  readJson("../../registry/profile-registry.v1.json"),
  readJson("../contracts/profiles.v1.json"),
  readJson("../../schemas/profile-publication.v1.schema.json")
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(publicationSchema);

test("a publication is schema-valid, content-addressed, and tamper-evident", async () => {
  const profile = successfulProfile("datahike-s3", "a", "b", "c", "2026-08-25T12:00:00Z");
  const publication = await publish(profile, "2026-08-25T12:00:01Z");
  assert.equal(validateSchema(publication), true, JSON.stringify(validateSchema.errors));
  assert.match(publication.publicationId, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(await verifyProfilePublication(publication, definition(profile.id), baseline(profile.id), { cryptoImpl: webcrypto }), publication);
  const tampered = structuredClone(publication);
  tampered.profile.lastOutcome.message = "A different result was substituted.";
  await assert.rejects(() => verifyProfilePublication(tampered, definition(profile.id), baseline(profile.id), { cryptoImpl: webcrypto }), (error) => error.code === "publication-digest-mismatch");
});

test("implausibly future publication timestamps and insecure non-loopback origins fail closed", async () => {
  const profile = successfulProfile("datahike-s3", "a", "b", "c", "2026-08-25T12:00:00Z");
  await assert.rejects(() => createProfilePublication({ profile, definition: definition(profile.id), publishedAt: "2026-08-25T12:10:01Z", gate: { kind: "merge-smoke", evidenceId: `sha256:${"9".repeat(64)}` } }, { cryptoImpl: webcrypto, now: "2026-08-25T12:00:00Z" }), (error) => error.code === "publication-time-invalid");
  await assert.rejects(() => loadProfilePublications({ baseUrl: "http://demo.eacl.dev/", profileDefinitions: definitions, baseRegistry, cryptoImpl: webcrypto, fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json" } }) }), (error) => error.code === "publication-origin-invalid");
});

test("mixed and out-of-order source generations compose independently", async () => {
  const older = await publish(successfulProfile("datahike-s3", "1", "2", "3", "2026-08-25T12:00:00Z"), "2026-08-25T12:00:05Z");
  const newer = await publish(successfulProfile("datahike-dynamodb", "a", "b", "c", "2026-08-25T11:00:00Z"), "2026-08-25T11:00:05Z");
  const { registry, failures } = await composeProfileRegistry({ baseRegistry, profileDefinitions: definitions, publications: [newer, older], cryptoImpl: webcrypto });
  assert.equal(registry.profiles.find(({ id }) => id === "datahike-s3").deployment.demoSha, "1".repeat(40));
  assert.equal(registry.profiles.find(({ id }) => id === "datahike-dynamodb").deployment.demoSha, "a".repeat(40));
  assert.equal(registry.profiles.filter(({ state }) => state === "enabled").length, 2);
  assert.equal(failures.filter(({ code }) => code === "publication-missing").length, 4);
  assert.equal("latestDemoSha" in registry, false);
});

test("missing, duplicate, wrong-profile, and wrong-route records fail only their profile closed", async () => {
  const first = await publish(successfulProfile("datahike-s3", "a", "b", "c", "2026-08-25T12:00:00Z"), "2026-08-25T12:00:01Z");
  const sibling = await publish(successfulProfile("datomic-dynamodb", "d", "e", "f", "2026-08-25T12:00:00Z"), "2026-08-25T12:00:01Z");
  const wrongRoute = structuredClone(sibling);
  wrongRoute.profile.id = "datahike-dynamodb";
  wrongRoute.profile.backend = "datahike";
  const { registry, failures } = await composeProfileRegistry({ baseRegistry, profileDefinitions: definitions, publications: [first, first, wrongRoute, sibling], cryptoImpl: webcrypto });
  assert.equal(registry.profiles.find(({ id }) => id === "datahike-s3").state, "unavailable");
  assert.equal(registry.profiles.find(({ id }) => id === "datahike-dynamodb").state, "unavailable");
  assert.equal(registry.profiles.find(({ id }) => id === "datomic-dynamodb").state, "enabled");
  assert.equal(failures.some(({ profileId, code }) => profileId === "datahike-s3" && code === "publication-duplicate"), true);
  assert.equal(failures.some(({ profileId }) => profileId === "datahike-dynamodb"), true);
});

test("an embedded enabled profile cannot remain selectable without a current publication", () => {
  const embedded = structuredClone(baseRegistry);
  embedded.profiles[0] = successfulProfile("datahike-s3", "a", "b", "c", "2026-08-25T12:00:00Z");
  embedded.storageDefaults[0] = { outcome: "sole-qualified", profileId: "datahike-s3", storage: "s3", claim: null, evidenceId: null, measuredAt: null, reason: "Only one qualified storage choice is enabled.", backend: "datahike" };
  const closed = createFailClosedRegistry(embedded, definitions);
  assert.equal(closed.profiles[0].state, "unavailable");
  assert.match(closed.profiles[0].reason, /could not be verified/u);
  assert.equal(closed.storageDefaults[0].profileId, null);
});

test("the loader fetches every allowlisted record concurrently and isolates failures", async () => {
  const available = new Map();
  for (const [id, digit] of [["datahike-s3", "a"], ["datomic-dynamodb", "b"]]) {
    available.set(id, await publish(successfulProfile(id, digit, "c", "d", "2026-08-25T12:00:00Z"), "2026-08-25T12:00:01Z"));
  }
  const calls = [];
  const result = await loadProfilePublications({
    baseUrl: "https://demo.eacl.dev/",
    profileDefinitions: definitions,
    baseRegistry,
    cryptoImpl: webcrypto,
    fetchImpl: async (url, options) => {
      calls.push({ url: url.href, options });
      const id = url.pathname.split("/").at(-1).replace(/\.json$/u, "");
      if (!available.has(id)) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      return new Response(JSON.stringify(available.get(id)), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(calls.length, definitions.profiles.length);
  assert.equal(result.publications.length, 2);
  assert.equal(result.failures.length, 4);
  assert.equal(calls.every(({ url, options }) => /^https:\/\/demo\.eacl\.dev\/registry\/profiles\/[a-z0-9-]+\.json$/u.test(url) && options.credentials === "omit" && options.cache === "no-store" && options.redirect === "error"), true);
});

test("the targeted loader verifies only the exact closed profile record", async () => {
  const publication = await publish(successfulProfile("datascript-browser-memory", "a", "b", "c", "2026-08-25T12:00:00Z"), "2026-08-25T12:00:01Z");
  const calls = [];
  const loaded = await loadProfilePublication({
    baseUrl: "https://demo.eacl.dev/datascript/",
    profileId: "datascript-browser-memory",
    profileDefinitions: definitions,
    baseRegistry,
    cryptoImpl: webcrypto,
    fetchImpl: async (url, options) => {
      calls.push({ url: url.href, options });
      return new Response(JSON.stringify(publication), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(loaded.profile.id, "datascript-browser-memory");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://demo.eacl.dev/registry/profiles/datascript-browser-memory.json");
  assert.equal(calls[0].options.redirect, "error");
  await assert.rejects(() => loadProfilePublication({ baseUrl: "https://demo.eacl.dev/", profileId: "unknown", profileDefinitions: definitions, baseRegistry, cryptoImpl: webcrypto, fetchImpl: async () => { throw new Error("must not fetch"); } }), (error) => error.code === "publication-identity-mismatch");
});

test("oversized and redirected responses are rejected without suppressing siblings", async () => {
  const publication = await publish(successfulProfile("datahike-s3", "a", "b", "c", "2026-08-25T12:00:00Z"), "2026-08-25T12:00:01Z");
  const result = await loadProfilePublications({
    baseUrl: "https://demo.eacl.dev/",
    profileDefinitions: definitions,
    baseRegistry,
    cryptoImpl: webcrypto,
    fetchImpl: async (url) => {
      if (url.pathname.endsWith("datahike-s3.json")) return new Response(JSON.stringify(publication), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("datahike-dynamodb.json")) return { ok: true, status: 200, redirected: true, url: "https://attacker.invalid/status.json", headers: new Headers({ "content-type": "application/json" }), body: null, text: async () => "{}" };
      return { ok: true, status: 200, redirected: false, url: url.href, headers: new Headers({ "content-type": "application/json", "content-length": "65537" }), body: new ReadableStream(), text: async () => "{}" };
    }
  });
  assert.equal(result.publications.length, 1);
  assert.equal(result.failures.length, 5);
  assert.equal(result.failures.some(({ code }) => code === "publication-redirected"), true);
  assert.equal(result.failures.some(({ code }) => code === "response-too-large"), true);
});

function definition(id) {
  return definitions.profiles.find((profile) => profile.id === id);
}

function baseline(id) {
  return baseRegistry.profiles.find((profile) => profile.id === id);
}

function successfulProfile(id, demoDigit, eaclDigit, artifactDigit, deployedAt) {
  const source = structuredClone(baseline(id));
  const deployment = {
    demoSha: demoDigit.repeat(40),
    eaclSha: eaclDigit.repeat(40),
    artifact: { kind: id === "datascript-browser-memory" ? "static" : "lambda-version", sha256: artifactDigit.repeat(64), version: "42" },
    deploymentId: `${id}:deploy-42`,
    dataManifestSha256: "d".repeat(64),
    deployedAt
  };
  return {
    ...source,
    state: "enabled",
    reason: null,
    deployment,
    lastOutcome: { outcome: "succeeded", attemptedDemoSha: deployment.demoSha, attemptedEaclSha: deployment.eaclSha, artifactSha256: deployment.artifact.sha256, at: deployedAt, message: "The independently qualified profile was promoted." }
  };
}

function publish(profile, publishedAt) {
  return createProfilePublication({ profile, definition: definition(profile.id), publishedAt, gate: { kind: "merge-smoke", evidenceId: `sha256:${"9".repeat(64)}` } }, { cryptoImpl: webcrypto });
}
