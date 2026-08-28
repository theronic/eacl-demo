import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(
  new URL("../infra/profiles/datahike-s3-runtime.yaml", import.meta.url),
  "utf8",
);

test("Datahike S3 offers preinitialized 1 vCPU and 4 GiB SnapStart runtimes", () => {
  assert.match(template, /Runtime: java25/u);
  assert.match(template, /Architectures:\s*\n\s*- arm64/u);
  assert.match(template, /SnapStart:\s*\n\s*ApplyOn: PublishedVersions/u);
  assert.match(template, /MemorySize:\s*\n\s*Type: Number\s*\n\s*Default: 1769\s*\n\s*AllowedValues: \[1769, 4096\]/u);
  assert.doesNotMatch(template, /ReservedConcurrentExecutions/u);
  assert.match(template, /EACL_MAXIMUM_CONCURRENCY: "1"/u);
  assert.doesNotMatch(template,
    /ProvisionedConcurrency|java17(?:\s|$)|provided\.|6144/u);
});

test("candidate bytes, existing store, and source are immutable inputs", () => {
  assert.match(template, /S3ObjectVersion: !Ref ArtifactVersion/u);
  assert.match(template,
    /AllowedPattern: "\^artifacts\/datahike-s3\/\[0-9a-f\]\{40\}/u);
  assert.match(template,
    /DataBucketArn:[\s\S]*?AllowedPattern: "\^arn:\[a-z0-9-\]\+:s3:::/u);
  assert.doesNotMatch(template,
    /Rules:[\s\S]*?Fn::(?:Split|Select)/u,
    "CloudFormation Rules support only the documented rule functions");
  assert.match(template, /EACL_DATAHIKE_BUCKET: !Ref DataBucket/u);
  assert.match(template, /EACL_DATAHIKE_STORE_ID: !Ref StoreId/u);
  for (const name of [
    "EACL_ARTIFACT_SHA256", "EACL_CORE_SHA", "EACL_CURSOR_KEY",
    "EACL_DEMO_SHA", "EACL_DEPLOYMENT_ID",
  ]) assert.match(template, new RegExp(`${name}:`, "u"));
  assert.match(template,
    /Handler: eacl_demo\.datahike_s3\.LambdaHandler::handleRequest/u);
  assert.match(template, /Type: AWS::Lambda::Version/u);
  assert.match(template, /FunctionVersion: !GetAtt CandidateVersion\.Version/u);
});

test("runtime role exposes only exact-store-prefix reads and exact-log writes", () => {
  assert.deepEqual(
    [...template.matchAll(/- (s3:[A-Za-z]+)/gu)]
      .map((match) => match[1]).sort(),
    ["s3:GetObject"],
  );
  assert.match(template,
    /Resource: !Sub "\$\{DataBucketArn\}\/\$\{StoreId\}_\*"/u);
  assert.deepEqual(
    [...template.matchAll(/- (logs:[A-Za-z]+)/gu)]
      .map((match) => match[1]).sort(),
    ["logs:CreateLogStream", "logs:PutLogEvents"],
  );
  assert.match(template,
    /Resource: !Sub "arn:\$\{AWS::Partition\}:logs:\$\{AWS::Region\}:\$\{AWS::AccountId\}:log-group:\/aws\/lambda\/\$\{FunctionName\}:\*"/u);
  assert.doesNotMatch(template,
    /s3:(?:Put|Delete|Create|Copy|Restore|Replicate|Abort|List)|Resource:\s*["']?\*/u);
});

test("candidate transport and cost surface are bounded without custom KMS", () => {
  assert.match(template, /Type: AWS::Lambda::Url[\s\S]*?AuthType: NONE/u);
  assert.match(template, /Qualifier: !Ref CandidateAliasName/u);
  assert.match(template, /AllowOrigins: \[https:\/\/demo\.eacl\.dev\]/u);
  assert.match(template, /AllowHeaders: \[accept, content-type, x-eacl-request-id\]/u);
  assert.match(template, /FunctionUrlAuthType: NONE/u);
  assert.match(template, /InvokedViaFunctionUrl: true/u);
  assert.match(template, /EphemeralStorage:\s*\n\s*Size: 512/u);
  assert.match(template, /RetentionInDays: 14/u);
  assert.match(template, /DeletionPolicy: Delete/u);
  assert.match(template, /TracingConfig:\s*\n\s*Mode: PassThrough/u);
  assert.doesNotMatch(template, /AWS::KMS|kms:|KmsKeyArn|AuthType: AWS_IAM/iu);
});
