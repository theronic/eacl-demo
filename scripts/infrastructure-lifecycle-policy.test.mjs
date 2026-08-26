import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const profileIds = [
  "datahike-s3",
  "datahike-dynamodb",
  "datomic-dynamodb",
  "datalevin-memory",
  "jank-memory"
];
const [foundation, staticTemplate, datahikeTable, datomicTable, observability, publicationPlan, legacyReadme] = await Promise.all([
  read("infra/foundation/template.yaml"),
  read("infra/static/template.yaml"),
  read("infra/data/datahike-dynamodb-table.yaml"),
  read("infra/data/datomic-dynamodb-table.yaml"),
  read("infra/observability/template.yaml"),
  read("scripts/lib/profile-publication-plan.mjs"),
  read("infra/legacy/README.md")
]);
const runtimes = Object.fromEntries(await Promise.all(profileIds.map(async (profileId) => [
  profileId,
  await read(`infra/profiles/${profileId}-runtime.yaml`)
])));

test("foundation, static, profile runtime, data, and observability ownership do not overlap", () => {
  assert.doesNotMatch(foundation, /AWS::(?:Lambda::Function|DynamoDB::Table|CloudFront::Distribution|Route53::)/u);
  assert.doesNotMatch(staticTemplate, /^\s*Type: AWS::(?:S3::Bucket|Lambda::Function|DynamoDB::Table|Route53::[^\s]+)$/mu);
  assert.doesNotMatch(observability, /AWS::(?:DynamoDB::Table|CloudFront::Distribution|Route53::)/u);

  for (const [profileId, source] of Object.entries(runtimes)) {
    assert.match(source, new RegExp(`Profile: ${profileId}`, "u"));
    assert.equal((source.match(/Type: AWS::Lambda::Function$/gmu) ?? []).length, 1);
    assert.equal((source.match(/Type: AWS::Lambda::Alias$/gmu) ?? []).length, 1);
    assert.doesNotMatch(source, /AWS::(?:DynamoDB::Table|S3::Bucket|CloudFront::Distribution|Route53::)/u);
  }

  for (const source of [datahikeTable, datomicTable]) {
    assert.equal((source.match(/Type: AWS::DynamoDB::Table$/gmu) ?? []).length, 1);
    assert.doesNotMatch(source, /AWS::(?:Lambda::Function|S3::Bucket|CloudFront::Distribution|Route53::)/u);
  }
  for (const source of [foundation, staticTemplate, observability, datahikeTable, datomicTable, ...Object.values(runtimes)]) {
    assert.doesNotMatch(source, /AWS::CloudFormation::Stack|Fn::ImportValue|^\s*Export:/mu);
  }
});

test("durable foundation and data survive stack rollback or replacement", () => {
  assert.equal((foundation.match(/Type: AWS::S3::Bucket$/gmu) ?? []).length, 3);
  assert.equal((foundation.match(/DeletionPolicy: Retain/gmu) ?? []).length, 3);
  assert.equal((foundation.match(/UpdateReplacePolicy: Retain/gmu) ?? []).length, 3);
  for (const source of [datahikeTable, datomicTable]) {
    assert.match(source, /DeletionPolicy: Retain\s*\n\s*UpdateReplacePolicy: Retain/u);
    assert.match(source, /DeletionProtectionEnabled: true/u);
    assert.match(source, /PointInTimeRecoveryEnabled: true/u);
    assert.match(source, /BillingMode: PAY_PER_REQUEST/u);
  }
});

test("per-profile alias rollback cannot target a sibling or shared static resource", () => {
  assert.doesNotMatch(staticTemplate, /AWS::Lambda::Alias/u);
  for (const [profileId, source] of Object.entries(runtimes)) {
    assert.equal((source.match(/Type: AWS::Lambda::Version$/gmu) ?? []).length, 1, `${profileId} version count drifted`);
    assert.equal((source.match(/Type: AWS::Lambda::Alias$/gmu) ?? []).length, 1, `${profileId} alias count drifted`);
  }
  assert.match(publicationPlan, /profileId: profile\.id/u);
  assert.match(publicationPlan, /revisionId: currentAlias\.revisionId/u);
  assert.match(publicationPlan, /onlyIfCurrentVersion: candidateVersion/u);
  assert.match(publicationPlan, /key = `registry\/profiles\/\$\{profile\.id\}\.json`/u);
  for (const profileId of profileIds) {
    assert.doesNotMatch(runtimes[profileId], new RegExp(profileIds.filter((id) => id !== profileId).join("|"), "u"));
  }
});

test("legacy compatibility remains non-executable until exact fallback and retirement evidence exist", async () => {
  const entries = await readdir(new URL("../infra/legacy/", import.meta.url));
  assert.deepEqual(entries.sort(), ["README.md"]);
  assert.match(legacyReadme, /Fallback hostnames/u);
  assert.match(legacyReadme, /No automatic\s+destructive action/u);
});
