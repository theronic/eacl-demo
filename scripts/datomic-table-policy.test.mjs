import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(
  new URL("../infra/data/datomic-dynamodb-table.yaml", import.meta.url),
  "utf8"
);
const seedRole = await readFile(
  new URL("../infra/compute/datomic-dynamodb-seed-role.yaml", import.meta.url),
  "utf8"
);

test("Datomic table has the documented id-only schema and retained cost controls", () => {
  assert.match(template, /AttributeName: id\s*\n\s*AttributeType: S/u);
  assert.match(template, /AttributeName: id\s*\n\s*KeyType: HASH/u);
  assert.equal((template.match(/KeyType:/gu) ?? []).length, 1);
  assert.match(template, /BillingMode: PAY_PER_REQUEST/u);
  assert.match(template, /OnDemandThroughput:[\s\S]*MaxReadRequestUnits:[\s\S]*MaxWriteRequestUnits:/u);
  assert.match(template, /DeletionProtectionEnabled: true/u);
  assert.match(template, /PointInTimeRecoveryEnabled: true/u);
  assert.match(template, /DeletionPolicy: Retain/u);
  assert.match(template, /UpdateReplacePolicy: Retain/u);
  assert.doesNotMatch(template, /^\s*SSESpecification:|^\s*Type: AWS::KMS|^\s*-?\s*kms:|KMS_MASTER/mu);
});

test("durable table owns no temporary identity", () => {
  assert.doesNotMatch(template, /AWS::IAM|TemporaryWriter|InstanceProfile|sts:AssumeRole/u);
});

test("independently deleted temporary writer is exact-table and exact-object scoped", () => {
  assert.match(seedRole, /TemporaryWriterRole:[\s\S]*TemporaryWriterInstanceProfile:/u);
  assert.match(seedRole, /Principal:\s*\n\s*Service: ec2\.amazonaws\.com/u);
  const statement = /Sid: ExactGenerationSeedDataPlane[\s\S]*?Resource: !Ref TableArn/u.exec(seedRole)?.[0];
  assert.ok(statement);
  assert.doesNotMatch(statement, /dynamodb:\*|Resource:\s*["']?\*/u);
  for (const forbidden of [
    "CreateTable", "DeleteTable", "UpdateTable", "RestoreTable", "ExportTable",
    "UpdateContinuousBackups", "UpdateTimeToLive"
  ]) assert.doesNotMatch(statement, new RegExp(`dynamodb:${forbidden}`, "u"));

  const artifactStatement = /Sid: ExactImmutableSeedArtifact[\s\S]*?s3:VersionId: !Ref SeedArtifactObjectVersion/u.exec(seedRole)?.[0];
  assert.ok(artifactStatement);
  assert.match(artifactStatement, /Action: s3:GetObjectVersion/u);
  assert.match(artifactStatement, /Resource: !Sub arn:\$\{AWS::Partition\}:s3:::\$\{ArtifactBucketName\}\/\$\{SeedArtifactObjectKey\}/u);
  assert.doesNotMatch(artifactStatement, /s3:GetObject\s*$|s3:\*|Resource:\s*["']?\*/mu);
  assert.match(seedRole, /SeedArtifactObjectKey:[\s\S]*AllowedPattern: "\^artifacts\/datomic-dynamodb\/seed\/\[a-f0-9\]/u);
  assert.match(seedRole, /SeedArtifactObjectVersion:[\s\S]*NoEcho: true/u);
  const streamStatement = /Sid: ExactImmutableFixtureStream[\s\S]*?s3:VersionId: !Ref FixtureStreamObjectVersion/u.exec(seedRole)?.[0];
  assert.ok(streamStatement);
  assert.match(streamStatement, /Action: s3:GetObjectVersion/u);
  assert.match(streamStatement, /\$\{ArtifactBucketName\}\/\$\{FixtureStreamObjectKey\}/u);
  assert.doesNotMatch(streamStatement, /s3:GetObject\s*$|s3:\*|Resource:\s*["']?\*/mu);
  assert.match(seedRole, /FixtureStreamObjectVersion:[\s\S]*NoEcho: true/u);
  assert.match(seedRole, /Sid: ExactSeedEvidenceOutput[\s\S]*s3:x-amz-server-side-encryption: AES256/u);
});

test("generation and publication identity are mandatory tags", () => {
  for (const value of ["Project", "Profile", "Generation", "FixtureDigest", "PublicationPhase", "Workload"])
    assert.match(template, new RegExp(`Key: ${value}`, "u"));
  assert.match(template, /Value: !If \[IsServing, eacl-demo-serving, eacl-demo-seed\]/u);
});
