import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const template = await readFile(new URL("../infra/static/template.yaml", import.meta.url), "utf8");
const match = template.match(/      FunctionCode: \|\n([\s\S]*?)      FunctionConfig:/u);
assert.ok(match, "CloudFront function source must be extractable");
const source = match[1].split("\n").map((line) => line.replace(/^ {8}/u, "")).join("\n");
const context = {};
vm.runInNewContext(source, context, { filename: "api-viewer-request-gate.js" });

const request = (uri, method, headers = {}, querystring = {}) => ({ request: { uri, method, headers, querystring } });
const hash = "a".repeat(64);
const jsonHeaders = { "content-type": { value: "application/json; charset=utf-8" }, "x-amz-content-sha256": { value: hash } };

test("CloudFront behavior order and cache policy keep static and APIs isolated", () => {
  const patterns = [...template.matchAll(/^\s+- PathPattern: ([^\n]+)$/gmu)].map((match) => match[1]);
  assert.deepEqual(patterns, [
    "datascript/*",
    "api/v1/datahike-s3/*",
    "api/v1/datahike-dynamodb/*",
    "api/v1/datomic-dynamodb/*",
    "api/v1/datalevin-memory/*",
    "api/v1/jank-memory/*"
  ]);
  assert.match(template, /ApiCachePolicy:[\s\S]*DefaultTTL: 0\s*\n\s*MaxTTL: 0\s*\n\s*MinTTL: 0/u);
  assert.equal((template.match(/CachePolicyId: !Ref ApiCachePolicy/gu) ?? []).length, 5);
  assert.match(template, /DefaultCacheBehavior:[\s\S]*CachePolicyId: !Ref StaticCachePolicy[\s\S]*TargetOriginId: static/u);
  assert.match(template, /DefaultCacheBehavior:[\s\S]*FunctionAssociations:\s*\n\s*- EventType: viewer-request\s*\n\s*FunctionARN: !GetAtt ApiViewerRequestGate.FunctionARN[\s\S]*TargetOriginId: static/u);
  assert.match(template, /PathPattern: datascript\/\*[\s\S]*CachePolicyId: !Ref StaticCachePolicy[\s\S]*TargetOriginId: static/u);
  assert.doesNotMatch(template, /unsafe-eval/u);
});

test("legacy Datahike entry paths render the current backend explorer", () => {
  for (const uri of ["/datahike", "/datahike/"]) {
    const event = request(uri, "GET");
    assert.equal(context.handler(event).uri, "/index.html");
  }
});

test("every enabled Lambda origin must name a nonnumeric alias", () => {
  const qualifiedPattern = "AllowedPattern: \"^(?:disabled|[A-Za-z0-9_-]{1,64}:(?![0-9]+$)[A-Za-z0-9_-]{1,128})$\"";
  assert.equal(template.split(qualifiedPattern).length - 1, 5);
  assert.equal((template.match(/!Not \[!Equals \[!Ref [A-Za-z0-9]+FunctionName, disabled\]\]/gu) ?? []).length, 5);
  assert.equal((template.match(/FunctionName: !Ref [A-Za-z0-9]+FunctionName/gu) ?? []).length, 10);
});

test("the edge gate leaves application validation to the origin", () => {
  for (const [uri, method, headers] of [
    ["/api/v1/datahike-s3/health", "GET", {}],
    ["/api/v1/datahike-dynamodb/authorize", "POST", jsonHeaders],
    ["/api/v1/datomic-dynamodb/count-objects", "POST", jsonHeaders],
    ["/api/v1/datalevin-memory/bootstrap", "GET", {}],
    ["/api/v1/jank-memory/get-schema", "POST", jsonHeaders],
    ["/api/v1/datahike-s3/seed", "POST", jsonHeaders],
    ["/api//v1/datahike-s3/health", "GET", {}],
    ["/api/v1/datahike-s3/health", "GET", { "content-type": { value: "application/json" } }],
    ["/api/v1/datahike-s3/authorize", "POST", { "content-type": { value: "text/plain" }, "x-amz-content-sha256": { value: hash } }]
  ]) {
    const event = request(uri, method, headers);
    assert.deepEqual(context.handler(event), event.request);
  }
  const queried = request("/api/v1/datahike-s3/health", "GET", {}, { debug: { value: "true" } });
  assert.deepEqual(context.handler(queried), queried.request);
});

test("only POST requests lacking a valid signing hash fail at the edge", () => {
  const cases = [
    request("/api/v1/datahike-s3/authorize", "POST", { "content-type": { value: "application/json" } }),
    request("/api/v1/datahike-s3/authorize", "POST", { "content-type": { value: "application/json" }, "x-amz-content-sha256": { value: "A".repeat(64) } })
  ];
  for (const event of cases) {
    const response = context.handler(event);
    assert.equal(response.statusCode, 400);
    assert.equal(JSON.parse(response.body).transportError.code, "payload-hash-required");
    assert.equal(response.headers["cache-control"].value, "no-store");
  }
});
