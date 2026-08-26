import assert from "node:assert/strict";
import test from "node:test";

import { createStaticS3Storage } from "./lib/static-s3-storage.mjs";

const accountId = "843761893873";
const artifactSha256 = "a".repeat(64);
const fileSha256 = "b".repeat(64);
const checksum = Buffer.from(fileSha256, "hex").toString("base64");

test("static S3 adapter proves the exact low-cost private foundation and uses no destructive operation", async () => {
  const fake = fakeAws();
  const storage = createStaticS3Storage({
    accountId,
    region: "us-east-1",
    bucket: "eacl-demo-static-test",
    distributionId: "E1234567890ABC",
    origin: "https://demo.eacl.dev/",
    artifactSha256,
    runAws: fake.run
  });
  await storage.assertFoundation();
  assert.equal(await storage.currentVersion("index.html"), "old-index");
  const item = {
    key: "index.html",
    source: "/tmp/index.html",
    bytes: 12,
    sha256: fileSha256,
    contentType: "text/html; charset=utf-8",
    cacheControl: "no-cache,max-age=0,must-revalidate"
  };
  assert.equal(await storage.putVersioned(item), "new-index");
  assert.equal(await storage.restoreVersion("index.html", "old-index"), "rollback-index");
  await storage.invalidate(["/index.html", "/datascript/index.html", "/index.html"]);
  const joined = fake.calls.flat().join(" ");
  assert.doesNotMatch(joined, /\b(?:delete-object|sync|rm|kms:)\b/iu);
  assert.match(joined, /--server-side-encryption AES256/u);
  assert.match(joined, /--copy-source-if-match/u);
  assert.equal(fake.calls.filter((args) => args[0] === "cloudfront" && args[1] === "create-invalidation").length, 1);
});

test("append-only static upload accepts an existing object only when every stored identity field matches", async () => {
  const fake = fakeAws();
  fake.current.set("assets/app-deadbeef.js", head({ key: "assets/app-deadbeef.js", version: "existing", contentType: "text/javascript; charset=utf-8", cacheControl: "public,max-age=31536000,immutable" }));
  const storage = createStaticS3Storage({ accountId, region: "us-east-1", bucket: "eacl-demo-static-test", distributionId: "E1234567890ABC", origin: "https://demo.eacl.dev/", artifactSha256, runAws: fake.run });
  const item = { key: "assets/app-deadbeef.js", source: "/tmp/app.js", bytes: 12, sha256: fileSha256, contentType: "text/javascript; charset=utf-8", cacheControl: "public,max-age=31536000,immutable" };
  assert.equal(await storage.putImmutable(item), "existing");
  fake.current.get(item.key).ChecksumSHA256 = "wrong";
  await assert.rejects(() => storage.putImmutable(item), /identity mismatch/u);
});

function fakeAws() {
  const calls = [];
  const current = new Map([["index.html", head({ key: "index.html", version: "old-index", contentType: "text/html; charset=utf-8", cacheControl: "no-cache,max-age=0,must-revalidate" })]]);
  const historical = new Map([["index.html:old-index", structuredClone(current.get("index.html"))]]);
  const run = (args) => {
    calls.push(args);
    const operation = `${args[0]} ${args[1]}`;
    if (operation === "sts get-caller-identity") return ok({ Account: accountId, Arn: `arn:aws:sts::${accountId}:assumed-role/static/run` });
    if (operation === "s3api get-bucket-versioning") return ok({ Status: "Enabled" });
    if (operation === "s3api get-public-access-block") return ok({ PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } });
    if (operation === "s3api get-bucket-ownership-controls") return ok({ OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] } });
    if (operation === "s3api get-bucket-encryption") return ok({ ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] } });
    if (operation === "s3api get-bucket-tagging") return ok({ TagSet: [{ Key: "Project", Value: "eacl-demo" }, { Key: "Component", Value: "static" }] });
    if (operation === "cloudfront get-distribution") return ok({ Distribution: { Id: "E1234567890ABC", Status: "Deployed", DomainName: "d111.cloudfront.net", DistributionConfig: { Enabled: true, Aliases: { Items: ["demo.eacl.dev"] }, Origins: { Items: [{ Id: "static", DomainName: "eacl-demo-static-test.s3.us-east-1.amazonaws.com", OriginAccessControlId: "OAC123" }] }, DefaultCacheBehavior: { TargetOriginId: "static", ViewerProtocolPolicy: "redirect-to-https" } } } });
    if (operation === "s3api head-object") {
      const key = value(args, "--key");
      const version = value(args, "--version-id", false);
      const found = version ? historical.get(`${key}:${version}`) : current.get(key);
      return found ? ok(found) : failed();
    }
    if (operation === "s3api put-object") {
      const key = value(args, "--key");
      if (args.includes("--if-none-match") && current.has(key)) return failed();
      const created = head({ key, version: "new-index", contentType: value(args, "--content-type"), cacheControl: value(args, "--cache-control") });
      current.set(key, created);
      return ok({ VersionId: created.VersionId, ServerSideEncryption: "AES256" });
    }
    if (operation === "s3api copy-object") {
      const key = value(args, "--key");
      const source = historical.get(`${key}:old-index`);
      current.set(key, { ...structuredClone(source), VersionId: "rollback-index" });
      return ok({ VersionId: "rollback-index", ServerSideEncryption: "AES256", CopyObjectResult: { ETag: source.ETag } });
    }
    if (operation === "cloudfront create-invalidation") return ok({ Invalidation: { Id: "I123456789" } });
    if (operation === "cloudfront wait") return { ok: true, stdout: "", stderr: "" };
    return failed();
  };
  return { calls, current, run };
}

function head({ key, version, contentType, cacheControl }) {
  return {
    VersionId: version,
    ContentLength: 12,
    ChecksumSHA256: checksum,
    ContentType: contentType,
    CacheControl: cacheControl,
    ETag: `\"${key.length}\"`,
    ServerSideEncryption: "AES256",
    Metadata: { "eacl-demo-sha256": fileSha256, "eacl-demo-artifact-sha256": artifactSha256 }
  };
}

function value(args, flag, required = true) {
  const index = args.indexOf(flag);
  if (index < 0) {
    if (required) throw new Error(`missing fake AWS flag: ${flag}`);
    return null;
  }
  return args[index + 1];
}

function ok(value) {
  return { ok: true, stdout: JSON.stringify(value), stderr: "" };
}

function failed() {
  return { ok: false, stdout: "", stderr: "redacted" };
}
