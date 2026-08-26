import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runQualification } from "./src/runner.mjs";
import { assertTrustedCloudFrontOrigin, createHttpQualificationTransport, qualificationTarget, reportableTarget, SERVER_PROFILE_IDS } from "./src/targets.mjs";

const identity = { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deploy-1", dataManifestSha256: "d".repeat(64) };
const descriptor = { identity, contract: { revision: 1 }, capabilities: { operations: ["authorize"] } };

test("HTTP qualification's closed server profiles stay synchronized with the canonical registry", async () => {
  const registry = JSON.parse(await readFile(new URL("../contracts/profiles.v1.json", import.meta.url), "utf8"));
  assert.deepEqual(SERVER_PROFILE_IDS, registry.profiles.filter(({ storage }) => storage !== "browser-memory").map(({ id }) => id));
});

test("targets distinguish loopback, authorized origin, staged, and production CloudFront without retaining credentials", async () => {
  const local = qualificationTarget({ kind: "local", baseUrl: "http://127.0.0.1:8080/api/v1/datahike-s3", profileId: "datahike-s3" });
  const origin = qualificationTarget({ kind: "staged-origin", baseUrl: "https://abc.lambda-url.af-south-1.on.aws/api/v1/datahike-s3", profileId: "datahike-s3", authorize: async () => ({ authorization: "sensitive" }) });
  const cloudfront = qualificationTarget({ kind: "staged-cloudfront", baseUrl: "https://staging.demo.eacl.dev/api/v1/datahike-s3", profileId: "datahike-s3" });
  const production = qualificationTarget({ kind: "production-cloudfront", baseUrl: "https://demo.eacl.dev/api/v1/datahike-s3", profileId: "datahike-s3" });
  assert.deepEqual([local.kind, origin.kind, cloudfront.kind, production.kind], ["local", "staged-origin", "staged-cloudfront", "production-cloudfront"]);
  assert.deepEqual(reportableTarget(origin), { kind: "staged-origin", origin: "https://abc.lambda-url.af-south-1.on.aws", path: "/api/v1/datahike-s3", profileId: "datahike-s3" });
  assert.equal(JSON.stringify(reportableTarget(origin)).includes("sensitive"), false);
  assert.throws(() => qualificationTarget({ kind: "local", baseUrl: "https://example.com", profileId: "datahike-s3" }), /loopback/u);
  assert.throws(() => qualificationTarget({ kind: "staged-origin", baseUrl: "http://example.com", profileId: "datahike-s3", authorize: async () => ({}) }), /HTTPS/u);
  assert.throws(() => qualificationTarget({ kind: "staged-cloudfront", baseUrl: "https://staging.demo.eacl.dev/api/v1/datomic-dynamodb", profileId: "datahike-s3" }), /exact profile route/u);
  assert.throws(() => qualificationTarget({ kind: "staged-cloudfront", baseUrl: "https://staging.demo.eacl.dev/api/v1/unregistered", profileId: "unregistered" }), /registered server profile/u);
  assert.equal(assertTrustedCloudFrontOrigin(cloudfront, "https://staging.demo.eacl.dev"), true);
  assert.throws(() => assertTrustedCloudFrontOrigin(cloudfront, "https://demo.eacl.dev"), /trusted CloudFront/u);
  assert.throws(() => assertTrustedCloudFrontOrigin(cloudfront, "https://staging.demo.eacl.dev/path"), /invalid/u);
});

test("HTTP transport applies staged authorization but never exposes it", async () => {
  const calls = [];
  const target = qualificationTarget({ kind: "staged-origin", baseUrl: "https://origin.example/api/v1/datahike-s3", profileId: "datahike-s3", authorize: async () => ({ authorization: "Bearer sensitive" }) });
  const transport = createHttpQualificationTransport(target, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return { status: 200, async text() { return JSON.stringify({ meta: { revision: "basis-1", requestId: init.headers["x-eacl-request-id"] }, data: {} }); } };
  } });
  await transport.request("authorize", { subjectId: "user-1" });
  assert.equal(calls[0].init.headers.authorization, "Bearer sensitive");
  assert.equal(calls[0].init.headers["x-eacl-request-id"], "qualification-1");
  assert.equal(calls[0].init.headers["x-amz-content-sha256"], createHash("sha256").update(calls[0].init.body).digest("hex"));
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(JSON.stringify(reportableTarget(target)).includes("Bearer"), false);
  assert.equal(await transport.release(), true);
  assert.equal(await transport.release(), false);

  const mismatched = createHttpQualificationTransport(target, { fetchImpl: async () => ({
    status: 200,
    async text() { return JSON.stringify({ meta: { revision: "basis-1", requestId: "wrong" }, data: {} }); }
  }) });
  await assert.rejects(() => mismatched.request("authorize", {}), /correlation mismatch/u);
  await mismatched.release();
  const overriding = qualificationTarget({ kind: "staged-origin", baseUrl: "https://origin.example/api/v1/datahike-s3", profileId: "datahike-s3", authorize: async () => ({ "x-eacl-request-id": "attacker" }) });
  const guarded = createHttpQualificationTransport(overriding, { fetchImpl: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(() => guarded.request("health", {}), /changed fixed header/u);
  await guarded.release();
});

test("HTTP transport fault probes are closed, bounded, hashed, correlated, and cancellable", async () => {
  const calls = [];
  const target = qualificationTarget({ kind: "staged-cloudfront", baseUrl: "https://staging.example/api/v1/datahike-s3", profileId: "datahike-s3" });
  const transport = createHttpQualificationTransport(target, { requestIdPrefix: "manual-7-1", fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/health")) {
      assert.equal(init.signal.aborted, false);
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    }
    let status; let code;
    if (url.endsWith("/seed")) [status, code] = [404, "route-not-found"];
    else if (init.method === "GET") [status, code] = [405, "method-not-allowed"];
    else if (init.headers["content-type"] === "text/plain") [status, code] = [415, "unsupported-media-type"];
    else if (init.body.length > 65536) [status, code] = [413, "request-too-large"];
    else [status, code] = [400, "validation-error"];
    return { status, async text() { return JSON.stringify({ meta: { revision: "basis-1", requestId: init.headers["x-eacl-request-id"] }, error: { code, message: "Rejected." } }); } };
  } });
  for (const kind of ["invalid-json", "oversized-body", "unsupported-media-type", "wrong-method", "mutation-route", "client-cancel"]) {
    const result = await transport.probeFault(kind);
    assert.equal(result.kind, kind);
  }
  for (const { init } of calls.filter(({ init }) => typeof init.body === "string")) {
    assert.equal(init.headers["x-amz-content-sha256"], createHash("sha256").update(init.body).digest("hex"));
  }
  assert.ok(calls.find(({ init }) => init.body?.length > 65536));
  assert.equal(calls.at(-1).init.signal.aborted, true);
  await transport.release();
  await assert.rejects(() => transport.probeFault("invalid-json"), /released/u);
  assert.throws(() => createHttpQualificationTransport(target, { requestIdPrefix: "bad prefix", fetchImpl: async () => {} }), /prefix/u);
  assert.throws(() => createHttpQualificationTransport(target, { requestTimeoutMs: 31_000, fetchImpl: async () => {} }), /timeout/u);
});

test("runner binds exact identity, distinguishes unsupported from failed, and releases", async () => {
  let releases = 0;
  const report = await runQualification({
    target: qualificationTarget({ kind: "local", baseUrl: "http://localhost:8080/api/v1/datahike-s3", profileId: "datahike-s3" }),
    expectedIdentity: identity,
    now: sequenceClock(),
    createTransport: async () => ({
      async request(operation) { return { meta: { revision: "basis-1", requestId: `request-${operation}` }, data: descriptor }; },
      async release() { releases += 1; return true; }
    }),
    cases: [
      { id: "supported", category: "contract", applies: () => ({ supported: true }), run: async () => ({ checked: true }) },
      { id: "omitted", category: "cache", applies: () => ({ supported: false, reason: "No cache capability." }), run: async () => { throw new Error("must not run"); } },
      { id: "broken", category: "redaction", run: async () => { throw Object.assign(new Error("failed at https://secret.example/token authorization=abc /Users/person/file"), { code: "internal-error" }); } }
    ]
  });
  assert.equal(report.result, "fail");
  assert.deepEqual(report.counts, { passed: 2, failed: 1, unsupported: 1 });
  assert.equal(report.cases.find(({ id }) => id === "broken").reason.includes("secret.example"), false);
  assert.equal(report.releaseOutcome, "released");
  assert.equal(releases, 1);
});

test("identity mismatch fails before ordinary qualification cases", async () => {
  let ran = false;
  const report = await runQualification({
    target: qualificationTarget({ kind: "local", baseUrl: "http://localhost:8080/api/v1/datahike-s3", profileId: "datahike-s3" }),
    expectedIdentity: identity,
    createTransport: async () => ({ request: async (operation) => ({ meta: { revision: "basis-1", requestId: `request-${operation}` }, data: { ...descriptor, identity: { ...identity, eaclSha: "e".repeat(40) } } }), release: async () => true }),
    cases: [{ id: "never", category: "authorization", run: async () => { ran = true; } }]
  });
  assert.equal(report.result, "fail");
  assert.equal(report.cases[0].id, "bootstrap-identity");
  assert.equal(ran, false);
});

function sequenceClock() {
  const values = ["2026-08-25T12:00:00Z", "2026-08-25T12:00:01Z"];
  return () => values.shift() ?? values.at(-1);
}
