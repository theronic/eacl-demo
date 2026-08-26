import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(
  new URL("../infra/foundation/template.yaml", import.meta.url),
  "utf8"
);

function resourceBlock(start, end) {
  const expression = new RegExp(`^  ${start}:([\\s\\S]*?)(?=^  ${end}:)`, "mu");
  const match = template.match(expression);
  assert.ok(match, `${start} resource block is missing`);
  return match[0];
}

const artifactBucket = resourceBlock("ArtifactBucket", "RuntimeStateBucket");
const runtimeStateBucket = resourceBlock("RuntimeStateBucket", "StaticBucket");
const staticBucket = resourceBlock("StaticBucket", "StaticOriginAccessControl");
const staticOac = template.match(/^  StaticOriginAccessControl:([\s\S]*?)(?=^Outputs:)/mu)?.[0];

test("static storage is private, versioned, retained, and SSE-S3 encrypted", () => {
  assert.ok(staticOac, "static origin access control is missing");
  for (const marker of [
    "DeletionPolicy: Retain",
    "UpdateReplacePolicy: Retain",
    "SSEAlgorithm: AES256",
    "BlockPublicAcls: true",
    "BlockPublicPolicy: true",
    "IgnorePublicAcls: true",
    "RestrictPublicBuckets: true",
    "ObjectOwnership: BucketOwnerEnforced",
    "VersioningConfiguration:\n        Status: Enabled",
    "Value: static"
  ]) {
    assert.match(staticBucket, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(staticBucket, /AbortIncompleteMultipartUpload:\s*\n\s+DaysAfterInitiation: 3/u);
  assert.match(staticBucket, /NoncurrentVersionExpiration:\s*\n\s+NoncurrentDays: 30/u);
  assert.doesNotMatch(staticBucket, /AccessControl: Public|WebsiteConfiguration|AWS::KMS|aws:kms|KMSMasterKeyID/u);
});

test("static origin access control signs every S3 request with SigV4", () => {
  assert.match(staticOac, /Type: AWS::CloudFront::OriginAccessControl/u);
  assert.match(staticOac, /OriginAccessControlOriginType: s3/u);
  assert.match(staticOac, /SigningBehavior: always/u);
  assert.match(staticOac, /SigningProtocol: sigv4/u);
  for (const output of ["StaticBucketName", "StaticBucketArn", "StaticOriginAccessControlId", "StaticBucketRegionalDomainName"]) {
    assert.match(template, new RegExp(`^  ${output}:`, "mu"));
  }
});

test("foundation storage roles remain separate and carry distinct retention policies", () => {
  assert.match(artifactBucket, /NoncurrentDays: 90/u);
  assert.match(runtimeStateBucket, /Value: runtime-state/u);
  assert.doesNotMatch(runtimeStateBucket, /NoncurrentVersionExpiration/u);
  assert.doesNotMatch(staticBucket, /Value: artifacts|Value: runtime-state/u);
  assert.equal((template.match(/^  (?:ArtifactBucket|RuntimeStateBucket|StaticBucket):$/gmu) ?? []).length, 3);
});
