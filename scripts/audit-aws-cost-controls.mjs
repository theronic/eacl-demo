import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const foundation = read("infra/foundation/template.yaml");
const observability = read("infra/observability/template.yaml");
const controls = read("infra/data/dynamodb-cost-controls.yaml");
const table = read("infra/data/datahike-dynamodb-table.yaml");
const datomicTable = read("infra/data/datomic-dynamodb-table.yaml");
const datomicSeedRole = read("infra/compute/datomic-dynamodb-seed-role.yaml");
const datahikeSeedRole = read("infra/compute/datahike-dynamodb-seed-role.yaml");
const datahikeSeedNetwork = read("infra/compute/datahike-dynamodb-seed-network.yaml");
const qualification = read("infra/data/datahike-dynamodb-qualification.yaml");
const datahikeRuntime = read("infra/profiles/datahike-dynamodb-runtime.yaml");
const datahikeS3Runtime = read("infra/profiles/datahike-s3-runtime.yaml");
const datalevinRuntime = read("infra/profiles/datalevin-memory-runtime.yaml");
const jankRuntime = read("infra/profiles/jank-memory-runtime.yaml");
const datomicServingRole = read("infra/profiles/datomic-dynamodb-serving-role.yaml");
const watchdog = read("infra/compute/temp-compute-watchdog.yaml");
const watchdogCode = read("infra/compute/temp-compute-watchdog/index.py");
const policy = JSON.parse(read("infra/data/dynamodb-cap-policy.v1.json"));
const statefulAuthorization = JSON.parse(read("infra/data/authorized-initial-stateful-operations.v1.json"));

for (const text of [foundation, observability, controls, table, datomicTable, datomicSeedRole, datahikeSeedRole, datahikeSeedNetwork, qualification, datahikeRuntime, datahikeS3Runtime, datalevinRuntime, jankRuntime, datomicServingRole, watchdog]) {
  assert.doesNotMatch(text, /AWS::KMS::Key|KMSMasterKeyID|SSEAlgorithm:\s*aws:kms/u);
}

assert.match(watchdog, /ScheduleExpression: rate\(5 minutes\)/u);
assert.match(watchdog, /ReservedConcurrentExecutions: 1/u);
assert.match(watchdog, /Action: ec2:TerminateInstances/u);
assert.match(watchdog, /ec2:ResourceTag\/Project: eacl-demo/u);
assert.match(watchdog, /ec2:ResourceTag\/Lifecycle: temporary/u);
assert.match(watchdog, /ec2:ResourceTag\/ManagedBy: eacl-demo-temp-watchdog/u);
assert.match(watchdog, /ec2:ResourceTag\/Owner: theronic\/eacl-demo/u);
assert.match(watchdog, /Action: sns:Publish/u);
assert.doesNotMatch(watchdog, /ec2:(RunInstances|CreateVolume|CreateTags)/u);
assert.match(watchdog, /WatchdogFailureQueue:[\s\S]*MessageRetentionPeriod: 1209600[\s\S]*SqsManagedSseEnabled: true/u);
assert.match(watchdog, /ExactWatchdogScheduleDeliveryFailures[\s\S]*Service: events\.amazonaws\.com[\s\S]*aws:SourceArn: !Sub "arn:\$\{AWS::Partition\}:events:\$\{AWS::Region\}:\$\{AWS::AccountId\}:rule\/\$\{AWS::StackName\}-schedule"/u);
assert.match(watchdog, /PolicyName: retain-failed-watchdog-invocations[\s\S]*Action: sqs:SendMessage[\s\S]*Resource: !GetAtt WatchdogFailureQueue\.Arn/u);
assert.match(watchdog, /WatchdogSchedule:[\s\S]*DependsOn: WatchdogFailureQueuePolicy[\s\S]*DeadLetterConfig:[\s\S]*Arn: !GetAtt WatchdogFailureQueue\.Arn[\s\S]*MaximumEventAgeInSeconds: 900[\s\S]*MaximumRetryAttempts: 2/u);
assert.match(watchdog, /WatchdogAsyncInvokeConfig:[\s\S]*OnFailure:[\s\S]*Destination: !GetAtt WatchdogFailureQueue\.Arn[\s\S]*MaximumEventAgeInSeconds: 900[\s\S]*MaximumRetryAttempts: 2[\s\S]*Qualifier: "\$LATEST"/u);
assert.match(watchdog, /WatchdogFailureQueueAlarm:[\s\S]*MetricName: ApproximateNumberOfMessagesVisible[\s\S]*Namespace: AWS\/SQS[\s\S]*TreatMissingData: notBreaching/u);
assert.doesNotMatch(watchdog, /AWS::Lambda::EventSourceMapping/u);
for (const marker of ["MAX_MATCHING_INSTANCES = 100", 'INSTANCE_ID = re.compile(r"^i-', '"AuthorizationId"', '"ExpiresAt"', "ec2.terminate_instances(InstanceIds=[instance_id])"]) assert.match(watchdogCode, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
assert.deepEqual(statefulAuthorization.scope.temporaryCompute.standalonePurposes, ["jank-build"]);
assert.deepEqual(statefulAuthorization.scope.temporaryCompute.profilePurposes["jank-memory"], ["jank-build"]);
assert.match(foundation, /VersioningConfiguration:\s*\n\s+Status: Enabled/gu);
assert.equal((foundation.match(/BlockPublicAcls: true/gu) ?? []).length, 3);
assert.equal((foundation.match(/SSEAlgorithm: AES256/gu) ?? []).length, 3);
assert.match(foundation, /RuntimeStateBucket:[\s\S]*DeletionPolicy: Retain[\s\S]*Value: runtime-state[\s\S]*VersioningConfiguration:\s*\n\s+Status: Enabled/u);
assert.doesNotMatch(foundation.match(/RuntimeStateBucket:[\s\S]*?(?=\n  StaticBucket:)/u)?.[0] ?? "", /NoncurrentVersionExpiration/u);
assert.match(foundation, /AWS::CloudFront::OriginAccessControl/u);

for (const principal of [
  "cloudwatch.amazonaws.com",
  "budgets.amazonaws.com",
  "costalerts.amazonaws.com",
  "events.amazonaws.com",
]) {
  assert.match(observability, new RegExp(principal.replace(".", "\\."), "u"));
}
assert.match(observability, /aws:SourceAccount: !Ref AWS::AccountId/u);
assert.match(observability, /cloudwatch:\$\{AWS::Region\}:\$\{AWS::AccountId\}:alarm:eacl-demo-\*/u);
assert.doesNotMatch(observability, /cloudwatch:\$\{AWS::Region\}:\$\{AWS::AccountId\}:alarm:\*"/u);
assert.match(observability, /TELEGRAM_SECRET_ARN: !Ref TelegramSecretArn/u);
assert.doesNotMatch(observability, /bot[_-]?token\s*:/iu);
assert.equal((observability.match(/Threshold:\s*(50|80|100)$/gmu) ?? []).length, 6);
assert.match(observability, /Frequency: IMMEDIATE/u);
assert.match(observability, /Type: SNS/u);
assert.match(observability, /ANOMALY_TOTAL_IMPACT_ABSOLUTE/u);
assert.match(observability, /CostAnomalyThresholdUsd:[\s\S]*Default: 5/u);
assert.match(observability, /ProjectCostAnomalyMonitor:[\s\S]*MonitorSpecification: '\{"Tags":\{"Key":"Project","Values":\["eacl-demo"\]\}\}'[\s\S]*MonitorType: CUSTOM/u);
assert.doesNotMatch(observability, /MonitorDimension: SERVICE/u);
assert.match(observability, /MonthlyProjectBudget:[\s\S]*CostFilters:[\s\S]*user:Project\$eacl-demo/u);
assert.match(observability, /SeedBudget:[\s\S]*CostFilters:[\s\S]*user:Workload\$eacl-demo-seed/u);
assert.match(observability, /CloudFormation Stack Status Change/u);
assert.match(observability, /stack\/eacl-demo-/u);
for (const status of ["CREATE_FAILED", "UPDATE_FAILED", "UPDATE_ROLLBACK_FAILED", "DELETE_FAILED"]) assert.match(observability, new RegExp(status, "u"));
assert.match(observability, /aws:SourceArn: !GetAtt DeploymentFailureEvents\.Arn/u);
assert.doesNotMatch(observability, /KmsMasterKeyId|TracingConfig/u);
assert.match(observability, /NotifierFailureQueue:[\s\S]*SqsManagedSseEnabled: true/u);
assert.match(observability, /NotifierFailureQueuePolicy:[\s\S]*Principal:[\s\S]*Service: sns\.amazonaws\.com[\s\S]*aws:SourceArn: !Ref AlarmTopic/u);
assert.match(observability, /PolicyName: retain-failed-notifications[\s\S]*Action: sqs:SendMessage[\s\S]*Resource: !GetAtt NotifierFailureQueue\.Arn/u);
assert.match(observability, /NotifierAsyncInvokeConfig:[\s\S]*OnFailure:[\s\S]*Destination: !GetAtt NotifierFailureQueue\.Arn[\s\S]*MaximumEventAgeInSeconds: 900[\s\S]*MaximumRetryAttempts: 2[\s\S]*Qualifier: "\$LATEST"/u);
assert.match(observability, /AlarmTopicSubscription:[\s\S]*RedrivePolicy:[\s\S]*deadLetterTargetArn: !GetAtt NotifierFailureQueue\.Arn/u);
assert.match(observability, /NotifierFailureQueueAlarm:[\s\S]*MetricName: ApproximateNumberOfMessagesVisible[\s\S]*Namespace: AWS\/SQS[\s\S]*TreatMissingData: notBreaching/u);
assert.match(observability, /AlarmRecoveryEvents:[\s\S]*CloudWatch Alarm State Change[\s\S]*previousState:[\s\S]*- ALARM[\s\S]*MaximumEventAgeInSeconds: 900[\s\S]*MaximumRetryAttempts: 2/u);
assert.match(observability, /alarm:eacl-demo-/u);
assert.match(observability, /ExactAlarmRecoveryRule[\s\S]*Service: events\.amazonaws\.com[\s\S]*sns:Publish/u);
assert.match(observability, /ExactAlarmRecoveryRuleDeliveryFailures[\s\S]*Service: events\.amazonaws\.com[\s\S]*sqs:SendMessage/u);
assert.match(observability, /ExactDeploymentFailureRuleDeliveryFailures[\s\S]*Service: events\.amazonaws\.com[\s\S]*sqs:SendMessage/u);
assert.match(observability, /DeploymentFailureEvents:[\s\S]*DependsOn: NotifierFailureQueuePolicy[\s\S]*DeadLetterConfig:[\s\S]*Arn: !GetAtt NotifierFailureQueue\.Arn[\s\S]*MaximumEventAgeInSeconds: 900[\s\S]*MaximumRetryAttempts: 2/u);
assert.doesNotMatch(observability, /AWS::Lambda::EventSourceMapping/u);
assert.doesNotMatch(observability, /OKActions:/u);
assert.doesNotMatch(watchdog, /OKActions:/u);

for (const metric of [
  "ConsumedReadCapacityUnits",
  "ConsumedWriteCapacityUnits",
  "ReadThrottleEvents",
  "WriteThrottleEvents",
  "OnDemandMaxReadRequestUnits",
  "OnDemandMaxWriteRequestUnits",
]) {
  assert.match(controls, new RegExp(metric, "u"));
}
assert.equal((controls.match(/Period: 60/gmu) ?? []).length, 7);
assert.equal((controls.match(/Threshold: (70|90)$/gmu) ?? []).length, 4);
assert.equal((controls.match(/consumed \/ 60 \/ \$\{Max(Read|Write)RequestUnits\} \* 100/gmu) ?? []).length, 4);
assert.match(controls, /AllowedValues:[\s\S]*- seed[\s\S]*- transition[\s\S]*- serving/u);
assert.match(controls, /WritesFrozen: !Not \[!Equals \[!Ref Phase, seed\]\]/u);
assert.match(controls, /Condition: WritesFrozen[\s\S]*MetricName: ConsumedWriteCapacityUnits/u);
assert.doesNotMatch(controls, /OKActions:/u);
assert.doesNotMatch(controls, /TreatMissingData: breaching/u);
assert.equal((controls.match(/TreatMissingData: notBreaching/gmu) ?? []).length, 9);

assert.match(table, /BillingMode: PAY_PER_REQUEST/u);
assert.match(table, /DeletionProtectionEnabled: true/u);
assert.match(table, /PointInTimeRecoveryEnabled: true/u);
assert.match(table, /OnDemandThroughput:/u);
assert.match(table, /DeletionPolicy: Retain/u);
assert.doesNotMatch(table, /dynamodb:(Delete|CreateTable|UpdateTable|Restore|Import|Export)/u);
assert.match(datomicTable, /AttributeName: id\s*\n\s+AttributeType: S/u);
assert.match(datomicTable, /BillingMode: PAY_PER_REQUEST/u);
assert.match(datomicTable, /DeletionProtectionEnabled: true/u);
assert.match(datomicTable, /PointInTimeRecoveryEnabled: true/u);
assert.match(datomicTable, /OnDemandThroughput:/u);
assert.doesNotMatch(datomicTable, /AWS::IAM|TemporaryWriter|InstanceProfile/u);
assert.match(datomicSeedRole, /TemporaryWriterRole:[\s\S]*TemporaryWriterInstanceProfile:/u);
assert.match(datomicSeedRole, /Sid: ExactImmutableSeedArtifact[\s\S]*Action: s3:GetObjectVersion[\s\S]*s3:VersionId: !Ref SeedArtifactObjectVersion/u);
assert.match(datomicSeedRole, /Sid: ExactImmutableFixtureStream[\s\S]*Action: s3:GetObjectVersion[\s\S]*s3:VersionId: !Ref FixtureStreamObjectVersion/u);
assert.doesNotMatch(datomicSeedRole, /dynamodb:\*|Resource:\s*["']?\*/u);
assert.doesNotMatch(datomicSeedRole, /dynamodb:(CreateTable|DeleteTable|UpdateTable|Restore|Import|Export)/u);
assert.match(datahikeSeedRole, /TemporaryWriterRole:[\s\S]*TemporaryWriterInstanceProfile:/u);
assert.match(datahikeSeedRole, /Sid: ExactImmutableSeedArtifact[\s\S]*Action: s3:GetObjectVersion[\s\S]*s3:VersionId: !Ref SeedArtifactObjectVersion/u);
assert.match(datahikeSeedRole, /Sid: ExactImmutableFixtureStream[\s\S]*Action: s3:GetObjectVersion[\s\S]*s3:VersionId: !Ref FixtureStreamObjectVersion/u);
assert.match(datahikeSeedRole, /Sid: ExactImmutableJdkArtifact[\s\S]*Action: s3:GetObjectVersion[\s\S]*s3:VersionId: !Ref JdkArtifactObjectVersion/u);
assert.match(datahikeSeedRole, /StringNotEquals:[\s\S]*s3:x-amz-server-side-encryption: AES256/u);
assert.match(datahikeSeedRole, /Sid: ExactArtifactBucketAbsenceChecks[\s\S]*Action: s3:ListBucket[\s\S]*arn:\$\{AWS::Partition\}:s3:::\$\{ArtifactBucketName\}/u);
assert.doesNotMatch(datahikeSeedRole, /dynamodb:\*|Resource:\s*["']?\*/u);
assert.doesNotMatch(datahikeSeedRole, /dynamodb:(CreateTable|DeleteTable|UpdateTable|Restore|Import|Export)/u);
assert.match(datahikeSeedNetwork, /VpcEndpointType: Gateway/u);
assert.match(datahikeSeedNetwork, /com\.amazonaws\.\$\{AWS::Region\}\.dynamodb/u);
assert.match(datahikeSeedNetwork, /com\.amazonaws\.\$\{AWS::Region\}\.s3/u);
assert.match(datahikeSeedNetwork, /MapPublicIpOnLaunch: false/u);
assert.doesNotMatch(datahikeSeedNetwork, /AWS::EC2::NatGateway|AWS::EC2::EIP|SecurityGroupIngress/u);
const datahikeDynamoEndpoint = datahikeSeedNetwork.match(/DynamoDbGatewayEndpoint:[\s\S]*?(?=\n  S3GatewayEndpoint:)/u)?.[0] ?? "";
const datahikeS3Endpoint = datahikeSeedNetwork.match(/S3GatewayEndpoint:[\s\S]*?(?=\nOutputs:)/u)?.[0] ?? "";
assert.doesNotMatch(datahikeDynamoEndpoint, /s3:/u);
assert.doesNotMatch(datahikeS3Endpoint, /dynamodb:/u);
assert.match(datahikeS3Endpoint, /Action: s3:ListBucket[\s\S]*Resource: !Sub arn:\$\{AWS::Partition\}:s3:::\$\{ArtifactBucketName\}/u);
assert.match(qualification, /Key: Lifecycle\s*\n\s+Value: disposable-qualification/u);
assert.match(qualification, /Key: ExpiresAfter/u);
assert.match(qualification, /DeletionProtectionEnabled: false/u);
assert.doesNotMatch(qualification, /dynamodb:(PutItem|BatchWriteItem|UpdateItem|DeleteItem)/u);
assert.equal((qualification.match(/ReservedConcurrentExecutions: 1/gu) ?? []).length, 2);
assert.equal((qualification.match(/Role: !GetAtt Read(Allowed|Denied)Role.Arn/gu) ?? []).length, 2);
assert.deepEqual(
  [...datahikeRuntime.matchAll(/- (dynamodb:[A-Za-z]+)/gu)].map((match) => match[1]).sort(),
  ["dynamodb:BatchGetItem", "dynamodb:DescribeTable", "dynamodb:GetItem"]
);
assert.doesNotMatch(datahikeRuntime, /dynamodb:(?:Put|Update|Delete|Create|Restore|Export|Import|Transact|BatchWrite)/u);
assert.match(datahikeRuntime, /Resource: !Sub "arn:\$\{AWS::Partition\}:dynamodb:\$\{AWS::Region\}:\$\{AWS::AccountId\}:table\/\$\{TableName\}"/u);
assert.deepEqual(
  [...datahikeS3Runtime.matchAll(/- (s3:[A-Za-z]+)/gu)].map((match) => match[1]).sort(),
  ["s3:GetObject"]
);
assert.doesNotMatch(datahikeS3Runtime, /s3:(?:Put|Delete|Create|Copy|Restore|Replicate|Abort|List)/u);
assert.match(datahikeS3Runtime, /Resource: !Sub "\$\{DataBucketArn\}\/\$\{StoreId\}_\*"/u);
assert.deepEqual(
  [...datomicServingRole.matchAll(/- (dynamodb:[A-Za-z]+)/gu)].map((match) => match[1]).sort(),
  ["dynamodb:BatchGetItem", "dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"]
);
assert.doesNotMatch(datomicServingRole, /dynamodb:(?:Put|Update|Delete|Create|Restore|Export|Import|Transact|BatchWrite)/u);
assert.match(datomicServingRole, /Resource: !Ref TableArn/u);
assert.deepEqual(policy.alarmThresholdPercent, [70, 90]);
for (const profile of Object.values(policy.profiles)) {
  assert.equal(profile.serving.maxWriteRequestUnits, 1);
  assert.ok(profile.seed.maxWriteRequestUnits <= 200);
  assert.ok(profile.serving.maxReadRequestUnits <= 250);
}

console.log("AWS foundation, notifier, budget, table, IAM, and DynamoDB cost-control audit passed");
