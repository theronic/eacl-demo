import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [template, handlerSource, javaHandlerSource] = await Promise.all([
  readFile(new URL("../infra/profiles/datomic-dynamodb-runtime.yaml", import.meta.url), "utf8"),
  readFile(new URL("../services/datomic-dynamodb/src/eacl_demo/datomic_dynamodb/lambda_handler.clj", import.meta.url), "utf8"),
  readFile(new URL("../services/datomic-dynamodb/java/eacl_demo/datomic_dynamodb/LambdaHandler.java", import.meta.url), "utf8")
]);

test("Datomic candidate uses managed Java 25 and a restore-qualified preinitialized Peer", () => {
  assert.match(template, /Runtime: java25/u);
  assert.match(template, /Architectures:\s*\n\s*- x86_64/u);
  assert.match(template, /SnapStartPolicy: published-version-preinitialized-reader/u);
  assert.match(template, /SnapStart:\s*\n\s*ApplyOn: PublishedVersions/u);
  assert.match(handlerSource, /defn initialize-runtime!/u);
  assert.match(handlerSource, /warm-hot-path!/u);
  assert.match(javaHandlerSource, /INITIALIZE\.invoke\(\)/u);
  assert.doesNotMatch(template, /ProvisionedConcurrency|java17(?:\s|$)|provided\./u);
});

test("candidate bytes and identity are immutable deployment inputs", () => {
  assert.match(template, /S3ObjectVersion: !Ref ArtifactVersion/u);
  assert.match(template, /AllowedPattern: "\^artifacts\/datomic-dynamodb\/\[0-9a-f\]/u);
  for (const name of [
    "EACL_ARTIFACT_SHA256", "EACL_CORE_SHA", "EACL_CURSOR_KEY",
    "EACL_DATOMIC_DATABASE", "EACL_DATOMIC_TABLE", "EACL_DEMO_SHA",
    "EACL_DEPLOYMENT_ID", "EACL_MAXIMUM_CONCURRENCY"
  ]) assert.match(template, new RegExp(`${name}:`, "u"));
  assert.match(template, /Handler: eacl_demo\.datomic_dynamodb\.LambdaHandler::handleRequest/u);
  assert.match(template, /Type: AWS::Lambda::Version/u);
  assert.match(template, /FunctionVersion: !GetAtt CandidateVersion\.Version/u);
});

test("candidate transport and cost surface are bounded", () => {
  assert.match(template, /Type: AWS::Lambda::Url[\s\S]*?AuthType: NONE/u);
  assert.match(template, /Qualifier: !Ref CandidateAliasName/u);
  assert.match(template, /AllowOrigins: \[https:\/\/demo\.eacl\.dev\]/u);
  assert.match(template, /FunctionUrlAuthType: NONE/u);
  assert.match(template, /InvokedViaFunctionUrl: true/u);
  assert.doesNotMatch(template, /ReservedConcurrentExecutions|^  MaximumConcurrency:/mu);
  assert.match(template, /EphemeralStorage:\s*\n\s*Size: 512/u);
  assert.match(template, /RetentionInDays: 14/u);
  assert.match(template, /TracingConfig:\s*\n\s*Mode: PassThrough/u);
  assert.doesNotMatch(template, /AWS::KMS|kms:|KmsKeyArn|AuthType: AWS_IAM/iu);
});
