import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtime = await readFile(
  new URL("../packages/contracts/src/eacl_demo/contracts/observability.clj", import.meta.url),
  "utf8"
);
const alarms = await readFile(
  new URL("../infra/observability/profile-runtime.yaml", import.meta.url),
  "utf8"
);
const central = await readFile(
  new URL("../infra/observability/template.yaml", import.meta.url),
  "utf8"
);
const build = await readFile(new URL("../build.clj", import.meta.url), "utf8");
const jankRuntime = await readFile(
  new URL("../services/jank-memory/src/eacl_demo/jank_memory/observability.jank", import.meta.url),
  "utf8"
);
const jankMain = await readFile(
  new URL("../services/jank-memory/src/eacl_demo/jank_memory/main.jank", import.meta.url),
  "utf8"
);
const handlers = await Promise.all([
  "datahike-s3/src/eacl_demo/datahike_s3/lambda_handler.clj",
  "datahike-dynamodb/src/eacl_demo/datahike_dynamodb/lambda_handler.clj",
  "datomic-dynamodb/src/eacl_demo/datomic_dynamodb/lambda_handler.clj"
].map((path) => readFile(new URL(`../services/${path}`, import.meta.url), "utf8")));

test("qualified JVM handlers package and invoke the closed EMF telemetry", () => {
  assert.match(build, /contracts\/observability\.clj/u);
  for (const handler of handlers) {
    assert.match(handler, /contracts\.observability/u);
    assert.match(handler, /initialize-with-telemetry!/u);
    assert.match(handler, /observe-response!/u);
    assert.match(handler, /observe-exception!/u);
  }
  for (const signal of [
    "Requests", "Errors", "Duration", "Initialization", "Restore",
    "Throttles", "Timeouts", "OOM", "Storage"
  ]) assert.equal(runtime.includes(`{"Name" "${signal}"`), true);
  assert.match(runtime, /EaclDemo\/Runtime/u);
  assert.doesNotMatch(runtime, /stack-trace|\.getMessage|Throwable->map|AWS_SECRET/iu);
});

test("the Jank custom runtime invokes the same closed redacted EMF contract", () => {
  assert.match(jankMain, /jank-memory\.observability/u);
  assert.match(jankMain, /initialize-with-telemetry!/u);
  assert.match(jankMain, /observe-response!/u);
  assert.match(jankMain, /observe-exception!/u);
  assert.match(jankRuntime, /eacl-demo\.runtime-telemetry\.v1/u);
  assert.match(jankRuntime, /EaclDemo\/Runtime/u);
  assert.match(jankRuntime, /maximum-record-bytes 8192/u);
  for (const signal of [
    "Requests", "Errors", "Duration", "Initialization", "Restore",
    "Throttles", "Timeouts", "OOM", "Storage"
  ]) assert.equal(jankRuntime.includes(`{"Name" "${signal}"`), true);
  assert.doesNotMatch(jankRuntime, /stack-trace|errorMessage|AWS_SECRET|response data|request body/iu);
});

test("profile alarms are exact, quiet on missing data, and never define OK actions", () => {
  assert.equal((alarms.match(/Type: AWS::CloudWatch::Alarm/gmu) ?? []).length, 7);
  for (const suffix of [
    "duration", "errors", "health", "initialization", "oom", "throttles", "timeouts"
  ]) assert.equal(alarms.includes(`AlarmName: !Sub "eacl-demo-\${ProfileId}-${suffix}"`), true);
  assert.equal((alarms.match(/TreatMissingData: notBreaching/gmu) ?? []).length, 7);
  assert.equal((alarms.match(/AlarmActions: \[!Ref AlarmTopicArn\]/gmu) ?? []).length, 7);
  assert.doesNotMatch(alarms, /OKActions:|Kms|AWS::KMS|kms:/iu);
  assert.match(alarms, /Name: AlarmClass\s*\n\s*Value: health/u);
  assert.match(alarms, /Name: AlarmClass\s*\n\s*Value: initialization/u);
});

test("one consolidated runtime dashboard covers the closed signals", () => {
  assert.equal((central.match(/Type: AWS::CloudWatch::Dashboard/gmu) ?? []).length, 1);
  assert.match(central, /DashboardName: eacl-demo-runtime/u);
  for (const metric of [
    "Requests", "Errors", "Duration", "Initialization", "Restore",
    "Throttles", "Timeouts", "OOM", "Storage"
  ]) assert.equal(central.includes(`MetricName=\\"${metric}\\"`), true);
});

test("central cost notifications are project-scoped and exclude unrelated account alarms", () => {
  assert.match(central, /alarm:eacl-demo-\*/u);
  assert.doesNotMatch(central, /alarm:\*"/u);
  assert.match(central, /MonthlyProjectBudget:[\s\S]*user:Project\$eacl-demo/u);
  assert.match(central, /SeedBudget:[\s\S]*user:Workload\$eacl-demo-seed/u);
  assert.match(central, /ExistingProjectCostAnomalyMonitorArn:[\s\S]*anomalymonitor/u);
  assert.match(central, /CreateProjectCostAnomalyMonitor: !Equals \[!Ref ExistingProjectCostAnomalyMonitorArn, ""\]/u);
  assert.match(central, /ProjectCostAnomalyMonitor:[\s\S]*Condition: CreateProjectCostAnomalyMonitor[\s\S]*"Key":"user:Project"[\s\S]*"eacl-demo"[\s\S]*MonitorType: CUSTOM/u);
  assert.match(central, /MonitorArnList:[\s\S]*CreateProjectCostAnomalyMonitor[\s\S]*!Ref ProjectCostAnomalyMonitor[\s\S]*!Ref ExistingProjectCostAnomalyMonitorArn/u);
  assert.match(central, /CostAnomalyThresholdUsd:[\s\S]*Default: 5/u);
  assert.doesNotMatch(central, /MonitorDimension: SERVICE|OKActions:/u);
});
