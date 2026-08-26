import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { jsonPayloadSha256, readBoundedJsonResponse, readBoundedTextResponse } from "./src/http-client.mjs";

test("browser-compatible payload hashing produces the lowercase SigV4 payload digest", async () => {
  const body = JSON.stringify({ subjectId: "user-1" });
  assert.equal(await jsonPayloadSha256(body), createHash("sha256").update(body).digest("hex"));
});

test("bounded response parsing stops oversized streams before JSON parsing", async () => {
  assert.equal(await readBoundedTextResponse(new Response("plain text")), "plain text");
  assert.deepEqual(await readBoundedJsonResponse(new Response('{"ok":true}')), { ok: true });
  await assert.rejects(() => readBoundedJsonResponse(new Response('x'.repeat(9)), { maximumBytes: 8 }), (error) => error.code === "response-too-large");
  await assert.rejects(() => readBoundedJsonResponse(new Response("[]")), (error) => error.code === "invalid-response");
  await assert.rejects(() => readBoundedJsonResponse({ headers: new Headers({ "content-length": "1048577" }), body: new ReadableStream() }), (error) => error.code === "response-too-large");
});
