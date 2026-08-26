import assert from "node:assert/strict";
import test from "node:test";
import { validateDescriptorHandshake } from "./src/descriptor-handshake.mjs";

const sha = (character, length) => character.repeat(length);
const registryProfile = {
  id: "datahike-s3", backend: "datahike", storage: "s3", state: "enabled", reason: null, route: "/api/v1/datahike-s3",
  deployment: { demoSha: sha("a", 40), eaclSha: sha("b", 40), artifact: { kind: "lambda-version", sha256: sha("c", 64), version: "7" }, deploymentId: "deploy-7", dataManifestSha256: sha("d", 64), deployedAt: "2026-08-25T12:00:00Z" }
};
const identity = { profileId: registryProfile.id, demoSha: registryProfile.deployment.demoSha, eaclSha: registryProfile.deployment.eaclSha, artifactSha256: registryProfile.deployment.artifact.sha256, deploymentId: registryProfile.deployment.deploymentId, dataManifestSha256: sha("d", 64) };
const basis = { behavior: "request-snapshot", id: "basis-1", capturedAt: "2026-08-25T12:00:00Z", fixedForEnvironment: false };
const health = { status: "ready", ready: true, identity, basis };
const bootstrap = {
  contract: { name: "explorer.v1", routeMajor: 1, revision: 1, minimumClientRevision: 0 }, identity,
  profile: { backend: "datahike", storage: "s3" },
  runtime: { execution: "lambda", name: "java25", architecture: "arm64", snapStart: "enabled" },
  capabilities: { operations: ["authorize"], consistencyModes: ["current"], snapshotBehavior: "request-snapshot", cacheBehavior: "shared-read-through", mutationLocality: "private-seed-workflow", limitations: ["read-only"] },
  limits: [{ name: "page-size", value: 25 }], dataset: { fixtureId: "canonical-v1", logicalResourceCount: 1000000, manifestSha256: identity.dataManifestSha256 }, basis
};

test("route, registry, health and bootstrap establish one trusted descriptor", () => {
  const descriptor = validateDescriptorHandshake({ registryProfile, route: registryProfile.route, health, bootstrap });
  assert.equal(descriptor.profileId, registryProfile.id);
  assert.equal(descriptor.deployment.artifactSha256, registryProfile.deployment.artifact.sha256);
  assert.equal(descriptor.dataManifestSha256, identity.dataManifestSha256);
  assert.equal(descriptor.basis.id, basis.id);
});

test("route, artifact, registry, data and basis mismatches fail before use", () => {
  const cases = [
    { route: "/api/v1/datahike-dynamodb", health, bootstrap },
    { route: registryProfile.route, health: { ...health, identity: { ...identity, artifactSha256: sha("e", 64) } }, bootstrap },
    { route: registryProfile.route, health, bootstrap: { ...bootstrap, identity: { ...identity, demoSha: sha("f", 40) } } },
    { route: registryProfile.route, health, bootstrap: { ...bootstrap, profile: { backend: "datomic", storage: "dynamodb" } } },
    { route: registryProfile.route, health, bootstrap: { ...bootstrap, dataset: { ...bootstrap.dataset, manifestSha256: sha("e", 64) } } },
    { route: registryProfile.route, health, bootstrap: { ...bootstrap, basis: { ...basis, id: "other" } } }
  ];
  for (const candidate of cases) assert.throws(() => validateDescriptorHandshake({ registryProfile, ...candidate }), (error) => error.code === "identity-mismatch");
});

test("non-ready and non-enabled profiles cannot pass bootstrap", () => {
  assert.throws(() => validateDescriptorHandshake({ registryProfile, route: registryProfile.route, health: { ...health, ready: false, status: "starting" }, bootstrap }), /health is not ready/u);
  assert.throws(() => validateDescriptorHandshake({ registryProfile: { ...registryProfile, state: "qualifying", deployment: null }, route: registryProfile.route, health, bootstrap }), /not enabled/u);
});
