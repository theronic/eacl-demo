import assert from "node:assert/strict";
import test from "node:test";

import { createServerProfileTransport } from "./src/http-transport.mjs";

const identity = { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deployment-7", dataManifestSha256: "d".repeat(64) };
const profile = {
  id: identity.profileId, backend: "datahike", storage: "s3", state: "enabled", reason: null,
  route: "/api/v1/datahike-s3",
  apiOrigin: "https://direct.lambda-url.us-east-1.on.aws",
  deployment: { demoSha: identity.demoSha, eaclSha: identity.eaclSha, artifact: { kind: "lambda-version", sha256: identity.artifactSha256, version: "7" }, deploymentId: identity.deploymentId, dataManifestSha256: identity.dataManifestSha256, deployedAt: "2026-08-25T12:00:00Z" }
};
const basis = { behavior: "request-snapshot", id: "basis-1", capturedAt: "2026-08-25T12:00:00Z", fixedForEnvironment: false };
const descriptor = {
  contract: { name: "explorer.v1", routeMajor: 1, revision: 1, minimumClientRevision: 1 }, identity,
  profile: { backend: "datahike", storage: "s3" },
  runtime: { execution: "lambda", name: "java25", architecture: "arm64", snapStart: "enabled" },
  capabilities: { operations: ["health", "bootstrap", "authorize"], consistencyModes: ["current"], snapshotBehavior: "request-snapshot", cacheBehavior: "environment-local", mutationLocality: "none", limitations: ["read-only"] },
  limits: [{ name: "responseBodyBytes", value: 1_048_576 }],
  dataset: { fixtureId: "fixture-v1", logicalResourceCount: 1_000_000, serverCount: 1_000_000, manifestSha256: identity.dataManifestSha256 }, basis
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
  assert.deepEqual(calls.map(({ url }) => url), ["https://direct.lambda-url.us-east-1.on.aws/api/v1/datahike-s3/health", "https://direct.lambda-url.us-east-1.on.aws/api/v1/datahike-s3/bootstrap"]);
  assert.equal(maximumInFlight, 1);
  assert.equal(calls.every(({ init }) => init.method === "GET" && !("body" in init) && init.credentials === "omit" && init.redirect === "error"), true);
  assert.deepEqual(calls.map(({ init }) => init.headers["x-eacl-request-id"]).sort(), ["browser-4-1", "browser-4-2"]);
  assert.equal(await transport.release(), true);
  assert.equal(await transport.release(), false);
});

test("server transport serializes concurrent operations to preserve the runtime concurrency cap", async () => {
  let inFlight = 0;
  let maximumInFlight = 0;
  const transport = createTransport(async (url, init) => {
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    const operation = new URL(url).pathname.split("/").at(-1);
    const requestId = init.headers["x-eacl-request-id"];
    inFlight -= 1;
    return response(success(operation, requestId, { allowed: true }));
  });
  const requests = ["parallel-1", "parallel-2", "parallel-3"].map((requestId) => transport.request("authorize", {}, { requestId }));
  const envelopes = await Promise.all(requests);
  assert.equal(envelopes.every(({ data }) => data.allowed === true), true);
  assert.equal(maximumInFlight, 1);
});

test("POST bodies go directly to Lambda without CloudFront signing headers", async () => {
  let observed;
  const transport = createTransport(async (url, init) => {
    observed = { url, init };
    return response(success("authorize", "9-2", { allowed: true }));
  });
  const envelope = await transport.request("authorize", { subjectId: "alice" }, { epoch: 9, requestId: "9-2" });
  assert.equal(envelope.data.allowed, true);
  assert.equal(observed.init.body, '{"subjectId":"alice"}');
  assert.equal(observed.init.headers["x-eacl-request-id"], "9-2");
  assert.equal(observed.url, "https://direct.lambda-url.us-east-1.on.aws/api/v1/datahike-s3/authorize");
  assert.equal(observed.init.headers["x-amz-content-sha256"], undefined);
  assert.equal(observed.init.cache, "no-store");
});

test("every backend accepts the same original compact decision metadata", async () => {
  const datomicProfile = {
    ...profile,
    id: "datomic-dynamodb",
    backend: "datomic",
    storage: "dynamodb",
    route: "/api/v1/datomic-dynamodb",
    apiOrigin: "https://datomic.lambda-url.us-east-1.on.aws",
    deployment: { ...profile.deployment },
  };
  const transport = createTransport(async () => response({
    meta: { revision: "datomic:fixture:42", requestId: "compact-1", elapsedMs: 0.8, cacheStatus: "hit" },
    data: { allowed: true },
  }), { profile: datomicProfile });
  const envelope = await transport.request("authorize", {}, { requestId: "compact-1" });
  assert.deepEqual(envelope.data, { allowed: true });
  assert.equal(envelope.meta.identity, undefined);
  assert.equal(envelope.meta.basis, undefined);
  const datahike = createTransport(async () => response({
    meta: { revision: "basis-1", requestId: "compact-2" },
    data: { allowed: true },
  }));
  assert.deepEqual((await datahike.request("authorize", {}, { requestId: "compact-2" })).data, { allowed: true });
});

test("request correlation and HTTP status drift still fail closed", async () => {
  const wrongRequest = createTransport(async () => response(success("authorize", "wrong", {})));
  await assert.rejects(wrongRequest.request("authorize", {}, { requestId: "1-1" }), /identity|match/u);
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
  assert.throws(() => createTransport(async () => response(success("bootstrap", "browser-0-1", descriptor)), { profile: { ...profile, apiOrigin: "https://demo.eacl.dev" } }), /Function URL/u);
  assert.throws(() => createTransport(async () => response(success("bootstrap", "browser-0-1", descriptor)), { profile: { ...profile, apiOrigin: null } }), /requires a direct/u);
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
    validateRequest: (value) => value,
    validateResponse: (value) => value,
    fetchImpl
  });
}

function success(operation, requestId, data) {
  return { data, meta: { revision: basis.id, requestId } };
}

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
