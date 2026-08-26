import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const template = await readFile(new URL("../infra/static/template.yaml", import.meta.url), "utf8");
const client = await readFile(new URL("../packages/contracts/src/http-client.mjs", import.meta.url), "utf8");
const qualification = await readFile(new URL("../packages/qualification/src/targets.mjs", import.meta.url), "utf8");
const functionUrl = await readFile(new URL("../packages/contracts/src/eacl_demo/contracts/function_url.clj", import.meta.url), "utf8");
const identity = await readFile(new URL("../packages/contracts/src/descriptor-handshake.mjs", import.meta.url), "utf8");

assert.match(template, /OriginAccessControlOriginType: lambda/u);
assert.match(template, /SigningBehavior: always/u);
assert.equal((template.match(/OriginAccessControlId: !GetAtt LambdaOriginAccessControl\.Id/gu) ?? []).length, 5);
assert.equal((template.match(/FunctionUrlAuthType: AWS_IAM/gu) ?? []).length, 5);
assert.equal((template.match(/InvokedViaFunctionUrl: true/gu) ?? []).length, 5);
assert.equal((template.match(/DefaultTTL: 0\s*\n\s*MaxTTL: 0\s*\n\s*MinTTL: 0/gu) ?? []).length, 1);
for (const path of ["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory", "jank-memory"]) assert.match(template, new RegExp(`PathPattern: api/v1/${path}/\\*`, "u"));
assert.match(template, /QueryStringBehavior: all/u);
assert.match(template, /request\.headers\['x-amz-content-sha256'\]/u);
assert.match(template, /transportError:/u);
assert.match(template, /Headers:\s*\n\s+- content-type\s*\n\s+- x-amz-content-sha256\s*\n\s+- x-eacl-request-id/u);
assert.match(template, /worker-src 'self' blob:/u);
assert.doesNotMatch(template, /unsafe-eval/u);
assert.equal((template.match(/OriginProtocolPolicy: https-only/gu) ?? []).length, 5);
assert.equal((template.match(/ViewerProtocolPolicy: redirect-to-https/gu) ?? []).length, 7);
assert.match(template, /Action: s3:GetObject/u);
assert.match(template, /AWS:SourceArn:/u);
assert.doesNotMatch(template, /AllowOrigin|AccessControlAllowOrigins|FunctionUrlAuthType: NONE|SigningBehavior: never|SigningBehavior: no-override/u);
assert.match(client, /cryptoImpl\.subtle\.digest\("SHA-256"/u);
assert.match(client, /MAXIMUM_RESPONSE_BYTES = 1_048_576/u);
assert.match(qualification, /"x-amz-content-sha256": await jsonPayloadSha256\(body\)/u);
assert.match(functionUrl, /maximum-request-body-bytes 65536/u);
assert.match(functionUrl, /maximum-response-body-bytes 1048576/u);
assert.match(functionUrl, /not-empty \(:rawQueryString event\)/u);
assert.match(functionUrl, /get headers "x-eacl-request-id"/u);
assert.doesNotMatch(template, /route-not-found|method-not-allowed|unsupported-media-type/u);
assert.match(identity, /artifactSha256/u);
assert.match(identity, /dataManifestSha256/u);

console.log("static routing, private Lambda origin, payload hash, and bounded-client audit passed");
