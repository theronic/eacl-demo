import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const definitions = [
  ["datahike-s3", "eacl-demo-datahike-s3-", 42],
  ["datahike-dynamodb", "eacl-demo-datahike-dynamodb-", 36],
  ["datomic-dynamodb", "eacl-demo-datomic-dynamodb-", 37],
  ["datalevin-memory", "eacl-demo-datalevin-memory-", 37],
  ["jank-memory", "eacl-demo-jank-memory-", 42]
];

const templates = Object.fromEntries(await Promise.all(definitions.map(async ([profileId]) => [
  profileId,
  await readFile(new URL(`../infra/profiles/${profileId}-runtime.yaml`, import.meta.url), "utf8")
])));
const buildUnits = JSON.parse(await readFile(
  new URL("../build-units.json", import.meta.url),
  "utf8"
));

test("every Lambda function-name boundary enforces the 64-character service limit", () => {
  for (const [profileId, prefix, suffixMaximum] of definitions) {
    const source = templates[profileId];
    const pattern = source.match(/  FunctionName:\s*\n    Type: String\s*\n    AllowedPattern: "([^"]+)"/u)?.[1];
    assert.ok(pattern, `${profileId} FunctionName pattern is missing`);
    const validator = new RegExp(pattern, "u");
    const longest = `${prefix}${"a".repeat(suffixMaximum)}`;
    assert.equal(longest.length, 64);
    assert.equal(validator.test(`${prefix}abc`), true);
    assert.equal(validator.test(longest), true);
    assert.equal(validator.test(`${longest}a`), false);
  }
});

test("every server runtime exposes an IAM-only alias-qualified immutable candidate", () => {
  for (const [profileId] of definitions) {
    const source = templates[profileId];
    assert.match(source, /CandidateVersion:\s*\n\s*Type: AWS::Lambda::Version/u, `${profileId} version is missing`);
    assert.match(source, /CandidateAlias:\s*\n\s*Type: AWS::Lambda::Alias/u, `${profileId} alias is missing`);
    assert.match(source, /FunctionVersion: !GetAtt CandidateVersion\.Version/u, `${profileId} alias is not immutable`);
    assert.match(source, /CandidateFunctionUrl:\s*\n\s*Type: AWS::Lambda::Url[\s\S]*?AuthType: AWS_IAM[\s\S]*?Qualifier: !Ref CandidateAliasName/u, `${profileId} IAM URL is not alias-qualified`);
    assert.match(source, /CandidateQualifiedName:\s*\n\s*Value: !Sub "\$\{FunctionName\}:\$\{CandidateAliasName\}"/u, `${profileId} qualified origin output is missing`);
  }
});

test("every server runtime owns one pre-created log group with bounded retention", () => {
  for (const [profileId] of definitions) {
    const source = templates[profileId];
    assert.equal((source.match(/Type: AWS::Logs::LogGroup/gu) ?? []).length, 1, `${profileId} log group count drifted`);
    assert.equal((source.match(/RetentionInDays: 14/gu) ?? []).length, 1, `${profileId} log retention drifted`);
    assert.match(source, /DeletionPolicy: (Delete|Retain)\s*\n\s*UpdateReplacePolicy: \1/u, `${profileId} log resource lifecycle is inconsistent`);
  }
});

test("an immutable Jank candidate boundary does not imply a deployable native artifact", () => {
  assert.equal(buildUnits.units["jank-memory"].deploymentEligible, false);
  assert.match(templates["jank-memory"], /Runtime: provided\.al2023/u);
  assert.doesNotMatch(templates["jank-memory"], /^\s{6}SnapStart:/mu);
});
