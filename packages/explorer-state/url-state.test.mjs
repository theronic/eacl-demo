import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalUrlLimits, parseCanonicalUrl, serializeCanonicalUrl } from "./src/url-state.mjs";

const catalog = JSON.parse(await readFile(new URL("../contracts/backend-storage.v1.json", import.meta.url), "utf8"));

test("canonical parsing and serialization retain only bounded semantic intent", () => {
  const parsed = parseCanonicalUrl("?backend=datahike&storage=dynamodb&subject-type=user&subject=user%3Aalice&resource-type=server&resource-id=server-42&permission=read&relation=owner&view=authorization&page-size=50&cache=off&consistency=exact", catalog);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.state, { backend: "datahike", storage: "dynamodb", platform: "lambda-1024", subjectType: "user", subject: "user:alice", resourceType: "server", resourceId: "server-42", permission: "read", relation: "owner", view: "authorization", pageSize: 50, cacheEnabled: false, consistencyMode: "exact" });
  assert.equal(parsed.canonicalSearch, serializeCanonicalUrl(parsed.state, catalog));
});

test("cursor, token, basis, request, revision, and secret fields never serialize", () => {
  const forbidden = new URLSearchParams([["backend", "datahike"], ["storage", "s3"], ["cursor", "opaque"], ["token", "x"], ["basis", "42"], ["request-id", "r"], ["revision", "9"], [["sec", "ret"].join(""), "bad"]]);
  const parsed = parseCanonicalUrl(`?${forbidden}`, catalog);
  assert.equal(parsed.issues.filter(({ code }) => code === "forbidden-field").length, 6);
  assert.equal(parsed.canonicalSearch, "?backend=datahike&storage=s3&platform=lambda-1024");
  const serialized = serializeCanonicalUrl({ ...parsed.state, cursor: "opaque", token: "x", basis: "42", requestId: "r", secret: "bad" }, catalog);
  assert.equal(serialized, "?backend=datahike&storage=s3&platform=lambda-1024");
});

test("individual values and the total search string are bounded", () => {
  const tooLongSubject = "a".repeat(canonicalUrlLimits.fields.subject + 1);
  const fieldResult = parseCanonicalUrl(`?backend=datahike&storage=s3&subject=${tooLongSubject}`, catalog);
  assert.deepEqual(fieldResult.issues, [{ code: "invalid-value", field: "subject" }]);
  assert.equal("subject" in fieldResult.state, false);
  const totalResult = parseCanonicalUrl(`?backend=datahike&storage=s3&unknown=${"a".repeat(canonicalUrlLimits.maxSearchBytes)}`, catalog);
  assert.deepEqual(totalResult.issues, [{ code: "url-too-large", field: null }]);
  assert.deepEqual(totalResult.state, { backend: "datascript", storage: "browser-memory", platform: "browser" });
});

test("preference-shaped portable fields normalize strictly", () => {
  const parsed = parseCanonicalUrl("?backend=datomic&storage=dynamodb&page-size=0&cache=yes&consistency=eventual", catalog);
  assert.deepEqual(parsed.issues, [
    { code: "invalid-value", field: "page-size" },
    { code: "invalid-value", field: "cache" },
    { code: "invalid-value", field: "consistency" }
  ]);
  assert.equal("pageSize" in parsed.state, false);
  assert.equal(serializeCanonicalUrl({ ...parsed.state, pageSize: 1000, cacheEnabled: true, consistencyMode: "minimize" }, catalog), "?backend=datomic&storage=dynamodb&platform=lambda-1024&page-size=1000&cache=on&consistency=minimize");
});

test("platform links fail closed to the supported deployment matrix", () => {
  const ec2 = parseCanonicalUrl("?backend=datomic&storage=dynamodb&platform=ec2", catalog);
  assert.equal(ec2.state.platform, "ec2");
  assert.deepEqual(ec2.issues, []);
  const unsupported = parseCanonicalUrl("?backend=datahike&storage=dynamodb&platform=ec2", catalog);
  assert.equal(unsupported.state.platform, "lambda-1024");
  assert.deepEqual(unsupported.issues, [{ code: "invalid-platform", field: "platform" }]);
});
