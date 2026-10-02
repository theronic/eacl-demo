import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(
  new URL("../infra/profiles/datomic-dynamodb-serving-role.yaml", import.meta.url),
  "utf8"
);
const deploySource = await readFile(new URL("./deploy-live-demo.mjs", import.meta.url), "utf8");
const documentedReads = [
  "dynamodb:BatchGetItem",
  "dynamodb:GetItem",
  "dynamodb:Query",
  "dynamodb:Scan"
];
const storageStatement = /Sid: ExactGenerationReads[\s\S]*?Resource: !Ref TableArn/u.exec(template)?.[0];
assert.ok(storageStatement, "exact Datomic storage statement is missing");
const actualActions = [...storageStatement.matchAll(/- (dynamodb:[A-Za-z]+)/gu)].map((match) => match[1]).sort();

// The primary function and its comparison function both run under this role,
// so the role names each function's log group through its own parameter.
const logGroupParameters = ["FunctionLogGroupArn", "ComparisonFunctionLogGroupArn"];
const logStatement = /Sid: ExactLogGroupWrites[\s\S]*?(?=\n {6}Tags:)/u.exec(template)?.[0];
assert.ok(logStatement, "exact log delivery statement is missing");
const logResources = (/Resource:\n((?: +- .+(?:\n|$))+)$/u.exec(logStatement)?.[1] ?? "")
  .split("\n").filter((line) => line !== "").map((line) => line.trim().replace(/^- /u, ""));

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

test("non-storage permissions are confined to the two pre-created log groups of the functions sharing the role", () => {
  assert.deepEqual(
    [...template.matchAll(/- (logs:[A-Za-z]+)/gu)].map((match) => match[1]).sort(),
    ["logs:CreateLogStream", "logs:PutLogEvents"]
  );
  assert.deepEqual(logResources, logGroupParameters.map((name) => `!Sub "\${${name}}:*"`));
  const resources = template.slice(template.indexOf("\nResources:"));
  assert.deepEqual(
    (resources.match(/^.*\*.*$/gmu) ?? []).map((line) => line.trim()),
    logResources.map((resource) => `- ${resource}`),
    "each group's stream suffix must be the role's only wildcard"
  );
  assert.doesNotMatch(template, /logs:CreateLogGroup/u);
});

test("bound log delivery reaches every deployed Datomic function's log group and no other function's", () => {
  const deployedFunctions = [...deploySource.matchAll(
    /functionName: "(eacl-demo-datomic-dynamodb-[a-z0-9-]+)"/gu
  )].map((match) => match[1]);
  assert.deepEqual(deployedFunctions,
    ["eacl-demo-datomic-dynamodb-live", "eacl-demo-datomic-dynamodb-large"],
    "every Datomic function deployed under this role needs its own log-group parameter");

  const groupArn = (functionName) =>
    `arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/${functionName}`;
  const bound = Object.fromEntries(logGroupParameters.map(
    (name, index) => [name, groupArn(deployedFunctions[index])]
  ));
  for (const name of logGroupParameters) {
    const pattern = new RegExp(
      `^  ${name}:\\n    Type: String\\n    AllowedPattern: "([^"]+)"`, "mu"
    ).exec(template)?.[1];
    assert.ok(pattern, `${name} pattern is missing`);
    const validator = new RegExp(pattern, "u");
    assert.equal(validator.test(bound[name]), true, `${name} rejects its own log group`);
    for (const rejected of [
      groupArn("eacl-demo-datahike-dynamodb-large"),
      groupArn("eacl-demo-datomic-dynamodb-*"),
      groupArn("*"),
      `${bound[name]}:*`
    ]) assert.equal(validator.test(rejected), false, `${name} admits ${rejected}`);
  }

  // IAM resource matching: `*` spans any characters and `?` exactly one.
  const matcher = (resource) => new RegExp(`^${resource
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*/gu, ".*")
    .replace(/\?/gu, ".")}$`, "u");
  const granted = logResources.map((resource) => matcher(resource
    .replace(/^!Sub "(.+)"$/u, "$1")
    .replace(/\$\{([A-Za-z]+)\}/gu, (_, name) => bound[name])));
  const decision = (resource) => granted.some((pattern) => pattern.test(resource))
    ? "allowed"
    : "implicitDeny";
  const stream = (functionName) =>
    `${groupArn(functionName)}:log-stream:2026/10/02/[1]0123456789abcdef0123456789abcdef`;

  for (const functionName of deployedFunctions) {
    assert.equal(decision(stream(functionName)), "allowed", `${functionName} cannot deliver logs`);
  }
  for (const functionName of [
    "eacl-demo-datomic-dynamodb-live-2",
    "eacl-demo-datomic-dynamodb-larger",
    "eacl-demo-datahike-dynamodb-large",
    "eacl-demo-datahike-s3-large",
    "eacl-demo-datalevin-memory-live"
  ]) assert.equal(decision(stream(functionName)), "implicitDeny", `${functionName} log group is writable`);
});
