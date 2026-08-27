import assert from "node:assert/strict";
import test from "node:test";

import {
  observabilitySyntheticNames,
  runObservabilitySynthetics
} from "./src/observability-synthetics.mjs";

const identity = {
  profileId: "datahike-s3",
  demoSha: "a".repeat(40),
  eaclSha: "b".repeat(40),
  artifactSha256: "c".repeat(64),
  deploymentId: "deploy-1",
  dataManifestSha256: "d".repeat(64)
};
const target = {
  kind: "staged-cloudfront",
  origin: "https://staging.demo.eacl.dev",
  path: "/",
  profileId: "datahike-s3"
};
test("canonical staged synthetics are exactly health, bootstrap, and one exemplar", async () => {
  const operations = [];
  const transport = { async request(operation) {
    operations.push(operation);
    const meta = { revision: "basis-1", requestId: `request-${operation}` };
    if (operation === "health") {
      return { meta, data: { ready: true, status: "ready", identity } };
    }
    if (operation === "bootstrap") return { meta, data: { identity } };
    if (operation === "check-permission") return { meta, data: { allowed: true } };
    throw new Error("unexpected operation");
  } };
  let second = 0;
  const result = await runObservabilitySynthetics({
    transport, expectedIdentity: identity, target,
    clock: () => `2026-08-26T00:00:0${++second}Z`
  });
  assert.deepEqual(observabilitySyntheticNames, ["health", "bootstrap", "exemplar"]);
  assert.deepEqual(operations, ["health", "bootstrap", "check-permission"]);
  assert.deepEqual(result.map(({ name }) => name), ["health", "bootstrap", "exemplar"]);
  assert.equal(result.every(({ status }) => status === "passed"), true);
  assert.equal(result.every(({ target: observed }) =>
    observed.kind === "staged-cloudfront" &&
    observed.baseUrl === "https://staging.demo.eacl.dev/"), true);
  assert.equal(result.every(({ observedIdentity }) =>
    observedIdentity.artifactSha256 === identity.artifactSha256), true);
});

test("direct origins, route drift, identity drift, and exemplar mismatch fail closed", async () => {
  const passing = { async request(operation) {
    const meta = { revision: "basis-1", requestId: `request-${operation}` };
    if (operation === "health") return { meta, data: { ready: true, status: "ready", identity } };
    if (operation === "bootstrap") return { meta, data: { identity } };
    return { meta, data: { allowed: false } };
  } };
  await assert.rejects(
    runObservabilitySynthetics({ transport: passing, expectedIdentity: identity,
      target: { ...target, kind: "direct-origin" } }),
    /staged CloudFront/u
  );
  await assert.rejects(
    runObservabilitySynthetics({ transport: passing, expectedIdentity: identity,
      target: { ...target, path: "/" } }),
    /path does not match/u
  );
  await assert.rejects(
    runObservabilitySynthetics({ transport: passing,
      expectedIdentity: { ...identity, artifactSha256: "e".repeat(64) },
      target }),
    /profile|identity/u
  );
  await assert.rejects(
    runObservabilitySynthetics({ transport: passing, expectedIdentity: identity,
      target }),
    /exemplar disagrees/u
  );
});
