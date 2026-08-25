#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const captureDate = process.env.EACL_DEMO_CAPTURE_DATE ?? "2026-08-25";
const profile = process.env.EACL_DEMO_AWS_PROFILE ?? "petrus-prod";
const region = process.env.EACL_DEMO_AWS_REGION ?? "us-east-1";
const outputBase = resolve(
  process.env.EACL_DEMO_AWS_ESTATE_OUTPUT
    ?? join(repoRoot, "docs", "provenance", `aws-estate-${captureDate}`),
);
const relevantName = /(eacl|demo)/iu;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function redact(value, key = "") {
  if (/^(secretString|secretBinary|token|accessToken|refreshToken|password|credential|credentials|privateKey|sessionToken|awsSecretAccessKey)$/iu.test(key)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  if (typeof value === "string") {
    return value
      .replace(/AKIA[0-9A-Z]{16}/gu, "[redacted-aws-access-key]")
      .replace(/(https?:\/\/)[^/@\s]+@/gu, "$1[redacted]@");
  }
  return value;
}

function aws(service, operation, args = []) {
  const command = [
    service,
    operation,
    ...args,
    "--profile",
    profile,
    "--region",
    region,
    "--output",
    "json",
    "--no-cli-pager",
  ];
  try {
    const stdout = execFileSync("aws", command, {
      encoding: "utf8",
      env: { ...process.env, AWS_PAGER: "" },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, value: redact(JSON.parse(stdout || "null")) };
  } catch (error) {
    const stderr = String(error.stderr ?? error.message ?? "AWS command failed")
      .replace(/AKIA[0-9A-Z]{16}/gu, "[redacted-aws-access-key]")
      .trim();
    return { ok: false, error: stderr.slice(0, 2_000) };
  }
}

function valueOf(result, fallback) {
  return result.ok ? result.value : fallback;
}

const capturedAt = new Date().toISOString();
const identity = aws("sts", "get-caller-identity");
const accountId = identity.ok ? identity.value.Account : null;

const cloudFormationResult = aws("cloudformation", "list-stacks", [
  "--stack-status-filter",
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "UPDATE_ROLLBACK_COMPLETE",
  "IMPORT_COMPLETE",
  "IMPORT_ROLLBACK_COMPLETE",
]);
const stacks = valueOf(cloudFormationResult, { StackSummaries: [] }).StackSummaries
  ?.filter((stack) => relevantName.test(stack.StackName))
  .map(({ StackId, StackName, StackStatus, CreationTime, LastUpdatedTime }) => ({
    StackId,
    StackName,
    StackStatus,
    CreationTime,
    LastUpdatedTime,
  })) ?? [];
for (const stack of stacks) {
  stack.resources = valueOf(
    aws("cloudformation", "list-stack-resources", ["--stack-name", stack.StackId]),
    { StackResourceSummaries: [] },
  )?.StackResourceSummaries ?? [];
}

const lambdaResult = aws("lambda", "list-functions");
const functions = valueOf(lambdaResult, { Functions: [] }).Functions
  ?.filter((fn) => relevantName.test(fn.FunctionName))
  .map(({ FunctionName, FunctionArn, Runtime, Architectures, LastModified, Version, MemorySize, Timeout, State, PackageType, Role, CodeSha256 }) => ({
    FunctionName,
    FunctionArn,
    Runtime,
    Architectures,
    LastModified,
    Version,
    MemorySize,
    Timeout,
    State,
    PackageType,
    Role,
    CodeSha256,
  })) ?? [];
for (const fn of functions) {
  fn.aliases = valueOf(aws("lambda", "list-aliases", ["--function-name", fn.FunctionName]), { Aliases: [] }).Aliases
    ?.map(({ AliasArn, Name, FunctionVersion, Description }) => ({ AliasArn, Name, FunctionVersion, Description })) ?? [];
  fn.functionUrls = valueOf(aws("lambda", "list-function-url-configs", ["--function-name", fn.FunctionName]), { FunctionUrlConfigs: [] }).FunctionUrlConfigs
    ?.map(({ FunctionUrl, FunctionArn, AuthType, Cors, CreationTime, LastModifiedTime, InvokeMode }) => ({
      FunctionUrl,
      FunctionArn,
      AuthType,
      Cors,
      CreationTime,
      LastModifiedTime,
      InvokeMode,
    })) ?? [];
}

const tableResult = aws("dynamodb", "list-tables");
const tables = [];
for (const tableName of valueOf(tableResult, { TableNames: [] }).TableNames?.filter((name) => relevantName.test(name)) ?? []) {
  const description = valueOf(aws("dynamodb", "describe-table", ["--table-name", tableName]), {}).Table ?? null;
  const continuousBackups = valueOf(aws("dynamodb", "describe-continuous-backups", ["--table-name", tableName]), {}).ContinuousBackupsDescription ?? null;
  const backups = valueOf(aws("dynamodb", "list-backups", ["--table-name", tableName, "--backup-type", "ALL"]), { BackupSummaries: [] }).BackupSummaries ?? [];
  tables.push({ tableName, description, continuousBackups, backups });
}

const bucketResult = aws("s3api", "list-buckets");
const buckets = [];
for (const bucket of valueOf(bucketResult, { Buckets: [] }).Buckets?.filter(({ Name }) => relevantName.test(Name)) ?? []) {
  const name = bucket.Name;
  buckets.push({
    ...bucket,
    location: valueOf(aws("s3api", "get-bucket-location", ["--bucket", name]), null),
    versioning: valueOf(aws("s3api", "get-bucket-versioning", ["--bucket", name]), null),
    encryption: valueOf(aws("s3api", "get-bucket-encryption", ["--bucket", name]), null),
    publicAccessBlock: valueOf(aws("s3api", "get-public-access-block", ["--bucket", name]), null),
  });
}

const alarmResult = aws("cloudwatch", "describe-alarms");
const metricAlarms = valueOf(alarmResult, { MetricAlarms: [] }).MetricAlarms
  ?.filter((alarm) => relevantName.test(alarm.AlarmName)) ?? [];
const compositeAlarms = valueOf(alarmResult, { CompositeAlarms: [] }).CompositeAlarms
  ?.filter((alarm) => relevantName.test(alarm.AlarmName)) ?? [];

const topicResult = aws("sns", "list-topics");
const topics = valueOf(topicResult, { Topics: [] }).Topics
  ?.filter(({ TopicArn }) => relevantName.test(TopicArn)) ?? [];
for (const topic of topics) {
  topic.subscriptions = valueOf(
    aws("sns", "list-subscriptions-by-topic", ["--topic-arn", topic.TopicArn]),
    { Subscriptions: [] },
  )?.Subscriptions?.map(({ SubscriptionArn, Protocol, Endpoint, Owner }) => ({
    SubscriptionArn,
    Protocol,
    Endpoint: Endpoint?.startsWith("arn:") ? Endpoint : "[redacted-non-arn-endpoint]",
    Owner,
  })) ?? [];
}

const secretResult = aws("secretsmanager", "list-secrets", ["--include-planned-deletion"]);
const secrets = valueOf(secretResult, { SecretList: [] }).SecretList
  ?.filter(({ Name, Description = "", Tags = [] }) => relevantName.test(Name) || relevantName.test(Description) || Tags.some(({ Key, Value = "" }) => relevantName.test(Key) || relevantName.test(Value)))
  .map(({ ARN, Name, Description, LastChangedDate, LastAccessedDate, CreatedDate, PrimaryRegion, OwningService, Tags }) => ({
    ARN,
    Name,
    Description,
    LastChangedDate,
    LastAccessedDate,
    CreatedDate,
    PrimaryRegion,
    OwningService,
    Tags,
    valueCaptured: false,
  })) ?? [];

const taggedResult = aws("resourcegroupstaggingapi", "get-resources");
const taggedResources = valueOf(taggedResult, { ResourceTagMappingList: [] }).ResourceTagMappingList
  ?.filter(({ ResourceARN, Tags = [] }) => relevantName.test(ResourceARN) || Tags.some(({ Key, Value = "" }) => relevantName.test(Key) || relevantName.test(Value))) ?? [];

const cloudFrontResult = aws("cloudfront", "list-distributions");
const distributions = valueOf(cloudFrontResult, { DistributionList: { Items: [] } }).DistributionList?.Items
  ?.filter((distribution) => {
    const aliases = distribution.Aliases?.Items ?? [];
    const origins = distribution.Origins?.Items?.map(({ DomainName }) => DomainName) ?? [];
    return aliases.some((alias) => relevantName.test(alias)) || origins.some((origin) => relevantName.test(origin));
  })
  .map(({ Id, ARN, Status, DomainName, LastModifiedTime, Enabled, Aliases, Origins, DefaultCacheBehavior, CacheBehaviors, ViewerCertificate }) => ({
    Id,
    ARN,
    Status,
    DomainName,
    LastModifiedTime,
    Enabled,
    Aliases,
    Origins,
    DefaultCacheBehavior,
    CacheBehaviors,
    ViewerCertificate,
  })) ?? [];

const hostedZoneResult = aws("route53", "list-hosted-zones");
const hostedZones = [];
for (const zone of valueOf(hostedZoneResult, { HostedZones: [] }).HostedZones?.filter(({ Name }) => Name.endsWith("eacl.dev.")) ?? []) {
  const recordResult = aws("route53", "list-resource-record-sets", ["--hosted-zone-id", zone.Id]);
  const records = valueOf(recordResult, { ResourceRecordSets: [] }).ResourceRecordSets
    ?.filter((record) => record.Name.endsWith("eacl.dev.") && !["TXT", "SPF", "CAA"].includes(record.Type)) ?? [];
  hostedZones.push({ zone, records });
}

const certificateResult = aws("acm", "list-certificates", ["--certificate-statuses", "ISSUED", "PENDING_VALIDATION", "EXPIRED", "REVOKED", "FAILED"]);
const certificates = [];
for (const summary of valueOf(certificateResult, { CertificateSummaryList: [] }).CertificateSummaryList
  ?.filter(({ DomainName, SubjectAlternativeNameSummaries = [] }) => relevantName.test(DomainName) || SubjectAlternativeNameSummaries.some((name) => relevantName.test(name))) ?? []) {
  const certificate = valueOf(aws("acm", "describe-certificate", ["--certificate-arn", summary.CertificateArn]), {}).Certificate ?? null;
  if (certificate) {
    const { CertificateArn, DomainName, SubjectAlternativeNames, Status, Type, KeyAlgorithm, SignatureAlgorithm, InUseBy, NotBefore, NotAfter, RenewalEligibility } = certificate;
    certificates.push({ CertificateArn, DomainName, SubjectAlternativeNames, Status, Type, KeyAlgorithm, SignatureAlgorithm, InUseBy, NotBefore, NotAfter, RenewalEligibility });
  }
}

const instancesResult = aws("ec2", "describe-instances", [
  "--filters",
  "Name=instance-state-name,Values=pending,running,stopping,stopped",
]);
const instances = valueOf(instancesResult, { Reservations: [] }).Reservations
  ?.flatMap(({ Instances = [] }) => Instances)
  .filter((instance) => {
    const tags = instance.Tags ?? [];
    return tags.some(({ Key, Value }) => relevantName.test(Key) || relevantName.test(Value));
  })
  .map(({ InstanceId, InstanceType, ImageId, Architecture, LaunchTime, State, IamInstanceProfile, SubnetId, VpcId, SecurityGroups, Tags, BlockDeviceMappings }) => ({
    InstanceId,
    InstanceType,
    ImageId,
    Architecture,
    LaunchTime,
    State,
    IamInstanceProfile,
    SubnetId,
    VpcId,
    SecurityGroups,
    Tags,
    BlockDeviceMappings,
  })) ?? [];
const relevantInstanceIds = new Set(instances.map(({ InstanceId }) => InstanceId));
const volumesResult = aws("ec2", "describe-volumes");
const volumes = valueOf(volumesResult, { Volumes: [] }).Volumes
  ?.filter((volume) => (volume.Tags ?? []).some(({ Key, Value }) => relevantName.test(Key) || relevantName.test(Value))
    || (volume.Attachments ?? []).some(({ InstanceId }) => relevantInstanceIds.has(InstanceId)))
  .map(({ VolumeId, AvailabilityZone, CreateTime, Encrypted, KmsKeyId, Size, SnapshotId, State, VolumeType, Attachments, Tags }) => ({
    VolumeId,
    AvailabilityZone,
    CreateTime,
    Encrypted,
    KmsKeyId: KmsKeyId ? "[aws-managed-or-customer-key-arn-redacted]" : null,
    Size,
    SnapshotId,
    State,
    VolumeType,
    Attachments,
    Tags,
  })) ?? [];
const addressesResult = aws("ec2", "describe-addresses");
const addresses = valueOf(addressesResult, { Addresses: [] }).Addresses
  ?.filter((address) => relevantInstanceIds.has(address.InstanceId)
    || (address.Tags ?? []).some(({ Key, Value }) => relevantName.test(Key) || relevantName.test(Value)))
  .map(({ AllocationId, AssociationId, Domain, InstanceId, NetworkInterfaceId, PublicIp, Tags }) => ({
    AllocationId,
    AssociationId,
    Domain,
    InstanceId,
    NetworkInterfaceId,
    PublicIp,
    Tags,
  })) ?? [];
const snapshotsResult = aws("ec2", "describe-snapshots", ["--owner-ids", "self"]);
const snapshots = valueOf(snapshotsResult, { Snapshots: [] }).Snapshots
  ?.filter((snapshot) => relevantName.test(snapshot.Description ?? "")
    || (snapshot.Tags ?? []).some(({ Key, Value }) => relevantName.test(Key) || relevantName.test(Value))
    || volumes.some(({ VolumeId }) => VolumeId === snapshot.VolumeId))
  .map(({ SnapshotId, Description, Encrypted, KmsKeyId, OwnerId, Progress, StartTime, State, VolumeId, VolumeSize, Tags }) => ({
    SnapshotId,
    Description,
    Encrypted,
    KmsKeyId: KmsKeyId ? "[aws-managed-or-customer-key-arn-redacted]" : null,
    OwnerId,
    Progress,
    StartTime,
    State,
    VolumeId,
    VolumeSize,
    Tags,
  })) ?? [];
const imagesResult = aws("ec2", "describe-images", ["--owners", "self"]);
const images = valueOf(imagesResult, { Images: [] }).Images
  ?.filter((image) => relevantName.test(image.Name ?? "")
    || relevantName.test(image.Description ?? "")
    || (image.Tags ?? []).some(({ Key, Value }) => relevantName.test(Key) || relevantName.test(Value)))
  .map(({ ImageId, Architecture, BlockDeviceMappings, CreationDate, Description, EnaSupport, ImageLocation, ImageType, Name, PlatformDetails, RootDeviceName, RootDeviceType, State, Tags, VirtualizationType }) => ({
    ImageId,
    Architecture,
    BlockDeviceMappings,
    CreationDate,
    Description,
    EnaSupport,
    ImageLocation,
    ImageType,
    Name,
    PlatformDetails,
    RootDeviceName,
    RootDeviceType,
    State,
    Tags,
    VirtualizationType,
  })) ?? [];

const backupVaultResult = aws("backup", "list-backup-vaults");
const backupVaults = valueOf(backupVaultResult, { BackupVaultList: [] }).BackupVaultList
  ?.filter(({ BackupVaultName, BackupVaultArn }) => relevantName.test(BackupVaultName) || relevantName.test(BackupVaultArn)) ?? [];

const budgetsResult = accountId
  ? aws("budgets", "describe-budgets", ["--account-id", accountId])
  : { ok: false, error: "Account ID unavailable" };
const budgets = (valueOf(budgetsResult, { Budgets: [] }) ?? { Budgets: [] }).Budgets
  ?.filter(({ BudgetName }) => relevantName.test(BudgetName)) ?? [];

const anomalyMonitorsResult = aws("ce", "get-anomaly-monitors");
const anomalyMonitors = (valueOf(anomalyMonitorsResult, { AnomalyMonitors: [] }) ?? { AnomalyMonitors: [] }).AnomalyMonitors
  ?.filter(({ MonitorName }) => relevantName.test(MonitorName)) ?? [];
const anomalySubscriptionsResult = aws("ce", "get-anomaly-subscriptions");
const anomalySubscriptions = (valueOf(anomalySubscriptionsResult, { AnomalySubscriptions: [] }) ?? { AnomalySubscriptions: [] }).AnomalySubscriptions
  ?.filter(({ SubscriptionName }) => relevantName.test(SubscriptionName)) ?? [];

const publicHostnames = [
  "demo.eacl.dev",
  "serverless-datahike.demo.eacl.dev",
  "explorer.eacl.dev",
];
const publicIdentities = publicHostnames.map((hostname) => {
  let addresses = [];
  try {
    addresses = execFileSync("dig", ["+short", hostname], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    addresses = [];
  }
  return { hostname, addresses };
});

const failures = {
  identity,
  cloudFormation: cloudFormationResult,
  lambda: lambdaResult,
  dynamodb: tableResult,
  s3: bucketResult,
  cloudwatch: alarmResult,
  sns: topicResult,
  secrets: secretResult,
  taggedResources: taggedResult,
  cloudfront: cloudFrontResult,
  route53: hostedZoneResult,
  acm: certificateResult,
  ec2: instancesResult,
  volumes: volumesResult,
  addresses: addressesResult,
  snapshots: snapshotsResult,
  images: imagesResult,
  backup: backupVaultResult,
  budgets: budgetsResult,
  anomalyMonitors: anomalyMonitorsResult,
  anomalySubscriptions: anomalySubscriptionsResult,
};
const commandFailures = Object.fromEntries(
  Object.entries(failures).filter(([, result]) => !result.ok).map(([name, result]) => [name, result.error]),
);

const evidence = redact({
  schema: "eacl-demo.aws-estate.v1",
  capturedAt,
  profile,
  region,
  accountIdentity: valueOf(identity, null),
  filters: {
    resources: "Names, aliases, origins, domains, or tags containing eacl or demo",
    dns: "Non-TXT records below eacl.dev",
    ec2: "Pending/running/stopping/stopped instances tagged with an eacl/demo key or value",
  },
  resources: {
    stacks,
    functions,
    tables,
    buckets,
    alarms: { metricAlarms, compositeAlarms },
    topics,
    secrets,
    taggedResources,
    distributions,
    hostedZones,
    certificates,
    instances,
    volumes,
    addresses,
    snapshots,
    images,
    backupVaults,
    budgets,
    anomalyMonitors,
    anomalySubscriptions,
  },
  publicIdentities,
  commandFailures,
});
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;

function names(items, field) {
  return items.length === 0 ? "none" : items.map((item) => `\`${item[field]}\``).join(", ");
}

const markdown = `# AWS estate provenance

Captured at \`${capturedAt}\` from profile \`${profile}\` in \`${region}\` for OpenSpec task 1.2. The JSON companion is authoritative and has SHA-256 \`${sha256(serialized)}\`.

This capture used read-only AWS APIs. It deliberately excludes Lambda environment variables, secret values, DNS TXT records, certificate validation records, credentials, and unrelated account resources.

## Identity

- Account: \`${accountId ?? "unavailable"}\`
- ARN: \`${identity.ok ? identity.value.Arn : "unavailable"}\`
- Region: \`${region}\`

## Relevant resources

- CloudFormation stacks: ${names(stacks, "StackName")}
- Lambda functions: ${names(functions, "FunctionName")}
- DynamoDB tables: ${tables.length === 0 ? "none" : tables.map(({ tableName }) => `\`${tableName}\``).join(", ")}
- S3 buckets: ${names(buckets, "Name")}
- CloudWatch metric alarms: ${names(metricAlarms, "AlarmName")}
- CloudWatch composite alarms: ${names(compositeAlarms, "AlarmName")}
- SNS topics: ${topics.length === 0 ? "none" : topics.map(({ TopicArn }) => `\`${TopicArn}\``).join(", ")}
- Secrets Manager metadata (values never read): ${names(secrets, "Name")}
- CloudFront distributions: ${names(distributions, "Id")}
- ACM certificates: ${names(certificates, "DomainName")}
- Tagged active/stopped EC2 instances: ${names(instances, "InstanceId")}
- Relevant EBS volumes: ${names(volumes, "VolumeId")}
- Relevant Elastic IPs: ${names(addresses, "AllocationId")}
- Relevant EBS snapshots: ${names(snapshots, "SnapshotId")}
- Relevant owned AMIs: ${names(images, "ImageId")}
- AWS Backup vaults: ${names(backupVaults, "BackupVaultName")}
- Budgets: ${names(budgets, "BudgetName")}
- Cost anomaly monitors: ${names(anomalyMonitors, "MonitorName")}

## Public identities

${publicIdentities.map(({ hostname, addresses }) => `- \`${hostname}\`: ${addresses.length === 0 ? "unresolved" : addresses.map((address) => `\`${address}\``).join(", ")}`).join("\n")}

## Capture failures

${Object.keys(commandFailures).length === 0 ? "None." : Object.entries(commandFailures).map(([name, error]) => `- \`${name}\`: ${error}`).join("\n")}
`;

mkdirSync(dirname(outputBase), { recursive: true });
writeFileSync(`${outputBase}.json`, serialized);
writeFileSync(`${outputBase}.md`, markdown);
console.log(`${outputBase}.json`);
console.log(`${outputBase}.md`);
