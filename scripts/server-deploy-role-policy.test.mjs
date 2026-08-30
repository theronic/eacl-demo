import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../infra/deployment/server-profile-deploy-role.yaml", import.meta.url), "utf8");
const deploySource = await readFile(new URL("./deploy-live-demo.mjs", import.meta.url), "utf8");

test("server deployment role is inactive by default and binds every exact ordinary profile subject", () => {
  assert.match(source, /Activation:\s*\n\s+Type: String\s*\n\s+Default: disabled\s*\n\s+AllowedValues: \[disabled, enabled\]/u);
  assert.match(source, /ServerDeploymentEnabled: !Equals \[!Ref Activation, enabled\][\s\S]*ServerDeployRole:\s*\n\s+Type: AWS::IAM::Role\s*\n\s+Condition: ServerDeploymentEnabled/u);
  for (const profile of ["datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory"]) {
    assert.ok(source.includes(`environment:demo-production-${profile}:event_name:push:runner_environment:github-hosted`));
  }
  for (const claim of [
    "aud: sts.amazonaws.com", "ref: refs/heads/main", "repository: theronic/eacl-demo",
    "repository_id: \"1345904214\"", "repository_owner_id: \"1011676\"", "workflow: Deploy EACL demos"
  ]) assert.ok(source.includes(`token.actions.githubusercontent.com:${claim}`));
  assert.doesNotMatch(source, /StringLike|[?]/u);
});

test("server deployment role can mutate only one artifact prefix, status key, function, aliases, and invalidation", () => {
  for (const action of [
    "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject",
    "lambda:GetAlias", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetFunctionConcurrency", "lambda:InvokeFunction",
    "lambda:DeleteFunctionConcurrency", "lambda:PublishVersion", "lambda:UpdateAlias", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
    "cloudfront:CreateInvalidation"
  ]) assert.ok(source.includes(`- ${action}`));
  for (const resource of [
    "${ArtifactBucketName}/artifacts/${ProfileId}/*",
    "${StaticBucketName}/registry/profiles/${ProfileId}.json",
    "function:${FunctionName}*",
    "distribution/${DistributionId}"
  ]) assert.ok(source.includes(resource));
  assert.doesNotMatch(source, /-\s+(?:s3:Delete|s3:List|lambda:CreateFunction|lambda:DeleteFunction(?:\s|$)|lambda:AddPermission|cloudfront:GetDistribution|kms:|dynamodb:|ec2:|iam:PassRole)|Resource:\s*["']?\*["']?/iu);
});

test("only profiles with deployed comparisons may promote their exact comparison runtimes", () => {
  assert.match(source, /IsDatomicProfile: !Equals \[!Ref ProfileId, datomic-dynamodb\]/u);
  assert.match(source, /IsDatalevinProfile: !Equals \[!Ref ProfileId, datalevin-memory\][\s\S]*UsesSharedEc2: !Or/u);
  assert.match(source, /HasComparisonPlatform: !Not \[!Equals \[!Ref ProfileId, datalevin-memory\]\]/u);
  assert.match(source, /DeployExactComparisonLambda[\s\S]*function:\$\{ComparisonFunctionName\}\*/u);
  for (const name of ["eacl-demo-datahike-s3-large", "eacl-demo-datahike-dynamodb-large", "eacl-demo-datomic-dynamodb-large"]) {
    assert.match(source, new RegExp(name, "u"));
  }
  assert.match(source, /ReconcileExactSharedEc2Runtime[\s\S]*Action: ssm:SendCommand[\s\S]*document\/AWS-RunShellScript[\s\S]*instance\/\$\{DatomicEc2InstanceId\}/u);
  assert.match(deploySource, /deployDatomicPlatforms[\s\S]*datomic-dynamodb-large[\s\S]*deployDatomicEc2[\s\S]*deployProfile\("datomic-dynamodb", profiles\["datomic-dynamodb"\]/u);
  assert.match(deploySource, /deployDatalevinPlatforms[\s\S]*beforePublish: deployDatalevinEc2[\s\S]*https:\/\/datalevin\.demo\.eacl\.dev/u);
  assert.doesNotMatch(source, /ssm:(?:StartSession|GetParameter|PutParameter)|cloudformation:|iam:PassRole/u);
});

test("successful empty AWS JSON output represents an absent optional setting", () => {
  assert.match(deploySource, /const output = aws\(\[\.\.\.args, "--output", "json"\]\)\.trim\(\);/u);
  assert.match(deploySource, /return output === "" \? \{\} : JSON\.parse\(output\);/u);
});
