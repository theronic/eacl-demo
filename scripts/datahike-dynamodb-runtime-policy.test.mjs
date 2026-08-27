import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(
  new URL("../infra/profiles/datahike-dynamodb-runtime.yaml", import.meta.url),
  "utf8",
);
const table = await readFile(
  new URL("../infra/data/datahike-dynamodb-table.yaml", import.meta.url),
  "utf8",
);

test("Datahike DynamoDB candidate is a preinitialized 1024 MB SnapStart runtime", () => {
  assert.match(template, /Runtime: java25/u);
  assert.match(template, /Architectures:\s*\n\s*- arm64/u);
  assert.match(template, /SnapStart:\s*\n\s*ApplyOn: PublishedVersions/u);
  assert.match(template, /MemorySize:\s*\n\s*Type: Number\s*\n\s*Default: 1024\s*\n\s*AllowedValues: \[1024\]/u);
  assert.doesNotMatch(template, /ReservedConcurrentExecutions/u);
  assert.match(template, /EACL_MAXIMUM_CONCURRENCY: "1"/u);
  assert.doesNotMatch(template,
    /ProvisionedConcurrency|java17(?:\s|$)|provided\.|6144/u);
});

test("candidate bytes, store, source, and bounded retry are immutable inputs", () => {
  assert.match(template, /S3ObjectVersion: !Ref ArtifactVersion/u);
  assert.match(template,
    /AllowedPattern: "\^artifacts\/datahike-dynamodb\/\[0-9a-f\]\{40\}/u);
  assert.match(template,
    /Resource: !Sub "arn:\$\{AWS::Partition\}:dynamodb:\$\{AWS::Region\}:\$\{AWS::AccountId\}:table\/\$\{TableName\}"/u);
  assert.match(template, /EACL_DATAHIKE_STORE_ID: !Ref StoreId/u);
  assert.match(template, /EACL_DATAHIKE_TABLE: !Ref TableName/u);
  for (const [name, value] of [
    ["EACL_MAX_ATTEMPTS", "4"],
    ["EACL_BASE_DELAY_MS", "25"],
    ["EACL_MAX_DELAY_MS", "250"],
    ["EACL_ATTEMPT_TIMEOUT_MS", "3000"],
    ["EACL_CONNECT_TIMEOUT_MS", "1000"],
  ]) assert.match(template, new RegExp(`${name}: "${value}"`, "u"));
  for (const name of [
    "EACL_ARTIFACT_SHA256", "EACL_CORE_SHA", "EACL_CURSOR_KEY",
    "EACL_DEMO_SHA", "EACL_DEPLOYMENT_ID",
  ]) assert.match(template, new RegExp(`${name}:`, "u"));
  assert.match(template,
    /Handler: eacl_demo\.datahike_dynamodb\.LambdaHandler::handleRequest/u);
  assert.match(template, /Type: AWS::Lambda::Version/u);
  assert.match(template, /FunctionVersion: !GetAtt CandidateVersion\.Version/u);
});

test("runtime role exposes only exact-table reads and exact-log writes", () => {
  assert.deepEqual(
    [...template.matchAll(/- (dynamodb:[A-Za-z]+)/gu)]
      .map((match) => match[1]).sort(),
    ["dynamodb:BatchGetItem", "dynamodb:DescribeTable", "dynamodb:GetItem"],
  );
  assert.match(template,
    /Resource: !Sub "arn:\$\{AWS::Partition\}:dynamodb:\$\{AWS::Region\}:\$\{AWS::AccountId\}:table\/\$\{TableName\}"/u);
  assert.deepEqual(
    [...template.matchAll(/- (logs:[A-Za-z]+)/gu)]
      .map((match) => match[1]).sort(),
    ["logs:CreateLogStream", "logs:PutLogEvents"],
  );
  assert.match(template,
    /Resource: !Sub "arn:\$\{AWS::Partition\}:logs:\$\{AWS::Region\}:\$\{AWS::AccountId\}:log-group:\/aws\/lambda\/\$\{FunctionName\}:\*"/u);
  assert.doesNotMatch(template,
    /dynamodb:(?:Put|Update|Delete|Create|Restore|Export|Import|Transact|BatchWrite)|Resource:\s*["']?\*/u);
  assert.doesNotMatch(table, /ServingRole|lambda\.amazonaws\.com/u);
  assert.match(table, /SeedRole:/u);
});

test("candidate transport and cost surface are bounded without custom KMS", () => {
  assert.match(template, /Type: AWS::Lambda::Url[\s\S]*?AuthType: NONE/u);
  assert.match(template, /AllowOrigins: \[https:\/\/demo\.eacl\.dev\]/u);
  assert.match(template, /FunctionUrlAuthType: NONE/u);
  assert.match(template, /InvokedViaFunctionUrl: true/u);
  assert.match(template, /Qualifier: !Ref CandidateAliasName/u);
  assert.match(template, /EphemeralStorage:\s*\n\s*Size: 512/u);
  assert.match(template, /RetentionInDays: 14/u);
  assert.match(template, /DeletionPolicy: Delete/u);
  assert.match(template, /TracingConfig:\s*\n\s*Mode: PassThrough/u);
  assert.doesNotMatch(template, /AWS::KMS|kms:|KmsKeyArn|AuthType: AWS_IAM/iu);
});
