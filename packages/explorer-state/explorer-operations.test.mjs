import assert from "node:assert/strict";
import test from "node:test";

import { createExplorerController } from "./src/explorer-controller.mjs";
import { createExplorerOperations } from "./src/explorer-operations.mjs";
import { createMockTransportEnvironment } from "./support/mock-transports.mjs";

test("subject and relationship cursor pages are bounded and reversible", async () => {
  const environment = createMockTransportEnvironment("datahike-s3", { responses: {
    "list-subjects": (input) => page(input.cursor ? "user-2" : "user-1", input.pageSize, !input.cursor),
    "list-relationships": (input) => ({ items: [{ resourceType: input.resourceType, resourceId: input.resourceId, relation: input.relation ?? "owner", subjectType: "user", subjectId: input.cursor ? "user-2" : "user-1", subjectRelation: null }], pageInfo: { hasNextPage: !input.cursor, endCursor: input.cursor ? null : "opaque-next", pageSize: input.pageSize } })
  } });
  const controller = createExplorerController({ transportFactory: environment.transportFactory });
  await controller.switchProfile(environment.profile);
  const operations = createExplorerOperations({ controller });
  await operations.listSubjects();
  await operations.listSubjects({ direction: "next" });
  await operations.listSubjects({ direction: "previous" });
  const subjectCalls = environment.calls.filter(({ operation }) => operation === "list-subjects");
  assert.deepEqual(subjectCalls.map(({ input }) => input.cursor ?? null), [null, "opaque-next", null]);
  assert.equal(subjectCalls.every(({ input }) => input.pageSize === 25), true);
  await operations.listRelationships({ resourceType: "server", resourceId: "server-1", relation: "owner" });
  await operations.listRelationships({ resourceType: "server", resourceId: "server-1", relation: "owner", direction: "next" });
  assert.equal(Object.keys(operations.getState().pagers).length, 2);
  await controller.close();
});

test("profile epochs discard every old cursor before the next operation", async () => {
  const first = createMockTransportEnvironment("datahike-s3", { responses: { "list-subjects": (input) => page("user-1", input.pageSize, true) } });
  const second = createMockTransportEnvironment("datahike-dynamodb");
  const controller = createExplorerController({ transportFactory: (profile, context) => (profile.id === first.profile.id ? first : second).transportFactory(profile, context) });
  await controller.switchProfile(first.profile);
  const operations = createExplorerOperations({ controller });
  await operations.listSubjects();
  assert.equal(operations.getState().pagers["subjects:all"].pageInfo.endCursor, "opaque-next");
  await controller.switchProfile(second.profile);
  await operations.listSubjects();
  const secondCall = second.calls.find(({ operation }) => operation === "list-subjects");
  assert.equal("cursor" in secondCall.input, false);
  assert.equal(operations.getState().epoch, controller.getState().epoch);
  await controller.close();
});

test("resource, reverse, schema, cache, and independent permission details use closed inputs", async () => {
  const environment = createMockTransportEnvironment("datalevin-memory");
  const controller = createExplorerController({ transportFactory: environment.transportFactory });
  await controller.switchProfile(environment.profile);
  const operations = createExplorerOperations({ controller });
  await operations.getObject({ type: "server", id: "server-1" });
  await operations.reverseRelationships({ subjectType: "user", subjectId: "user-1", relation: "owner" });
  await operations.getSchema();
  await operations.getCacheInfo();
  await operations.authorize({ subjectType: "user", subjectId: "user-1", resourceType: "server", resourceId: "server-1", permission: "view" });
  await operations.authorize({ subjectType: "user", subjectId: "user-1", resourceType: "server", resourceId: "server-1", permission: "admin" });
  assert.deepEqual(environment.calls.find(({ operation }) => operation === "get-object").input, { type: "server", id: "server-1", consistency: "current" });
  assert.equal(Object.keys(controller.getState().panels).filter((id) => id.startsWith("authorization-")).length, 2);
  await assert.rejects(operations.getObject({ type: "server", id: "bad id" }), /invalid resource ID/u);
  await controller.close();
});

test("counts escalate only through bounded ceilings and stop after exact result", async () => {
  const environment = createMockTransportEnvironment("datahike-dynamodb", { responses: {
    "count-objects": (input) => ({ kind: input.kind, value: Math.min(input.ceiling, 25_000), exact: input.ceiling >= 25_000, ceiling: input.ceiling })
  } });
  const controller = createExplorerController({ transportFactory: environment.transportFactory });
  await controller.switchProfile(environment.profile);
  const operations = createExplorerOperations({ controller });
  await operations.countObjects({ type: "server" });
  await operations.countObjects({ type: "server", escalate: true });
  await operations.countObjects({ type: "server", escalate: true });
  const complete = await operations.countObjects({ type: "server", escalate: true });
  assert.deepEqual(environment.calls.filter(({ operation }) => operation === "count-objects").map(({ input }) => input.ceiling), [1_000, 10_000, 100_000]);
  assert.equal(complete.outcome, "complete");
  assert.equal(operations.getState().counts["objects:server"].exact, true);
  await controller.close();
});

test("malformed pages and fabricated over-ceiling counts are rejected", async () => {
  const environment = createMockTransportEnvironment("jank-memory", { responses: {
    "list-subjects": (input) => ({ items: [], pageInfo: { hasNextPage: true, endCursor: null, pageSize: input.pageSize } }),
    "count-objects": (input) => ({ kind: input.kind, value: input.ceiling + 1, exact: true, ceiling: input.ceiling })
  } });
  const controller = createExplorerController({ transportFactory: environment.transportFactory });
  await controller.switchProfile(environment.profile);
  const operations = createExplorerOperations({ controller });
  assert.equal((await operations.listSubjects()).outcome, "failure");
  assert.equal((await operations.countObjects()).outcome, "failure");
  assert.equal(controller.getState().panels.subjects.phase, "error");
  await controller.close();
});

test("first relationship pages and bounded counts can be canceled by logical scope", async () => {
  const environment = createMockTransportEnvironment("datascript-browser-memory", { delayMs: 100 });
  const controller = createExplorerController({ transportFactory: environment.transportFactory });
  await controller.switchProfile(environment.profile);
  const operations = createExplorerOperations({ controller });
  const relationships = operations.listRelationships({ resourceType: "account", resourceId: "account-0", relation: "owner" });
  assert.equal(operations.cancel("relationships:account:account-0:owner"), true);
  assert.equal((await relationships).outcome, "canceled");
  const count = operations.countObjects({ kind: "objects", type: "server" });
  assert.equal(operations.cancelCount({ kind: "objects", type: "server" }), true);
  assert.equal((await count).outcome, "canceled");
  assert.equal(environment.cancellations.length, 2);
  await controller.close();
});

function page(subjectId, pageSize, hasNextPage) {
  return { items: [{ type: "user", id: subjectId, displayName: subjectId, attributes: [] }], pageInfo: { hasNextPage, endCursor: hasNextPage ? "opaque-next" : null, pageSize } };
}
