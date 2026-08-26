import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { createServerProfileTransport } from "./src/http-transport.mjs";

const identity = { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deployment-7", dataManifestSha256: "d".repeat(64) };
const profile = {
  id: identity.profileId, backend: "datahike", storage: "s3", state: "enabled", reason: null,
  route: "/api/v1/datahike-s3",
  deployment: { demoSha: identity.demoSha, eaclSha: identity.eaclSha, artifact: { kind: "lambda-version", sha256: identity.artifactSha256, version: "7" }, deploymentId: identity.deploymentId, dataManifestSha256: identity.dataManifestSha256, deployedAt: "2026-08-25T12:00:00Z" }
};
const basis = { behavior: "request-snapshot", id: "basis-1", capturedAt: "2026-08-25T12:00:00Z", fixedForEnvironment: false };
const descriptor = {
  contract: { name: "explorer.v1", routeMajor: 1, revision: 1, minimumClientRevision: 1 }, identity,
  profile: { backend: "datahike", storage: "s3" },
  runtime: { execution: "lambda", name: "java25", architecture: "arm64", snapStart: "enabled" },
  capabilities: { operations: ["health", "bootstrap", "authorize"], consistencyModes: ["current"], snapshotBehavior: "request-snapshot", cacheBehavior: "environment-local", mutationLocality: "none", limitations: ["read-only"] },
  limits: [{ name: "responseBodyBytes", value: 1_048_576 }],
  dataset: { fixtureId: "fixture-v1", logicalResourceCount: 1_000_000, manifestSha256: identity.dataManifestSha256 }, basis
};

test("server transport starts health and bootstrap sequentially on the reserved-concurrency-one runtime", async () => {
  const calls = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const transport = createTransport(async (url, init) => {
    calls.push({ url, init });
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    const operation = new URL(url).pathname.split("/").at(-1);
    const result = operation === "health"
      ? response(success("health", "browser-4-1", { status: "ready", ready: true, identity, basis }))
      : response(success("bootstrap", "browser-4-2", descriptor));
    inFlight -= 1;
    return result;
  });
  assert.deepEqual(await transport.bootstrap({ epoch: 4 }), descriptor);
  assert.deepEqual(calls.map(({ url }) => url), ["https://demo.eacl.dev/api/v1/datahike-s3/health", "https://demo.eacl.dev/api/v1/datahike-s3/bootstrap"]);
  assert.equal(maximumInFlight, 1);
  assert.equal(calls.every(({ init }) => init.method === "GET" && !("body" in init) && init.credentials === "omit" && init.redirect === "error"), true);
  assert.deepEqual(calls.map(({ init }) => init.headers["x-eacl-request-id"]).sort(), ["browser-4-1", "browser-4-2"]);
  assert.equal(await transport.release(), true);
  assert.equal(await transport.release(), false);
});

test("POST bodies carry the exact payload hash and validated request scope", async () => {
  let observed;
  const transport = createTransport(async (url, init) => {
    observed = { url, init };
    return response(success("authorize", "9-2", { allowed: true }));
  });
  const envelope = await transport.request("authorize", { subjectId: "alice" }, { epoch: 9, requestId: "9-2" });
  assert.equal(envelope.ok, true);
  assert.equal(observed.init.body, '{"subjectId":"alice"}');
  assert.equal(observed.init.headers["x-eacl-request-id"], "9-2");
  assert.equal(observed.init.headers["x-amz-content-sha256"], "9707c3f229275ea24bb9c5771bc3be55636e7c96d010873b6ebe6a929665beaf");
  assert.equal(observed.init.cache, "no-store");
});

test("response operation, request, deployment, and status drift all fail closed", async () => {
  const variants = [
    success("authorize", "wrong", {}),
    { ...success("authorize", "1-1", {}), meta: { ...success("authorize", "1-1", {}).meta, identity: { ...identity, artifactSha256: "e".repeat(64) } } }
  ];
  for (const candidate of variants) {
    const transport = createTransport(async () => response(candidate));
    await assert.rejects(transport.request("authorize", {}, { requestId: "1-1" }), /identity|match/u);
  }
  const badStatus = createTransport(async () => response(success("authorize", "1-1", {}), 503));
  await assert.rejects(badStatus.request("authorize", {}, { requestId: "1-1" }), /status/u);
});

test("startup requires ready health and the same exact basis as bootstrap", async () => {
  const transport = createTransport(async (url) => {
    const operation = new URL(url).pathname.split("/").at(-1);
    return operation === "health"
      ? response(success("health", "browser-0-1", { status: "ready", ready: true, identity, basis: { ...basis, id: "other-basis" } }))
      : response(success("bootstrap", "browser-0-2", descriptor));
  });
  await assert.rejects(transport.bootstrap(), /basis identity mismatch/u);
});

test("insecure, noncanonical, released, redirected, and non-JSON transports are rejected", async () => {
  assert.throws(() => createTransport(async () => response(success("bootstrap", "browser-0-1", descriptor)), { baseUrl: "http://demo.eacl.dev/" }), /HTTPS/u);
  assert.throws(() => createTransport(async () => response(success("bootstrap", "browser-0-1", descriptor)), { profile: { ...profile, route: "/api/v1/datahike-s3/extra" } }), /canonical/u);
  const redirected = createTransport(async (url) => {
    const operation = new URL(url).pathname.split("/").at(-1);
    const value = operation === "health" ? { status: "ready", ready: true, identity, basis } : descriptor;
    return { ...response(success(operation, operation === "health" ? "browser-0-1" : "browser-0-2", value)), redirected: true };
  });
  await assert.rejects(redirected.bootstrap(), (error) => error.code === "invalid-response");
  const nonJson = createTransport(async () => new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }));
  await assert.rejects(nonJson.bootstrap(), (error) => error.code === "invalid-response");
  const released = createTransport(async () => response(success("bootstrap", "browser-0-1", descriptor)));
  await released.release();
  await assert.rejects(released.bootstrap(), (error) => error.code === "cancelled");
});

function createTransport(fetchImpl, overrides = {}) {
  return createServerProfileTransport({
    profile: overrides.profile ?? profile,
    baseUrl: overrides.baseUrl ?? "https://demo.eacl.dev/?backend=datahike",
    validateRequest: (value) => value,
    validateResponse: (value) => value,
    fetchImpl,
    cryptoImpl: webcrypto
  });
}

function success(operation, requestId, data) {
  return { ok: true, meta: { contractVersion: "explorer.v1", requestId, operation, identity, basis }, data };
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
