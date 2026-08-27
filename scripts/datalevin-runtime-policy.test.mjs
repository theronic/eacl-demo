import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const [template, telemetrySchema, lifecycleSource, runtimeSource, readerSource, handlerSource, javaHandlerSource, deploySource] = await Promise.all([
  readFile(new URL("../infra/profiles/datalevin-memory-runtime.yaml", import.meta.url), "utf8"),
  readFile(new URL("../schemas/datalevin-runtime-telemetry.v1.schema.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../services/datalevin-memory/src/eacl_demo/datalevin_memory/lifecycle.clj", import.meta.url), "utf8"),
  readFile(new URL("../services/datalevin-memory/src/eacl_demo/datalevin_memory/runtime.clj", import.meta.url), "utf8"),
  readFile(new URL("../services/datalevin-memory/src/eacl_demo/datalevin_memory/reader.clj", import.meta.url), "utf8"),
  readFile(new URL("../services/datalevin-memory/src/eacl_demo/datalevin_memory/lambda_handler.clj", import.meta.url), "utf8"),
  readFile(new URL("../services/datalevin-memory/java/eacl_demo/datalevin_memory/LambdaHandler.java", import.meta.url), "utf8"),
  readFile(new URL("../scripts/deploy-live-demo.mjs", import.meta.url), "utf8")
]);

test("Datalevin live target is a preinitialized managed Java 25 arm64 SnapStart version", () => {
  assert.match(template, /^\s{6}Runtime: java25$/mu);
  assert.match(template, /^\s{6}Architectures:\s*\n\s{8}- arm64$/mu);
  assert.match(template, /^\s{6}SnapStart:\s*\n\s{8}ApplyOn: PublishedVersions$/mu);
  assert.match(template, /Type: AWS::Lambda::Version/u);
  assert.match(template, /FunctionVersion: !GetAtt CandidateVersion\.Version/u);
  assert.doesNotMatch(template, /provided\.|x86_64|PackageType: Image/u);
  assert.match(handlerSource, /defn initialize-runtime!/u);
  assert.match(javaHandlerSource, /INITIALIZE\.invoke\(\)/u);
  assert.match(deploySource, /published-version-active/u);
  assert.match(deploySource, /OptimizationStatus !== "On"/u);
  assert.match(deploySource, /runtime\?\.snapStart !==/u);
});

test("Datalevin uses true in-memory topology without remote or filesystem serving", () => {
  assert.match(template, /^\s{4}Storage: memory$/mu);
  assert.match(readerSource, /datalevin-eacl\/create-conn nil physical-schema/u);
  assert.match(readerSource, /fixture-10000\.ndjson/u);
  assert.doesNotMatch(template, /FileSystemConfigs|VpcConfig|EFS|\/mnt\/|DynamoDB|DATALEVIN_(?:DIR|PATH)|remote|server|WAL/iu);
  assert.doesNotMatch(readerSource, /get-conn\s+"|\/tmp|\/mnt|remote|server/iu);
});

test("Datalevin runtime role can only write exact-function logs", () => {
  assert.deepEqual(
    [...template.matchAll(/- ((?:logs|s3):[A-Za-z]+)/gu)].map((match) => match[1]).sort(),
    ["logs:CreateLogStream", "logs:PutLogEvents"]
  );
  assert.match(template, /Resource: !Sub "arn:\$\{AWS::Partition\}:logs:\$\{AWS::Region\}:\$\{AWS::AccountId\}:log-group:\/aws\/lambda\/\$\{FunctionName\}:\*"/u);
  assert.doesNotMatch(template, /(?:dynamodb|ec2|elasticfilesystem|kms|s3):|Resource:\s*["']?\*/iu);
});

test("Datalevin candidate has bounded compute and no paid warm-up feature", () => {
  assert.match(template, /MemorySize:\s*\n\s*Type: Number\s*\n\s*Default: 1024\s*\n\s*AllowedValues: \[1024\]/u);
  assert.doesNotMatch(template, /ReservedConcurrentExecutions|6144/u);
  assert.match(template, /^\s{6}EphemeralStorage:\s*\n\s{8}Size: 512$/mu);
  assert.match(template, /^\s{6}Timeout: 60$/mu);
  assert.match(template, /RetentionInDays: 7/u);
  assert.match(template, /TracingConfig:\s*\n\s*Mode: PassThrough/u);
  assert.doesNotMatch(template, /ProvisionedConcurrency|AWS::KMS|KmsKeyArn|AWS::Events::Rule/u);
});

test("immutable inputs and direct candidate transport bind the live artifact", () => {
  assert.match(template, /S3ObjectVersion: !Ref ArtifactVersion/u);
  assert.match(template, /AllowedPattern: "\^artifacts\/datalevin-memory\//u);
  for (const name of ["EACL_ARTIFACT_SHA256", "EACL_CORE_SHA", "EACL_DEMO_SHA", "EACL_DEPLOYMENT_ID"]) {
    assert.match(template, new RegExp(`^\\s{10}${name}: !Ref `, "mu"));
  }
  assert.match(template, /Type: AWS::Lambda::Url[\s\S]*?AuthType: NONE/u);
  assert.match(template, /Qualifier: !Ref CandidateAliasName/u);
  assert.match(template, /AllowOrigins: \[https:\/\/demo\.eacl\.dev\]/u);
  assert.match(template, /FunctionUrlAuthType: NONE/u);
  assert.match(template, /InvokedViaFunctionUrl: true/u);
});

test("lifecycle transition policy distinguishes restore, deployment, and rollback", () => {
  assert.match(lifecycleSource, /defn validate-transition!/u);
  assert.match(lifecycleSource, /"concurrent-environment" "restore"/u);
  assert.match(lifecycleSource, /"rebuild" "lifecycle-rotation"/u);
  assert.match(lifecycleSource, /revision-regression-under-unchanged-lifecycle/u);
  assert.match(lifecycleSource, /require-rotated-identities! rollbackTarget \[current\]/u);
  assert.match(lifecycleSource, /require-rotated-identities! candidate\s+\[current rollbackTarget\]/u);
  assert.doesNotMatch(lifecycleSource, /process-local-watermark|defonce\s+.*watermark/iu);
});

test("snapshot ownership boundary closes transport values and exposes complete telemetry", () => {
  assert.match(runtimeSource, /\.isVirtual thread/u);
  assert.match(runtimeSource, /compare-and-set! admission nil thread/u);
  assert.match(runtimeSource, /close-transport-response!/u);
  assert.match(runtimeSource, /response-node-limit-exceeded/u);
  assert.match(runtimeSource, /response-byte-limit-exceeded/u);
  assert.match(runtimeSource, /duplicate-response-key/u);
  assert.match(runtimeSource, /snapshot-not-owned-at-release/u);
  assert.match(runtimeSource, /:rssBytes :nativeMappedBytes/u);
  assert.match(runtimeSource, /\(:require \[eacl-demo\.datalevin-memory\.lifecycle :as lifecycle\]\)\)/u);
  assert.doesNotMatch(runtimeSource, /\[datalevin(?:\.|\s)/u);

  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(telemetrySchema);
  const telemetry = {
    schema: "eacl-demo.datalevin-runtime-telemetry.v1",
    profileId: "datalevin-memory",
    demoSha: "d".repeat(40),
    eaclSha: "e".repeat(40),
    artifactSha256: "f".repeat(64),
    deploymentId: "datalevin-candidate-42",
    runtime: "java25",
    architecture: "arm64",
    storageMode: "memory",
    maximumConcurrency: 1,
    sourceLifecycle: "123e4567-e89b-42d3-a456-426614174000",
    nativeSourceId: "223e4567-e89b-42d3-a456-426614174000",
    revisionWatermark: 42,
    snapshotStrategy: "after-restore-rebuild",
    ownership: {
      openedSnapshots: 1,
      closedSnapshots: 1,
      activeSnapshots: 0,
      peakActiveSnapshots: 1,
      acquisitionFailures: 0,
      releaseFailures: 0,
      requestFailures: 0,
      cancellations: 0,
      deadlineFailures: 0,
      lastOwnerThreadId: 17
    },
    nativeReaders: { active: 0, "oldest-age-ms": null },
    memory: {
      heapUsedBytes: 100,
      heapCommittedBytes: 200,
      heapMaxBytes: 400,
      nonHeapUsedBytes: 50,
      nonHeapCommittedBytes: 75,
      directUsedBytes: 25,
      mappedUsedBytes: 30,
      rssBytes: 600,
      nativeMappedBytes: 300,
      openFileDescriptorCount: 12,
      nativeHandleCount: 3
    },
    memoryComplete: true
  };
  assert.equal(validate(telemetry), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...telemetry, unexpected: true }), false);
  assert.equal(validate({ ...telemetry, nativeReaders: { active: 0, "oldest-age-ms": 1 } }), false);
  assert.equal(validate({ ...telemetry, memory: { ...telemetry.memory, rssBytes: -1 } }), false);
  assert.equal(validate({ ...telemetry, memoryComplete: true, memory: { ...telemetry.memory, rssBytes: null } }), false);
  assert.equal(validate({ ...telemetry, memoryComplete: false }), false);
});
