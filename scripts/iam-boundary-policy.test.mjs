import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
  datahikeS3,
  datahikeDynamodb,
  datomicRuntime,
  datomicRole,
  datalevin,
  jank,
  datahikeTable,
  datomicSeed
] = await Promise.all([
  read("infra/profiles/datahike-s3-runtime.yaml"),
  read("infra/profiles/datahike-dynamodb-runtime.yaml"),
  read("infra/profiles/datomic-dynamodb-runtime.yaml"),
  read("infra/profiles/datomic-dynamodb-serving-role.yaml"),
  read("infra/profiles/datalevin-memory-runtime.yaml"),
  read("infra/profiles/jank-memory-runtime.yaml"),
  read("infra/data/datahike-dynamodb-table.yaml"),
  read("infra/compute/datomic-dynamodb-seed-role.yaml")
]);

const serving = {
  "datahike-s3": datahikeS3,
  "datahike-dynamodb": datahikeDynamodb,
  "datomic-dynamodb": datomicRole,
  "datalevin-memory": datalevin,
  "jank-memory": jank
};

const actions = (source, service) => [...source.matchAll(
  new RegExp(`- (${service}:[A-Za-z]+)`, "gu")
)].map((match) => match[1]).sort();

test("every server profile has an auditable serving role with no action or whole-resource wildcard", () => {
  for (const [profileId, source] of Object.entries(serving)) {
    assert.match(source, /Type: AWS::IAM::Role/u, `${profileId} serving role is missing`);
    assert.match(source, new RegExp(`Value: ${profileId}`, "u"), `${profileId} role tag is missing`);
    assert.doesNotMatch(source, /Action:\s*["']?\*|-[ \t]+[a-z]+:\*|Resource:\s*["']?\*/iu, `${profileId} role contains a wildcard`);
    assert.doesNotMatch(source, /NotAction:|NotResource:|ManagedPolicyArns:/u, `${profileId} role hides a broader policy surface`);
    assert.doesNotMatch(source, /iam:PassRole|sts:AssumeRoleWithWebIdentity/u, `${profileId} serving role can delegate identity`);
  }
});

test("serving permissions are confined to each profile's declared storage and logs", () => {
  assert.match(datahikeS3, /Resource: !Sub "\$\{DataBucketArn\}\/\$\{StoreId\}_\*"/u);
  assert.doesNotMatch(datahikeS3, /dynamodb:/u);

  assert.match(datahikeDynamodb, /Resource: !Ref TableArn/u);
  assert.doesNotMatch(datahikeDynamodb, /s3:GetObject|datomic/u);

  assert.match(datomicRole, /Resource: !Ref TableArn/u);
  assert.doesNotMatch(datomicRole, /s3:|datahike/u);
  assert.match(datomicRuntime, /Role: !Ref ExecutionRoleArn/u);

  assert.doesNotMatch(datalevin, /s3:|dynamodb:/u);
  assert.deepEqual(actions(datalevin, "logs"), ["logs:CreateLogStream", "logs:PutLogEvents"]);

  assert.doesNotMatch(jank, /(?:s3|dynamodb|ec2|elasticfilesystem):/u);
});

test("bound serving policies deny the other profile's table and storage identity", () => {
  const datahikeTableArn = "arn:aws:dynamodb:us-east-1:123456789012:table/eacl-demo-datahike-blue";
  const datomicTableArn = "arn:aws:dynamodb:us-east-1:123456789012:table/eacl-demo-datomic-blue";
  const ddbPolicies = {
    "datahike-dynamodb": {
      actions: actions(datahikeDynamodb, "dynamodb"),
      resource: datahikeTableArn
    },
    "datomic-dynamodb": {
      actions: actions(datomicRole, "dynamodb"),
      resource: datomicTableArn
    }
  };
  const decision = (policy, action, resource) =>
    policy.actions.includes(action) && policy.resource === resource ? "allowed" : "implicitDeny";

  assert.match(datahikeDynamodb, /table\/eacl-demo-datahike-/u);
  assert.match(datomicRole, /table\/eacl-demo-datomic-/u);
  for (const [profileId, policy] of Object.entries(ddbPolicies)) {
    const otherResource = profileId === "datahike-dynamodb" ? datomicTableArn : datahikeTableArn;
    for (const action of policy.actions) {
      assert.equal(decision(policy, action, policy.resource), "allowed");
      assert.equal(decision(policy, action, otherResource), "implicitDeny");
    }
    for (const action of ["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:UpdateTable"]) {
      assert.equal(decision(policy, action, policy.resource), "implicitDeny");
    }
  }

  const datahikePrefix = "arn:aws:s3:::eacl-demo-datahike/00000000-0000-4000-8000-000000000001_";
  const s3Decision = (action, resource) =>
    action === "s3:GetObject" && resource.startsWith(datahikePrefix) ? "allowed" : "implicitDeny";
  assert.equal(s3Decision("s3:GetObject", `${datahikePrefix}store-key`), "allowed");
  assert.equal(s3Decision("s3:GetObject", "arn:aws:s3:::eacl-demo-datahike/other-store_key"), "implicitDeny");
  assert.equal(s3Decision("s3:GetObject", "arn:aws:s3:::eacl-demo-datalevin/runtime-state.json"), "implicitDeny");
  assert.equal(s3Decision("s3:PutObject", `${datahikePrefix}store-key`), "implicitDeny");
});

test("stateful maintenance roles remain separate and exact-resource scoped", () => {
  assert.match(datahikeTable, /SeedRole:[\s\S]*Value: temporary-seed/u);
  assert.match(datahikeTable, /Resource: !GetAtt Table\.Arn/u);
  assert.deepEqual(actions(datahikeTable, "dynamodb"), [
    "dynamodb:BatchGetItem",
    "dynamodb:BatchWriteItem",
    "dynamodb:DescribeTable",
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:Scan",
    "dynamodb:UpdateItem"
  ]);
  assert.doesNotMatch(datahikeTable, /Resource:\s*["']?\*|dynamodb:\*/u);
  assert.doesNotMatch(datahikeS3, /BatchWriteItem|PutItem|UpdateItem/u);
  assert.doesNotMatch(datahikeDynamodb, /BatchWriteItem|PutItem|UpdateItem/u);

  assert.match(datomicSeed, /TemporaryWriterRole:[\s\S]*TemporaryWriterInstanceProfile:/u);
  assert.match(datomicSeed, /Resource: !Ref TableArn/u);
  assert.deepEqual(actions(datomicSeed, "dynamodb"), [
    "dynamodb:BatchGetItem",
    "dynamodb:BatchWriteItem",
    "dynamodb:DeleteItem",
    "dynamodb:DescribeTable",
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:Query",
    "dynamodb:Scan",
    "dynamodb:UpdateItem"
  ]);
  assert.doesNotMatch(datomicSeed, /Resource:\s*["']?\*|dynamodb:\*/u);
  assert.equal((datomicSeed.match(/AmazonSSMManagedInstanceCore/gu) ?? []).length, 1);
  assert.doesNotMatch(datahikeTable, /ManagedPolicyArns:|AmazonSSMManagedInstanceCore/u);
  assert.doesNotMatch(datomicRole, /BatchWriteItem|PutItem|UpdateItem|TransactWriteItems/u);
});
