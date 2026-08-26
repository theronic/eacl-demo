import assert from "node:assert/strict";
import test from "node:test";

import { createExplorerController, explorerDefaults, validateDescriptorCapabilities } from "./src/explorer-controller.mjs";
import { createMockTransportEnvironment, mockCapabilityScenarios, mockLogicalOperations } from "./support/mock-transports.mjs";

test("mock transports cover every declared profile and advertised capability combination", async () => {
  assert.deepEqual(mockCapabilityScenarios.map(({ profile }) => profile.id), [
    "datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory", "jank-memory", "datascript-browser-memory"
  ]);
  const fingerprints = new Set(mockCapabilityScenarios.map(({ descriptor }) => JSON.stringify({ profile: descriptor.profile, runtime: descriptor.runtime, capabilities: descriptor.capabilities })));
  assert.equal(fingerprints.size, mockCapabilityScenarios.length);

  for (const scenario of mockCapabilityScenarios) {
    const environment = createMockTransportEnvironment(scenario);
    const controller = createExplorerController({ transportFactory: environment.transportFactory });
    const switched = await controller.switchProfile(environment.profile);
    assert.equal(switched.outcome, "ready");
    validateDescriptorCapabilities(environment.profile, switched.descriptor);
    for (const operation of mockLogicalOperations.filter((name) => name !== "bootstrap")) {
      assert.equal((await controller.runPanel(operation, operation, {})).outcome, "success", `${scenario.profile.id}/${operation}`);
    }
    await controller.close();
    assert.deepEqual(environment.releases, [scenario.profile.id]);
  }
});

test("unsupported capabilities fail before transport invocation", async () => {
  const environment = createMockTransportEnvironment("datomic-dynamodb");
  environment.scenario.descriptor.capabilities.operations = environment.scenario.descriptor.capabilities.operations.filter((name) => name !== "get-cache-info");
  const controller = createExplorerController({ transportFactory: environment.transportFactory });
  await controller.switchProfile(environment.profile);
  await assert.rejects(controller.runPanel("cache", "get-cache-info", {}), (error) => error.code === "unsupported-capability");
  assert.equal(environment.calls.some(({ operation }) => operation === "get-cache-info"), false);
  await controller.close();
});

test("profile switching clears owned state and suppresses late panel completion", async () => {
  const first = createMockTransportEnvironment("datahike-s3", { delays: { "get-object": 30 } });
  const second = createMockTransportEnvironment("datalevin-memory");
  const controller = createExplorerController({ transportFactory: (profile, context) => (profile.id === first.profile.id ? first : second).transportFactory(profile, context) });
  await controller.switchProfile(first.profile, { subject: "user-1", resourceId: "server-900000", cursor: "forbidden" });
  const late = controller.runPanel("object", "get-object", { resourceId: "server-900000" });
  await controller.switchProfile(second.profile, controller.getState().portableIntent);
  assert.equal((await late).outcome, "stale");
  const state = controller.getState();
  assert.equal(state.profile.id, second.profile.id);
  assert.deepEqual(state.portableIntent, { subject: "user-1", resourceId: "server-900000" });
  assert.deepEqual(state.panels, {});
  assert.deepEqual(first.releases, [first.profile.id]);
  await controller.close();
});

test("panel failures and cancellation do not erase settled sibling data", async () => {
  const environment = createMockTransportEnvironment("datahike-dynamodb", {
    delays: { "list-relationships": 30 },
    failures: { authorize: { ok: false, meta: null, error: { code: "dependency-unavailable", message: "The profile dependency is unavailable.", retryable: true, details: [] } } }
  });
  const controller = createExplorerController({ transportFactory: environment.transportFactory });
  await controller.switchProfile(environment.profile);
  assert.equal((await controller.runPanel("schema", "get-schema", {})).outcome, "success");
  assert.equal((await controller.runPanel("decision", "authorize", {})).outcome, "failure");
  const pending = controller.runPanel("relationships", "list-relationships", {});
  assert.equal(controller.cancelPanel("relationships"), true);
  assert.equal((await pending).outcome, "canceled");
  const state = controller.getState();
  assert.equal(state.panels.schema.phase, "ready");
  assert.equal(state.panels.decision.phase, "error");
  assert.equal(state.panels.relationships.phase, "canceled");
  await controller.close();
});

test("preferences are bounded and unsupported consistency normalizes to current", async () => {
  const environment = createMockTransportEnvironment("datomic-dynamodb");
  const controller = createExplorerController({ transportFactory: environment.transportFactory, initialPreferences: { consistencyMode: "exact" } });
  assert.equal(explorerDefaults.maximumPageSize, 100);
  await controller.switchProfile(environment.profile);
  assert.equal(controller.getState().preferences.consistencyMode, "current");
  assert.throws(() => controller.setPreferences({ pageSize: 1000 }), /between 1 and 100/u);
  assert.deepEqual(controller.setPreferences({ pageSize: 100, theme: "dark", expanded: ["schema", "schema"] }).expanded, ["schema"]);
  await controller.close();
});

test("startup exposes elapsed cold-or-restore progress and a ready announcement", async () => {
  const environment = createMockTransportEnvironment("datahike-s3");
  const bootstrap = deferred();
  let tick;
  let now = 1_000;
  const controller = createExplorerController({
    transportFactory: () => ({ bootstrap: () => bootstrap.promise, request: async () => ({}), release: async () => {} }),
    clock: () => now,
    scheduleInterval: (callback) => { tick = callback; return 1; },
    clearScheduledInterval: () => {},
    startupTickMs: 10
  });
  const switching = controller.switchProfile(environment.profile);
  await Promise.resolve();
  now = 1_375;
  tick();
  assert.deepEqual(controller.getState().startup, { phase: "initializing", kind: "cold-or-restore", startedAt: 1_000, elapsedMs: 375 });
  bootstrap.resolve(environment.scenario.descriptor);
  assert.equal((await switching).outcome, "ready");
  assert.equal(controller.getState().startup.kind, "cold-or-restore");
  assert.match(controller.getState().announcement.message, /is ready/u);
  await controller.close();
});

test("startup can be canceled and retried without a late readiness transition", async () => {
  const environment = createMockTransportEnvironment("jank-memory", { bootstrapDelayMs: 30 });
  const controller = createExplorerController({ transportFactory: environment.transportFactory });
  const switching = controller.switchProfile(environment.profile);
  await Promise.resolve();
  assert.equal(await controller.cancelStartup(), true);
  assert.equal((await switching).outcome, "stale");
  assert.equal(controller.getState().status, "canceled");
  assert.match(controller.getState().announcement.message, /canceled/u);
  assert.equal((await controller.retryProfile()).outcome, "ready");
  await controller.close();
});

test("retry preserves panel response validation and announces recovery", async () => {
  let failures = 0;
  const environment = createMockTransportEnvironment("datahike-dynamodb", { failures: {
    "get-schema": () => failures++ === 0 ? { ok: false, meta: null, error: { code: "dependency-unavailable", message: "The dependency is unavailable.", retryable: true, details: [] } } : null
  } });
  const controller = createExplorerController({ transportFactory: environment.transportFactory });
  await controller.switchProfile(environment.profile);
  assert.equal((await controller.runPanel("schema", "get-schema", {}, { validate: (value) => {
    if (!Array.isArray(value.types)) throw new Error("schema invalid");
    return value;
  } })).outcome, "failure");
  assert.equal((await controller.retryPanel("schema")).outcome, "success");
  assert.equal(controller.getState().panels.schema.phase, "ready");
  assert.match(controller.getState().announcement.message, /schema updated/u);
  await controller.close();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
