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
    "aud: sts.amazonaws.com", "ref: refs/heads/production", "repository: theronic/eacl-demo",
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
  assert.equal((source.match(/Action: lambda:ListVersionsByFunction$/gmu) ?? []).length, 2);
  assert.match(source, /ListExactLambdaVersions[\s\S]*function:\$\{FunctionName\}"/u);
  assert.match(source, /ListExactComparisonLambdaVersions[\s\S]*function:\$\{ComparisonFunctionName\}"/u);
  assert.doesNotMatch(source, /Action: lambda:ListVersionsByFunction[\s\S]{0,180}function:\$\{(?:FunctionName|ComparisonFunctionName)\}[*:]/u);
  assert.equal((source.match(/Action: lambda:DeleteFunction$/gmu) ?? []).length, 2);
  assert.match(source, /DeleteExactStaleLambdaVersions[\s\S]*function:\$\{FunctionName\}:\*"/u);
  assert.match(source, /DeleteExactStaleComparisonLambdaVersions[\s\S]*function:\$\{ComparisonFunctionName\}:\*"/u);
  assert.doesNotMatch(source, /Action: lambda:DeleteFunction[\s\S]{0,180}function:\$\{(?:FunctionName|ComparisonFunctionName)\}"/u);
  for (const resource of [
    "${ArtifactBucketName}/artifacts/${ProfileId}/*",
    "${StaticBucketName}/registry/profiles/${ProfileId}.json",
    "function:${FunctionName}*",
    "distribution/${DistributionId}"
  ]) assert.ok(source.includes(resource));
  assert.doesNotMatch(source, /-\s+(?:s3:Delete|s3:List|lambda:CreateFunction|lambda:AddPermission|cloudfront:GetDistribution|kms:|dynamodb:|ec2:|iam:PassRole)/iu);
});

test("only the read of Run Command results is not bound to a resource, and it stays outside the exact policy", () => {
  const wholeResource = /Resource:\s*["']?\*["']?|^[ \t]*-[ \t]+["']?\*["']?[ \t]*$/imu;
  // IAM has no resource type and no condition key for this action, so the
  // statement is held to one action, the stack's Region and the two profiles
  // that send a command.
  const read = [
    "        - !If",
    "          - UsesEc2",
    "          - PolicyName: regional-command-result-read",
    "            PolicyDocument:",
    "              Version: \"2012-10-17\"",
    "              Statement:",
    "                - Sid: ReadCommandResultsInRegion",
    "                  Effect: Allow",
    "                  Action: ssm:GetCommandInvocation",
    "                  Resource: \"*\"",
    "                  Condition:",
    "                    StringEquals:",
    "                      aws:RequestedRegion: !Ref AWS::Region",
    "          - !Ref AWS::NoValue",
    "      Tags:"
  ].join("\n");
  assert.equal(source.split(read).length, 2);
  assert.doesNotMatch(source.replace(read, ""), wholeResource);
  const exact = source.slice(source.indexOf("        - PolicyName: exact-demo-delivery\n"), source.indexOf(read));
  assert.match(exact, /^ {8}- PolicyName: exact-demo-delivery\n[\s\S]*Sid: PublishExactRuntimeArtifact[\s\S]*Sid: ReconcileExactEc2Runtime[\s\S]*Sid: InvalidateExactProfileRegistry/u);
  assert.doesNotMatch(exact, /Action: ssm:GetCommandInvocation|aws:RequestedRegion/u);
  assert.deepEqual([...new Set(source.match(/\bssm:[A-Za-z]+/gu))].sort(), ["ssm:GetCommandInvocation", "ssm:SendCommand"]);
  assert.equal((source.match(/PolicyName:/gu) ?? []).length, 2);
  assert.doesNotMatch(source, /NotAction:|NotResource:|ManagedPolicyArns:|Action:\s*["']?\*|-[ \t]+[a-z]+:\*/iu);
  // The job reads only the command it has just sent, on the instance it sent it to.
  assert.match(deploySource, /function ec2CommandInvocation\(commandId, instanceId\)[\s\S]*?"ssm", "get-command-invocation",\n\s+"--command-id", commandId, "--instance-id", instanceId, "--output", "json"\]/u);
  assert.equal((deploySource.match(/get-command-invocation/gu) ?? []).length, 1);
  assert.doesNotMatch(deploySource, /list-command-invocations|list-commands|describe-instance-information/u);
});

test("only profiles with deployed comparisons may promote their exact comparison runtimes", () => {
  assert.match(source, /IsDatomicProfile: !Equals \[!Ref ProfileId, datomic-dynamodb\]/u);
  assert.match(source, /IsDatalevinProfile: !Equals \[!Ref ProfileId, datalevin-memory\][\s\S]*UsesEc2: !Or/u);
  assert.match(source, /HasComparisonPlatform: !Not \[!Equals \[!Ref ProfileId, datalevin-memory\]\]/u);
  assert.match(source, /DeployExactComparisonLambda[\s\S]*function:\$\{ComparisonFunctionName\}\*/u);
  for (const name of ["eacl-demo-datahike-s3-large", "eacl-demo-datahike-dynamodb-large", "eacl-demo-datomic-dynamodb-large"]) {
    assert.match(source, new RegExp(name, "u"));
  }
  assert.match(source, /ReconcileExactEc2Runtime[\s\S]*Action: ssm:SendCommand[\s\S]*document\/AWS-RunShellScript[\s\S]*instance\/\$\{DatomicEc2InstanceId\}/u);
  assert.match(deploySource, /deployDatomicPlatforms[\s\S]*const comparison = deployProfile[\s\S]*datomic-dynamodb-large[\s\S]*beforePublish: async \(\) => deployDatomicEc2\(await comparison\)[\s\S]*Promise\.all/u);
  assert.match(deploySource, /deployDatahikePlatforms[\s\S]*const comparison = deployProfile[\s\S]*beforePublish: async \(\) => \{ await comparison; \}[\s\S]*Promise\.all/u);
  assert.match(deploySource, /deployDatalevinPlatforms[\s\S]*beforePublish: deployDatalevinEc2[\s\S]*https:\/\/datalevin\.demo\.eacl\.dev/u);
  assert.doesNotMatch(source, /ssm:(?:StartSession|GetParameter|PutParameter)|cloudformation:|iam:PassRole/u);
});

test("successful deployments retain only the three newest published Lambda packages", () => {
  assert.match(deploySource, /await prunePublishedVersions\(profile\.functionName\)/u);
  assert.match(deploySource, /function prunePublishedVersions\(functionName, retain = 3\)/u);
  assert.match(deploySource, /"lambda", "list-versions-by-function"/u);
  assert.match(deploySource, /stalePublishedVersions\(response\.Versions \?\? \[\], retain\)/u);
  assert.match(deploySource, /const deleteBatchSize = 5/u);
  assert.match(deploySource, /stale\.slice\(offset, offset \+ deleteBatchSize\)/u);
  assert.match(deploySource, /"lambda", "delete-function"[\s\S]*"--qualifier", version/u);
});

test("successful empty AWS JSON output represents an absent optional setting", () => {
  assert.match(deploySource, /const output = \(await aws\(\[\.\.\.args, "--output", "json"\]\)\)\.trim\(\);/u);
  assert.match(deploySource, /return output === "" \? \{\} : JSON\.parse\(output\);/u);
});


test("Datalevin deployment IAM selects its own exact EC2 instance", () => {
  assert.match(source, /- IsDatalevinProfile\n\s+- !Sub .*instance\/\$\{DatalevinEc2InstanceId\}/u);
});
