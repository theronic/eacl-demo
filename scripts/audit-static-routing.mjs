import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [template, preview, profiles, transport, functionUrl, identity] = await Promise.all([
  readFile(new URL("../infra/static/template.yaml", import.meta.url), "utf8"),
  readFile(new URL("./serve-static-site.mjs", import.meta.url), "utf8"),
  readFile(new URL("../packages/contracts/profiles.v1.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../packages/explorer-state/src/http-transport.mjs", import.meta.url), "utf8"),
  readFile(new URL("../packages/contracts/src/eacl_demo/contracts/function_url.clj", import.meta.url), "utf8"),
  readFile(new URL("../packages/contracts/src/descriptor-handshake.mjs", import.meta.url), "utf8"),
]);

assert.equal((template.match(/PathPattern:/gu) ?? []).length, 1);
assert.match(template, /PathPattern: datascript\/\*/u);
assert.equal((template.match(/TargetOriginId: static/gu) ?? []).length, 2);
assert.doesNotMatch(template, /api\/v1\/|LambdaOrigin|ApiCachePolicy|ApiOriginRequestPolicy|AWS::Lambda::Permission|InvokeFunctionUrl|x-amz-content-sha256/u);
assert.match(template, /worker-src 'none'/u);
assert.doesNotMatch(template, /unsafe-eval/u);
assert.match(template, /Action: s3:GetObject/u);
assert.match(template, /AWS:SourceArn:/u);

const enabledOrigins = profiles.profiles.map(({ apiOrigin }) => apiOrigin).filter(Boolean);
assert.equal(enabledOrigins.length, 4);
for (const apiOrigin of enabledOrigins) {
  assert.match(apiOrigin, /^https:\/\/[a-z0-9]+\.lambda-url\.us-east-1\.on\.aws$/u);
  assert.ok(template.includes(apiOrigin), `${apiOrigin} is absent from connect-src`);
  assert.ok(preview.includes(apiOrigin), `${apiOrigin} is absent from the local preview connect-src`);
}
assert.match(transport, /const path = `\/\$\{operation\}`;[\s\S]*new URL\(path, apiOrigin\)/u);
assert.doesNotMatch(transport, /api\/v1|\$\{profile\.id\}|\$\{profile\.backend\}/u);
assert.match(transport, /requires a direct HTTPS Lambda Function URL/u);
assert.doesNotMatch(transport, /x-amz-content-sha256|jsonPayloadSha256/u);
assert.match(functionUrl, /maximum-request-body-bytes 65536/u);
assert.match(functionUrl, /maximum-response-body-bytes 1048576/u);
assert.match(functionUrl, /not-empty \(:rawQueryString event\)/u);
assert.match(functionUrl, /defn event-request-id/u);
assert.match(functionUrl, /= "x-eacl-request-id"/u);
assert.match(identity, /artifactSha256/u);
assert.match(identity, /dataManifestSha256/u);

console.log("static-only CloudFront, direct Function URL transport, CORS boundary, and bounded-client audit passed");
