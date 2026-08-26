import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = await readFile(
  new URL("../infra/profiles/jank-memory-runtime.yaml", import.meta.url),
  "utf8"
);
const lock = JSON.parse(await readFile(
  new URL("../dependencies/jank-linux-x86_64-builder.v1.json", import.meta.url),
  "utf8"
));
const readme = await readFile(
  new URL("../services/jank-memory/README.md", import.meta.url),
  "utf8"
);

test("Jank is fixed to the supported Linux x86_64 custom-runtime target", () => {
  assert.equal(lock.platform, "linux/amd64");
  assert.equal(lock.lambda.runtime, "provided.al2023");
  assert.equal(lock.lambda.architecture, "x86_64");
  assert.match(template, /^\s{6}Runtime: provided\.al2023$/mu);
  assert.match(template, /^\s{6}Architectures:\s*\n\s{8}- x86_64$/mu);
  assert.match(template, /^\s{6}PackageType: Zip$/mu);
  assert.match(template, /^\s{6}Handler: bootstrap$/mu);
});

test("SnapStart claims and configuration fail the Jank runtime policy", () => {
  assert.equal(lock.lambda.snapStart, false);
  assert.match(template, /SnapStartPolicy: disabled-unsupported-os-only-runtime/u);
  assert.doesNotMatch(template, /^\s{6}SnapStart:/mu);
  assert.match(readme, /SnapStart is unsupported/u);
  assert.doesNotMatch(readme, /SnapStart (?:is )?enabled/iu);

  const invalidTemplate = template.replace(
    "      Runtime: provided.al2023",
    "      Runtime: provided.al2023\n      SnapStart:\n        ApplyOn: PublishedVersions"
  );
  assert.throws(() => enforceNoSnapStart(invalidTemplate), /SnapStart/u);
});

test("the unmeasured runtime stays cost-bounded", () => {
  assert.match(template, /^\s{4}Default: 4096$/mu);
  assert.match(template, /^\s{4}MinValue: 128$/mu);
  assert.match(template, /^\s{4}MaxValue: 10240$/mu);
  assert.match(template, /^\s{6}ReservedConcurrentExecutions: 2$/mu);
  assert.match(template, /^\s{6}EphemeralStorage:\s*\n\s{8}Size: 512$/mu);
  assert.doesNotMatch(template, /ProvisionedConcurrency|AWS::KMS|KmsKeyArn/u);
  assert.match(template, /LogGroup:\s*\n\s*Type: AWS::Logs::LogGroup\s*\n\s*DeletionPolicy: Delete\s*\n\s*UpdateReplacePolicy: Delete/u);
});

test("Jank runtime owns an exact log-only role instead of accepting arbitrary IAM", () => {
  const parameters = template.match(/^Parameters:\s*$([\s\S]*?)^Resources:\s*$/mu)?.[1] ?? "";
  assert.doesNotMatch(parameters, /^  ExecutionRoleArn:\s*$/mu);
  assert.match(template, /ExecutionRole:\s*\n\s*Type: AWS::IAM::Role/u);
  assert.match(template, /^\s{6}Role: !GetAtt ExecutionRole\.Arn$/mu);
  assert.deepEqual(
    [...template.matchAll(/- (logs:[A-Za-z]+)/gu)].map((match) => match[1]).sort(),
    ["logs:CreateLogStream", "logs:PutLogEvents"]
  );
  assert.match(template, /Resource: !Sub "arn:\$\{AWS::Partition\}:logs:\$\{AWS::Region\}:\$\{AWS::AccountId\}:log-group:\/aws\/lambda\/\$\{FunctionName\}:\*"/u);
  assert.doesNotMatch(template, /(?:dynamodb|s3|ec2|elasticfilesystem|kms):|Resource:\s*["']?\*/iu);
});

test("deployment identity and fixture location are supplied by the runtime template", () => {
  assert.match(template, /AllowedValues:\s*\n\s*- "1cbf80c7aaf4bfcf2564d2bf30135794ff406383"/u);
  assert.match(template, /AllowedValues:\s*\n\s*- "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a"/u);
  for (const name of [
    "EACL_DEMO_SHA",
    "EACL_CORE_SHA",
    "EACL_ARTIFACT_SHA256",
    "EACL_DEPLOYMENT_ID",
    "EACL_DATA_MANIFEST_SHA256"
  ]) assert.match(template, new RegExp(`^\\s{10}${name}: !Ref `, "mu"));
  assert.match(template, /^\s{10}EACL_JANK_FIXTURE_PATH: \/var\/task\/fixture-10000\.ndjson$/mu);
});

function enforceNoSnapStart(source) {
  if (/^\s{6}SnapStart:/mu.test(source)) {
    throw new Error("Jank provided.al2023 must not configure SnapStart");
  }
  return true;
}
