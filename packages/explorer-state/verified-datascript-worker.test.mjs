import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createProfilePublication } from "./src/profile-publication.mjs";
import { loadVerifiedDataScriptWorker } from "./src/verified-datascript-worker.mjs";

const readJson = (url) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [baseRegistry, profileDefinitions] = await Promise.all([
  readJson("../../registry/profile-registry.v1.json"),
  readJson("../contracts/profiles.v1.json")
]);
const profileId = "datascript-browser-memory";
const demoSha = "a".repeat(40);
const eaclSha = "8dc3b16498788dd822b68e1c4fe25b37a8e8879f";
const dataManifestSha256 = "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a";
const now = "2026-08-25T12:00:02Z";

test("only content-addressed same-origin worker bytes are executed and the Blob URL is revoked", async () => {
  const workerBytes = new TextEncoder().encode("self.onmessage = () => {};\n");
  const artifactSha256 = sha256(workerBytes);
  const publication = await enabledPublication(artifactSha256);
  const calls = [];
  const objects = [];
  const revoked = [];
  const fakeWorker = { postMessage() {}, terminate() {} };
  const result = await loadVerifiedDataScriptWorker({
    baseUrl: "https://demo.eacl.dev/datascript/",
    profileDefinitions,
    baseRegistry,
    cryptoImpl: webcrypto,
    now,
    fetchImpl: async (url, options) => {
      calls.push({ url: url.href, options });
      if (url.pathname.endsWith("datascript-browser-memory.json")) return jsonResponse(publication);
      return new Response(workerBytes, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "content-length": String(workerBytes.byteLength) } });
    },
    createBlob(parts, options) { return { parts, options }; },
    createObjectUrl(blob) { objects.push(blob); return "blob:verified-worker"; },
    revokeObjectUrl(url) { revoked.push(url); },
    createWorker(url, options) {
      assert.equal(url, "blob:verified-worker");
      assert.deepEqual(options, { name: "eacl-datascript", type: "classic" });
      return fakeWorker;
    }
  });
  assert.equal(result.worker, fakeWorker);
  assert.equal(result.identity.artifactSha256, artifactSha256);
  assert.equal(result.identity.eaclSha, eaclSha);
  assert.equal(result.artifactBytes, workerBytes.byteLength);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, `https://demo.eacl.dev/datascript/assets/datascript-worker-${artifactSha256}.js`);
  assert.equal(calls[1].options.cache, "no-store");
  assert.equal(calls[1].options.credentials, "omit");
  assert.equal(calls[1].options.redirect, "error");
  assert.equal(objects[0].parts[0] instanceof Uint8Array, true);
  assert.deepEqual(revoked, ["blob:verified-worker"]);
});

test("tampered, oversized, and non-JavaScript worker responses fail before execution", async () => {
  const expectedBytes = new TextEncoder().encode("expected");
  const publication = await enabledPublication(sha256(expectedBytes));
  let executions = 0;
  const base = {
    baseUrl: "https://demo.eacl.dev/datascript/",
    profileDefinitions,
    baseRegistry,
    cryptoImpl: webcrypto,
    now,
    createWorker() { executions += 1; return { postMessage() {}, terminate() {} }; }
  };
  const publicationResponse = (url) => url.pathname.endsWith(".json") ? jsonResponse(publication) : null;
  await assert.rejects(() => loadVerifiedDataScriptWorker({ ...base, fetchImpl: async (url) => publicationResponse(url) ?? new Response("tampered", { status: 200, headers: { "content-type": "application/javascript" } }) }), (error) => error.code === "artifact-digest-mismatch");
  await assert.rejects(() => loadVerifiedDataScriptWorker({ ...base, maximumBytes: 8, fetchImpl: async (url) => publicationResponse(url) ?? new Response("123456789", { status: 200, headers: { "content-type": "application/javascript", "content-length": "9" } }) }), (error) => error.code === "response-too-large");
  await assert.rejects(() => loadVerifiedDataScriptWorker({ ...base, fetchImpl: async (url) => publicationResponse(url) ?? new Response(expectedBytes, { status: 200, headers: { "content-type": "text/html" } }) }), (error) => error.code === "worker-content-type-invalid");
  assert.equal(executions, 0);
});

test("a valid but non-enabled DataScript publication cannot load worker bytes", async () => {
  const baseline = structuredClone(baseRegistry.profiles.find(({ id }) => id === profileId));
  const definition = profileDefinitions.profiles.find(({ id }) => id === profileId);
  const publication = await createProfilePublication({ profile: baseline, definition, publishedAt: now, gate: { kind: "failure-outcome", evidenceId: null } }, { cryptoImpl: webcrypto, now });
  let calls = 0;
  await assert.rejects(() => loadVerifiedDataScriptWorker({
    baseUrl: "https://demo.eacl.dev/datascript/", profileDefinitions, baseRegistry, cryptoImpl: webcrypto, now,
    fetchImpl: async () => { calls += 1; return jsonResponse(publication); }
  }), (error) => error.code === "profile-unavailable");
  assert.equal(calls, 1);
});

async function enabledPublication(artifactSha256) {
  const baseline = baseRegistry.profiles.find(({ id }) => id === profileId);
  const definition = profileDefinitions.profiles.find(({ id }) => id === profileId);
  const deployment = {
    demoSha,
    eaclSha,
    artifact: { kind: "browser-worker", sha256: artifactSha256, version: "worker-test-1" },
    deploymentId: "datascript:test-deployment-1",
    dataManifestSha256,
    deployedAt: "2026-08-25T12:00:00Z"
  };
  const profile = {
    ...structuredClone(baseline),
    state: "enabled",
    reason: null,
    deployment,
    lastOutcome: { outcome: "succeeded", attemptedDemoSha: demoSha, attemptedEaclSha: eaclSha, artifactSha256, at: deployment.deployedAt, message: "The browser worker passed its test qualification." }
  };
  return createProfilePublication({ profile, definition, publishedAt: "2026-08-25T12:00:01Z", gate: { kind: "initial-qualification", evidenceId: `sha256:${"f".repeat(64)}` } }, { cryptoImpl: webcrypto, now });
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
