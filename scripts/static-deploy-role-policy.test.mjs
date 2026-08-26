import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../infra/deployment/static-deploy-role.yaml", import.meta.url), "utf8");

test("static deployment trust is the exact inactive-until-eligible ordinary authority", () => {
  for (const claim of [
    "aud: sts.amazonaws.com",
    "environment: demo-production-static",
    "ref: refs/heads/demos",
    "repository: theronic/eacl-demo",
    "repository_id: \"1345904214\"",
    "repository_owner_id: \"1011676\"",
    "workflow: Deploy EACL demos"
  ]) assert.ok(source.includes(`token.actions.githubusercontent.com:${claim}`));
  assert.match(source, /token\.actions\.githubusercontent\.com:sub: repo:theronic@1011676\/eacl-demo@1345904214:ref:refs\/heads\/demos:workflow_ref:theronic\/eacl-demo\/\.github\/workflows\/deploy-demos\.yml@refs\/heads\/demos:environment:demo-production-static:event_name:push:runner_environment:github-hosted/u);
  assert.doesNotMatch(source, /StringLike|[?]/u);
  assert.match(source, /Activation:\s*\n\s+Type: String\s*\n\s+Default: disabled\s*\n\s+AllowedValues: \[disabled, enabled\]/u);
  assert.match(source, /StaticDeploymentEnabled: !Equals \[!Ref Activation, enabled\][\s\S]*StaticDeployRole:\s*\n\s+Type: AWS::IAM::Role\s*\n\s+Condition: StaticDeploymentEnabled/u);
});

test("static deployment role can publish only its closed bucket keys and distribution", () => {
  for (const action of [
    "s3:GetEncryptionConfiguration",
    "s3:GetBucketOwnershipControls",
    "s3:GetBucketPublicAccessBlock",
    "s3:GetBucketTagging",
    "s3:GetBucketVersioning",
    "s3:GetObject",
    "s3:GetObjectVersion",
    "s3:PutObject",
    "cloudfront:CreateInvalidation",
    "cloudfront:GetDistribution",
    "cloudfront:GetInvalidation"
  ]) assert.ok(source.includes(`- ${action}`));
  assert.equal(source.includes("s3:GetBucketEncryption"), false);
  for (const resource of [
    "${StaticBucketArn}/index.html",
    "${StaticBucketArn}/datascript/index.html",
    "${StaticBucketArn}/site-manifest.json",
    "${StaticBucketArn}/registry/static.json",
    "${StaticBucketArn}/assets/*",
    "${StaticBucketArn}/datascript/assets/*"
  ]) assert.ok(source.includes(resource));
  assert.doesNotMatch(source, /registry\/profiles|s3:Delete|s3:List|kms:|dynamodb:|ec2:|lambda:|iam:PassRole|Resource:\s*["']?\*["']?/iu);
  assert.match(source, /Resource: !Ref DistributionArn/u);
});
