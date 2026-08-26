import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(
  new URL("../infra/profiles/datomic-dynamodb-serving-role.yaml", import.meta.url),
  "utf8"
);
const documentedReads = [
  "dynamodb:BatchGetItem",
  "dynamodb:GetItem",
  "dynamodb:Query",
  "dynamodb:Scan"
];
const storageStatement = /Sid: ExactGenerationReads[\s\S]*?Resource: !Ref TableArn/u.exec(template)?.[0];
assert.ok(storageStatement, "exact Datomic storage statement is missing");
const actualActions = [...storageStatement.matchAll(/- (dynamodb:[A-Za-z]+)/gu)].map((match) => match[1]).sort();

test("Datomic serving role contains exactly the four documented DynamoDB reads", () => {
  assert.deepEqual(actualActions, [...documentedReads].sort());
  assert.equal((template.match(/Resource: !Ref TableArn/gu) ?? []).length, 1);
  assert.doesNotMatch(template, /Resource:\s*["']?\*|\/index\/\*/u);
  assert.doesNotMatch(template, /kms:|AWS::KMS|aws:kms/iu);
});

test("exact policy simulation denies writes, administration, and other tables", () => {
  const tableArn = "arn:aws:dynamodb:us-east-1:123456789012:table/eacl-demo-datomic-blue";
  const otherTableArn = "arn:aws:dynamodb:us-east-1:123456789012:table/eacl-demo-datahike-blue";
  const decision = (action, resource) => documentedReads.includes(action) && resource === tableArn
    ? "allowed"
    : "implicitDeny";

  for (const action of documentedReads) assert.equal(decision(action, tableArn), "allowed");
  for (const action of [
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:BatchWriteItem",
    "dynamodb:CreateTable",
    "dynamodb:UpdateTable",
    "dynamodb:DeleteTable",
    "dynamodb:RestoreTableFromBackup",
    "dynamodb:ExportTableToPointInTime"
  ]) assert.equal(decision(action, tableArn), "implicitDeny");
  for (const action of documentedReads) assert.equal(decision(action, otherTableArn), "implicitDeny");
});

test("non-storage permissions are confined to one pre-created log group", () => {
  assert.deepEqual(
    [...template.matchAll(/- (logs:[A-Za-z]+)/gu)].map((match) => match[1]).sort(),
    ["logs:CreateLogStream", "logs:PutLogEvents"]
  );
  assert.match(template, /Resource: !Sub "\$\{FunctionLogGroupArn\}:\*"/u);
  assert.doesNotMatch(template, /logs:CreateLogGroup/u);
});
