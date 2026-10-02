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

const stale = () => ready({ artifactSha256: "d".repeat(64) });

test("the caller is asked after every attempt that misses and once more when the time is up", async () => {
  const timer = clock();
  const asked = [];
  await assert.rejects(smokeFunctionUrl(identity.profileId, origin, identity, {
    ...timer,
    timeoutMs: 5_000,
    fetchResponse: async () => stale(),
    whileWaiting: async (state) => { asked.push({ ...state, at: timer.now() }); }
  }), /public origin smoke failed after deployment propagation: \{"status":200,/u);
  assert.deepEqual(asked, [
    { final: false, at: 0 }, { final: false, at: 2_000 }, { final: false, at: 4_000 }, { final: true, at: 5_000 }
  ]);
});

test("a caller that throws ends the wait there with its own error", async () => {
  for (const [throwsAt, final] of [[2_000, false], [5_000, true]]) {
    const timer = clock();
    let calls = 0;
    await assert.rejects(smokeFunctionUrl(identity.profileId, origin, identity, {
      ...timer,
      timeoutMs: 5_000,
      fetchResponse: async () => { calls += 1; return stale(); },
      whileWaiting: async (state) => {
        if (timer.now() >= throwsAt && state.final === final) throw new Error("the host command failed");
      }
    }), /^Error: the host command failed$/u);
    assert.equal(timer.now(), throwsAt);
    assert.equal(calls, final ? 3 : 2);
  }
});

test("the caller is not asked once the expected identity has appeared", async () => {
  const timer = clock();
  let asked = 0;
  await smokeFunctionUrl(identity.profileId, origin, identity, {
    ...timer,
    timeoutMs: 900_000,
    fetchResponse: async () => (timer.now() < 4_000 ? stale() : ready()),
    whileWaiting: async () => {
      asked += 1;
      if (timer.now() >= 4_000) throw new Error("asked after the identity appeared");
    }
  });
  assert.equal(timer.now(), 4_000);
  assert.equal(asked, 2);
});
