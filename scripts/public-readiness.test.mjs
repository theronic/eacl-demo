import assert from "node:assert/strict";
import test from "node:test";
import { smokeFunctionUrl } from "./lib/public-readiness.mjs";

const identity = {
  profileId: "datalevin-memory",
  demoSha: "a".repeat(40),
  eaclSha: "b".repeat(40),
  artifactSha256: "c".repeat(64),
  deploymentId: "production:readiness-test"
};
const origin = "https://datalevin.demo.eacl.dev";

function ready(overrides = {}, headers = {}) {
  return new Response(JSON.stringify({
    data: { ready: true, identity: { ...identity, ...overrides } },
    meta: { revision: "datalevin:17", requestId: "readiness-test" }
  }), { headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "https://demo.eacl.dev",
    ...headers
  } });
}

function clock() {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: async (ms) => { elapsed += ms; }
  };
}

test("fast cached errors do not exhaust the EC2 startup time budget", async () => {
  const timer = clock();
  let calls = 0;
  await smokeFunctionUrl(identity.profileId, origin, identity, {
    ...timer,
    timeoutMs: 900_000,
    fetchResponse: async () => {
      calls += 1;
      return timer.now() < 240_000
        ? new Response("<!DOCTYPE html><h1>Gateway timeout</h1>", {
          status: 504, headers: { "content-type": "text/html" }
        })
        : ready();
    }
  });
  assert.equal(timer.now(), 240_000);
  assert.ok(calls > 60);
});

test("unready hosts stop at the elapsed deadline and report the HTTP error", async () => {
  const timer = clock();
  await assert.rejects(smokeFunctionUrl(identity.profileId, origin, identity, {
    ...timer,
    timeoutMs: 5_000,
    fetchResponse: async () => new Response("Gateway timeout", {
      status: 504, headers: { "content-type": "text/html" }
    })
  }), /"status":504,"contentType":"text\/html"/u);
  assert.equal(timer.now(), 5_000);
});

test("a longer startup budget still rejects stale identity and invalid browser CORS", async () => {
  for (const response of [
    () => ready({ eaclSha: "d".repeat(40) }),
    () => ready({ artifactSha256: "d".repeat(64) }),
    () => ready({}, { "access-control-allow-origin": "https://unrelated.example" })
  ]) {
    await assert.rejects(smokeFunctionUrl(identity.profileId, origin, identity, {
      ...clock(), timeoutMs: 5_000, fetchResponse: async () => response()
    }), /public origin smoke failed/u);
  }
});
