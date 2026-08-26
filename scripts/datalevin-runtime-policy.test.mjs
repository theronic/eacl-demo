import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const [template, decision, buildUnits, lifecycleSchema, telemetrySchema, lifecycleSource, runtimeSource] = await Promise.all([
  readFile(new URL("../infra/profiles/datalevin-memory-runtime.yaml", import.meta.url), "utf8"),
  readFile(new URL("../dependencies/datalevin-memory.v1.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../build-units.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../schemas/datalevin-lifecycle-state.v1.schema.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../schemas/datalevin-runtime-telemetry.v1.schema.json", import.meta.url), "utf8").then(JSON.parse),
  readFile(new URL("../services/datalevin-memory/src/eacl_demo/datalevin_memory/lifecycle.clj", import.meta.url), "utf8"),
  readFile(new URL("../services/datalevin-memory/src/eacl_demo/datalevin_memory/runtime.clj", import.meta.url), "utf8")
]);

test("Datalevin qualification target is managed Java 25 arm64 SnapStart", () => {
  assert.match(template, /^\s{6}Runtime: java25$/mu);
  assert.match(template, /^\s{6}Architectures:\s*\n\s{8}- arm64$/mu);
  assert.match(template, /^\s{6}SnapStart:\s*\n\s{8}ApplyOn: PublishedVersions$/mu);
  assert.match(template, /Type: AWS::Lambda::Version/u);
  assert.match(template, /FunctionVersion: !GetAtt CandidateVersion\.Version/u);
  assert.doesNotMatch(template, /provided\.|x86_64|PackageType: Image/u);
});

test("Datalevin uses true in-memory topology without remote or filesystem serving", () => {
  assert.match(template, /^\s{10}EACL_DATALEVIN_STORAGE_MODE: memory$/mu);
  assert.match(template, /^\s{10}EACL_DATALEVIN_FIXTURE_PATH: \/var\/task\/fixture-10000\.ndjson$/mu);
  assert.match(template, /EACL_SOURCE_LIFECYCLE_ID: !Ref SourceLifecycleId/u);
  assert.match(template, /AllowedValues:\s*\n\s*- after-restore-rebuild\s*\n\s*- pre-checkpoint-quiesced/u);
  assert.doesNotMatch(template, /FileSystemConfigs|VpcConfig|EFS|\/mnt\/|DynamoDB|DATALEVIN_(?:DIR|PATH)|remote|server|WAL/iu);
});

test("Datalevin runtime role can only read exact immutable lifecycle metadata and write logs", () => {
  assert.deepEqual(
    [...template.matchAll(/- ((?:logs|s3):[A-Za-z]+)/gu)].map((match) => match[1]).sort(),
    ["logs:CreateLogStream", "logs:PutLogEvents", "s3:GetObjectVersion"]
  );
  assert.match(template, /Resource: !Sub "\$\{RuntimeStateBucketArn\}\/\$\{RuntimeStateObjectKey\}"/u);
  assert.match(template, /StringEquals:\s*\n\s+s3:VersionId: !Ref RuntimeStateObjectVersion/u);
  assert.match(template, /Resource: !Sub "arn:\$\{AWS::Partition\}:logs:\$\{AWS::Region\}:\$\{AWS::AccountId\}:log-group:\/aws\/lambda\/\$\{FunctionName\}:\*"/u);
  assert.doesNotMatch(template, /(?:dynamodb|ec2|elasticfilesystem|kms):|s3:(?:Put|Delete|List|Create|Copy)|Resource:\s*["']?\*/iu);
});

test("Datalevin candidate is bounded and has no incompatible SnapStart features", () => {
  assert.match(template, /^\s{6}ReservedConcurrentExecutions: 1$/mu);
  assert.match(template, /^\s{10}EACL_MAXIMUM_CONCURRENCY: "1"$/mu);
  assert.match(template, /^\s{6}EphemeralStorage:\s*\n\s{8}Size: 512$/mu);
  assert.match(template, /RetentionInDays: 14/u);
  assert.match(template, /TracingConfig:\s*\n\s*Mode: PassThrough/u);
  assert.doesNotMatch(template, /ProvisionedConcurrency|AWS::KMS|KmsKeyArn/u);
});

test("immutable inputs and IAM-only candidate transport remain qualification-blocked", () => {
  assert.match(template, /S3ObjectVersion: !Ref ArtifactVersion/u);
  assert.match(template, /AllowedPattern: "\^artifacts\/datalevin-memory\//u);
  for (const name of ["EACL_ARTIFACT_SHA256", "EACL_CORE_SHA", "EACL_DATA_MANIFEST_SHA256", "EACL_DEMO_SHA", "EACL_DEPLOYMENT_ID", "EACL_SOURCE_LIFECYCLE_ID"]) {
    assert.match(template, new RegExp(`^\\s{10}${name}: !Ref `, "mu"));
  }
  for (const name of ["BUCKET", "KEY", "SHA256", "VERSION"]) {
    assert.match(template, new RegExp(`^\\s{10}EACL_DATALEVIN_RUNTIME_STATE_${name}: !Ref RuntimeState`, "mu"));
  }
  assert.match(template, /Type: AWS::Lambda::Url[\s\S]*?AuthType: AWS_IAM/u);
  assert.match(template, /Qualifier: !Ref CandidateAliasName/u);
  assert.match(template, /blocked-until-native-release-and-lifecycle-evidence/u);
  assert.equal(decision.deploymentEligible, false);
  assert.equal(buildUnits.units["datalevin-memory"].deploymentEligible, false);
});

test("lifecycle state is closed, deterministic, external metadata", () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(lifecycleSchema);
  const state = {
    schema: "eacl-demo.datalevin-lifecycle-state.v1",
    profileId: "datalevin-memory",
    stateKind: "external-control-plane-metadata",
    demoSha: "d".repeat(40),
    eaclSha: "e".repeat(40),
    artifactSha256: "f".repeat(64),
    deploymentId: "datalevin-candidate-42",
    runtime: "java25",
    architecture: "arm64",
    storageMode: "memory",
    snapshotStrategy: "after-restore-rebuild",
    maximumConcurrency: 1,
    dataManifestSha256: "a".repeat(64),
    bootstrapPlanSha256: "b".repeat(64),
    sourceLifecycle: "123e4567-e89b-42d3-a456-426614174000",
    nativeSourceId: "223e4567-e89b-42d3-a456-426614174000",
    revisionWatermark: 42,
    logicalResourceCount: 10_000,
    mutationPolicy: "immutable-after-publication"
  };
  assert.equal(validate(state), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...state, revisionWatermark: -1 }), false);
  assert.equal(validate({ ...state, storage: "s3" }), false);
  assert.equal(validate({ ...state, runtime: "provided.al2023" }), false);
  assert.equal(validate({ ...state, snapshotStrategy: "unqualified" }), false);
  assert.equal(validate({ ...state, deploymentId: "bad deployment" }), false);
  assert.match(template, /s3:GetObjectVersion/u);
  assert.doesNotMatch(template, /s3:PutObject/u);
  assert.match(template, /RevisionWatermark:\s*\n\s+Type: String\s*\n\s+AllowedPattern: "\^\(\?:0\|\[1-9\]\[0-9\]\{0,14\}\)\$"/u);
  assert.match(template, /DistinctLifecycleAndNativeSource:[\s\S]*!Equals \[!Ref SourceLifecycleId, !Ref NativeSourceId\]/u);
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
