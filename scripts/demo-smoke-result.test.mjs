import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDemoSmoke } from "./lib/demo-smoke-result.mjs";

const manifest = "a".repeat(64);
const response = (data) => ({ statusCode: 200, envelope: { data, meta: { revision: "basis-1", requestId: "smoke-1" } } });
const expectedIdentity = {
  profileId: "datomic-dynamodb",
  demoSha: "b".repeat(40),
  eaclSha: "c".repeat(40),
  artifactSha256: "d".repeat(64),
  deploymentId: "demos:example:datomic-dynamodb"
};
const identity = (dataManifestSha256 = manifest) => ({ ...expectedIdentity, dataManifestSha256 });

test("publishes the manifest reported by the successful runtime smoke", () => {
  const health = response({ identity: identity() });
  const bootstrap = response({
    identity: identity(),
    dataset: { manifestSha256: manifest }
  });
  const result = summarizeDemoSmoke({
    profileId: "datomic-dynamodb",
    expectedIdentity,
    health,
    bootstrap,
    decisions: [],
    mutation: { statusCode: 404 }
  });

  assert.equal(result.dataManifestSha, manifest);
  assert.deepEqual(JSON.parse(result.evidence), [health, bootstrap, { statusCode: 404 }]);
});

test("rejects a health/bootstrap manifest mismatch", () => {
  assert.throws(() => summarizeDemoSmoke({
    profileId: "datomic-dynamodb",
    expectedIdentity,
    health: response({ identity: identity("b".repeat(64)) }),
    bootstrap: response({
      identity: identity(),
      dataset: { manifestSha256: manifest }
    }),
    decisions: [],
    mutation: {}
  }), /health and bootstrap data manifests differ/u);
});

test("rejects a bootstrap dataset/identity manifest mismatch", () => {
  assert.throws(() => summarizeDemoSmoke({
    profileId: "datomic-dynamodb",
    expectedIdentity,
    health: response({ identity: identity() }),
    bootstrap: response({
      identity: identity(),
      dataset: { manifestSha256: "c".repeat(64) }
    }),
    decisions: [],
    mutation: {}
  }), /bootstrap dataset manifest differs/u);
});

test("rejects a runtime deployment identity that differs from the candidate", () => {
  assert.throws(() => summarizeDemoSmoke({
    profileId: "datomic-dynamodb",
    expectedIdentity,
    health: response({ identity: identity() }),
    bootstrap: response({
      identity: { ...identity(), artifactSha256: "e".repeat(64) },
      dataset: { manifestSha256: manifest }
    }),
    decisions: [],
    mutation: {}
  }), /bootstrap deployment identity differs from the candidate/u);
});
