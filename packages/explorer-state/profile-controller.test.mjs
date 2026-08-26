import assert from "node:assert/strict";
import test from "node:test";
import { assertDescriptorIdentity, createProfileController } from "./src/profile-controller.mjs";

const enabled = (id, seed) => ({
  id, backend: id.split("-")[0], storage: id.endsWith("-s3") ? "s3" : "dynamodb", state: "enabled", reason: null,
  deployment: { demoSha: seed.repeat(40), eaclSha: "e".repeat(40), artifact: { sha256: seed.repeat(64) }, deploymentId: `deploy-${id}`, dataManifestSha256: "d".repeat(64) }
});
const descriptor = (profile) => ({ profile: { backend: profile.backend, storage: profile.storage }, identity: { profileId: profile.id, demoSha: profile.deployment.demoSha, eaclSha: profile.deployment.eaclSha, artifactSha256: profile.deployment.artifact.sha256, deploymentId: profile.deployment.deploymentId, dataManifestSha256: profile.deployment.dataManifestSha256 } });

test("switch cancels, releases, clears profile state, checks identity, and starts page one", async () => {
  const released = [];
  const signals = [];
  const controller = createProfileController({
    transportFactory: (profile, { signal }) => {
      signals.push(signal);
      return { bootstrap: async () => descriptor(profile), request: async () => "ok", release: async () => released.push(profile.id) };
    }
  });
  const first = enabled("datahike-s3", "a");
  const second = enabled("datomic-dynamodb", "b");
  assert.equal((await controller.switchProfile(first, { subject: "alice", cursor: "forbidden" })).outcome, "ready");
  assert.equal((await controller.switchProfile(second, { subject: "bob" })).outcome, "ready");
  const state = controller.getState();
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(released, ["datahike-s3"]);
  assert.equal(state.epoch, 2);
  assert.equal(state.page, 1);
  assert.equal(state.cursor, null);
  assert.deepEqual(state.pages, []);
  assert.deepEqual(state.portableIntent, { subject: "bob" });
  assert.equal(state.descriptor.identity.profileId, second.id);
  await controller.close();
  assert.deepEqual(released, ["datahike-s3", "datomic-dynamodb"]);
});

test("descriptor source or artifact mismatch prevents readiness and releases state", async () => {
  const profile = enabled("datahike-s3", "a");
  let releaseCount = 0;
  const controller = createProfileController({ transportFactory: () => ({ bootstrap: async () => ({ ...descriptor(profile), identity: { ...descriptor(profile).identity, artifactSha256: "f".repeat(64) } }), release: async () => { releaseCount += 1; } }) });
  await assert.rejects(controller.switchProfile(profile), /descriptor deployment identity mismatch/u);
  assert.equal(controller.getState().status, "error");
  assert.equal(releaseCount, 1);
});

test("identity checker rejects cross-profile descriptors", () => {
  const profile = enabled("datahike-s3", "a");
  assert.throws(() => assertDescriptorIdentity(profile, { ...descriptor(profile), identity: { ...descriptor(profile).identity, profileId: "datahike-dynamodb" } }), /profile identity/u);
});

test("rapid switches make a late bootstrap success stale and release exactly once", async () => {
  const firstBootstrap = deferred();
  const first = enabled("datahike-s3", "a");
  const second = enabled("datomic-dynamodb", "b");
  const releases = new Map();
  const controller = createProfileController({
    transportFactory: (profile) => ({
      bootstrap: () => profile.id === first.id ? firstBootstrap.promise : Promise.resolve(descriptor(profile)),
      release: async () => releases.set(profile.id, (releases.get(profile.id) ?? 0) + 1)
    })
  });
  const firstSwitch = controller.switchProfile(first);
  await Promise.resolve();
  const secondSwitch = controller.switchProfile(second);
  assert.equal((await secondSwitch).outcome, "ready");
  firstBootstrap.resolve(descriptor(first));
  assert.equal((await firstSwitch).outcome, "stale");
  assert.equal(controller.getState().profileId, second.id);
  assert.equal(releases.get(first.id), 1);
  await controller.close();
});

test("late request success and error cannot overwrite a newer epoch", async () => {
  const first = enabled("datahike-s3", "a");
  const second = enabled("datomic-dynamodb", "b");
  const lateSuccess = deferred();
  const lateError = deferred();
  let requestCount = 0;
  const controller = createProfileController({
    transportFactory: (profile) => ({
      bootstrap: async () => descriptor(profile),
      request: () => (++requestCount === 1 ? lateSuccess.promise : lateError.promise),
      release: async () => {}
    })
  });
  await controller.switchProfile(first);
  const successRequest = controller.request("get-object", { id: "large-only-object" });
  const errorRequest = controller.request("get-object", { id: "other" });
  await controller.switchProfile(second);
  lateSuccess.resolve({ object: { id: "large-only-object" } });
  lateError.reject(new Error("late backend failure"));
  assert.equal((await successRequest).outcome, "stale");
  assert.equal((await errorRequest).outcome, "stale");
  assert.equal(controller.getState().status, "ready");
  await controller.close();
});

test("unavailable profiles are rejected before epoch or transport creation", async () => {
  let factories = 0;
  const controller = createProfileController({ transportFactory: () => { factories += 1; return {}; } });
  await assert.rejects(controller.switchProfile({ id: "jank-memory", state: "unavailable", reason: "Linux artifact is not qualified.", deployment: null }), /Linux artifact/u);
  assert.equal(factories, 0);
  assert.equal(controller.getState().epoch, 0);
});

test("a missing object on the smaller fixture remains a scoped response", async () => {
  const profile = enabled("datalevin-memory", "c");
  const controller = createProfileController({
    transportFactory: () => ({ bootstrap: async () => descriptor(profile), request: async () => ({ ok: false, error: { code: "not-found", message: "Object is outside this fixture." } }), release: async () => {} })
  });
  await controller.switchProfile(profile, { resourceId: "server-999999" });
  const result = await controller.request("get-object", { id: "server-999999" });
  assert.equal(result.outcome, "success");
  assert.equal(result.value.error.code, "not-found");
  assert.equal(controller.getState().status, "ready");
  await controller.close();
});

test("DataScript worker teardown runs exactly once", async () => {
  const profile = enabled("datascript-browser-memory", "d");
  let terminations = 0;
  const controller = createProfileController({ transportFactory: () => ({ bootstrap: async () => descriptor(profile), release: async () => { terminations += 1; } }) });
  await controller.switchProfile(profile);
  await controller.close();
  await controller.close();
  assert.equal(terminations, 1);
});

test("mixed deployment generations are accepted when each descriptor matches its own registry entry", async () => {
  const oldGeneration = enabled("datahike-s3", "a");
  const newGeneration = enabled("datomic-dynamodb", "b");
  newGeneration.deployment.eaclSha = "f".repeat(40);
  const controller = createProfileController({ transportFactory: (profile) => ({ bootstrap: async () => descriptor(profile), release: async () => {} }) });
  await controller.switchProfile(oldGeneration);
  assert.equal(controller.getState().descriptor.identity.demoSha, "a".repeat(40));
  await controller.switchProfile(newGeneration);
  assert.equal(controller.getState().descriptor.identity.demoSha, "b".repeat(40));
  assert.equal(controller.getState().descriptor.identity.eaclSha, "f".repeat(40));
  await controller.close();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
