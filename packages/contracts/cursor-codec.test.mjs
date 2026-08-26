import assert from "node:assert/strict";
import test from "node:test";
import { createCursorCodec } from "./src/cursor-codec.mjs";

const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const scope = { keyBytes, profileId: "datahike-s3", deploymentId: "deploy-1", dataManifestSha256: "a".repeat(64), lifecycleId: "environment-1", ttlMs: 1000 };

test("cursor round-trip is independent of query key insertion order", async () => {
  const codec = await createCursorCodec({ ...scope, now: () => 1000 });
  const token = await codec.encode({ operation: "list-subjects", query: { type: "user", pageSize: 25 }, position: { offset: 25 } });
  assert.deepEqual(await codec.decode(token, { operation: "list-subjects", query: { pageSize: 25, type: "user" } }), { offset: 25 });
  assert.equal(token.includes("user"), false);
});

test("tampering is detected before payload parsing", async () => {
  const codec = await createCursorCodec({ ...scope, now: () => 1000 });
  const token = await codec.encode({ operation: "list-subjects", query: {}, position: { offset: 25 } });
  const altered = `${token.slice(0, -2)}${token.endsWith("a") ? "b" : "a"}`;
  await assert.rejects(codec.decode(altered, { operation: "list-subjects", query: {} }), (error) => error.code === "cursor-invalid");
});

test("cursor cannot cross profile, query, lifecycle, deployment, data, operation, or contract", async () => {
  const source = await createCursorCodec({ ...scope, now: () => 1000 });
  const token = await source.encode({ operation: "list-subjects", query: { type: "user" }, position: { offset: 25 } });
  const variants = [
    { profileId: "datahike-dynamodb" }, { lifecycleId: "environment-2" }, { deploymentId: "deploy-2" },
    { dataManifestSha256: "b".repeat(64) }, { contractVersion: "explorer.v0" }
  ];
  for (const variant of variants) {
    const other = await createCursorCodec({ ...scope, ...variant, now: () => 1000 });
    await assert.rejects(other.decode(token, { operation: "list-subjects", query: { type: "user" } }), (error) => error.code === "cursor-scope-mismatch");
  }
  await assert.rejects(source.decode(token, { operation: "count-objects", query: { type: "user" } }), (error) => error.code === "cursor-scope-mismatch");
  await assert.rejects(source.decode(token, { operation: "list-subjects", query: { type: "service" } }), (error) => error.code === "cursor-scope-mismatch");
});

test("expired and oversized cursors use stable failures", async () => {
  let time = 1000;
  const codec = await createCursorCodec({ ...scope, now: () => time });
  const token = await codec.encode({ operation: "list-subjects", query: {}, position: { offset: 25 } });
  time = 2000;
  await assert.rejects(codec.decode(token, { operation: "list-subjects", query: {} }), (error) => error.code === "cursor-expired");
  await assert.rejects(codec.decode("a".repeat(4097), { operation: "list-subjects", query: {} }), (error) => error.code === "cursor-invalid");
});
