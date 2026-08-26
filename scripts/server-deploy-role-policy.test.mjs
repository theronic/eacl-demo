import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../infra/deployment/server-profile-deploy-role.yaml", import.meta.url), "utf8");

test("server deployment role is inactive by default and binds every exact ordinary profile subject", () => {
  assert.match(source, /Activation:\s*\n\s+Type: String\s*\n\s+Default: disabled\s*\n\s+AllowedValues: \[disabled, enabled\]/u);
  assert.match(source, /ServerDeploymentEnabled: !Equals \[!Ref Activation, enabled\][\s\S]*ServerDeployRole:\s*\n\s+Type: AWS::IAM::Role\s*\n\s+Condition: ServerDeploymentEnabled/u);
  for (const profile of ["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory"]) {
    assert.ok(source.includes(`environment:demo-production-${profile}:event_name:push:runner_environment:github-hosted`));
  }
  for (const claim of [
    "aud: sts.amazonaws.com", "ref: refs/heads/demos", "repository: theronic/eacl-demo",
    "repository_id: \"1345904214\"", "repository_owner_id: \"1011676\"", "workflow: Deploy EACL demos"
  ]) assert.ok(source.includes(`token.actions.githubusercontent.com:${claim}`));
  assert.doesNotMatch(source, /StringLike|[?]/u);
});

test("server deployment role can mutate only one artifact prefix, status key, function, aliases, and observe two distributions", () => {
  for (const action of [
    "s3:GetEncryptionConfiguration", "s3:GetBucketOwnershipControls", "s3:GetBucketPublicAccessBlock", "s3:GetBucketTagging", "s3:GetBucketVersioning",
    "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject",
    "lambda:GetAlias", "lambda:GetFunctionConfiguration", "lambda:GetFunctionUrlConfig", "lambda:ListTags",
    "lambda:PublishVersion", "lambda:UpdateAlias", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
    "cloudfront:GetDistribution"
  ]) assert.ok(source.includes(`- ${action}`));
  assert.equal(source.includes("s3:GetBucketEncryption"), false);
  for (const resource of [
    "${ArtifactBucketArn}/artifacts/${ProfileId}/*",
    "${StaticBucketArn}/registry/profiles/${ProfileId}.json",
    "${FunctionArn}:*"
  ]) assert.ok(source.includes(resource));
  assert.doesNotMatch(source, /-\s+(?:s3:Delete|s3:List|lambda:CreateFunction|lambda:Delete|lambda:AddPermission|cloudfront:CreateInvalidation|kms:|dynamodb:|ec2:|iam:PassRole)|Resource:\s*["']?\*["']?/iu);
});
