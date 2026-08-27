import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const template = await readFile(new URL("../infra/static/template.yaml", import.meta.url), "utf8");
const match = template.match(/      FunctionCode: \|\n([\s\S]*?)      FunctionConfig:/u);
assert.ok(match, "CloudFront function source must be extractable");
const source = match[1].split("\n").map((line) => line.replace(/^ {8}/u, "")).join("\n");
const context = {};
vm.runInNewContext(source, context, { filename: "static-viewer-request-rewrite.js" });

const request = (uri, method = "GET") => ({ request: { uri, method, headers: {}, querystring: {} } });
const directOrigins = [
  "nkpogjjpx5wyb4imujlrefedqu0qpqwu.lambda-url.us-east-1.on.aws",
  "kfhndav4wq4rtmyugoriekcztm0mjrza.lambda-url.us-east-1.on.aws",
  "n56bfv3ompn6h4cqnxsi5bhavm0gwfrm.lambda-url.us-east-1.on.aws",
];

test("CloudFront serves only the two static Explorer entries", () => {
  const patterns = [...template.matchAll(/^\s+- PathPattern: ([^\n]+)$/gmu)].map((entry) => entry[1]);
  assert.deepEqual(patterns, ["datascript/*"]);
  assert.equal((template.match(/TargetOriginId: static/gu) ?? []).length, 2);
  assert.equal((template.match(/^\s{10}- DomainName:/gmu) ?? []).length, 1);
  assert.doesNotMatch(template, /api\/v1\/|LambdaOrigin|ApiCachePolicy|ApiOriginRequestPolicy|AWS::Lambda::Permission|InvokeFunctionUrl|x-amz-content-sha256/u);
  assert.match(template, /DefaultCacheBehavior:[\s\S]*CachePolicyId: !Ref StaticCachePolicy[\s\S]*TargetOriginId: static/u);
  assert.match(template, /PathPattern: datascript\/\*[\s\S]*CachePolicyId: !Ref StaticCachePolicy[\s\S]*TargetOriginId: static/u);
});

test("static route rewrites preserve the two canonical entries only", () => {
  for (const uri of ["/datahike", "/datahike/"]) assert.equal(context.handler(request(uri)).uri, "/index.html");
  for (const uri of ["/datascript", "/datascript/"]) assert.equal(context.handler(request(uri)).uri, "/datascript/index.html");
  const api = request("/api/v1/datahike-s3/health");
  assert.deepEqual(context.handler(api), api.request);
});

test("the static CSP admits only the exact direct Function URL origins", () => {
  for (const origin of directOrigins) assert.ok(template.includes(`https://${origin}`));
  assert.match(template, /connect-src 'self'[^;]+lambda-url\.us-east-1\.on\.aws/u);
  assert.match(template, /worker-src 'none'/u);
  assert.doesNotMatch(template, /unsafe-eval|https:\/\/\*\.lambda-url/u);
});
