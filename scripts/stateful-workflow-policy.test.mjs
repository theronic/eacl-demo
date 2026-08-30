import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/stateful-datahike-dynamodb.yml", import.meta.url),
  "utf8"
);
const datomicWorkflow = await readFile(
  new URL("../.github/workflows/stateful-datomic-dynamodb.yml", import.meta.url),
  "utf8"
);
const datomicSeedWorkflow = await readFile(
  new URL("../.github/workflows/stateful-datomic-seed.yml", import.meta.url),
  "utf8"
);
const table = await readFile(
  new URL("../infra/data/datahike-dynamodb-table.yaml", import.meta.url),
  "utf8"
);
const costControls = await readFile(
  new URL("../infra/data/dynamodb-cost-controls.yaml", import.meta.url),
  "utf8"
);
const profileDefinitions = JSON.parse(await readFile(
  new URL("../packages/contracts/profiles.v1.json", import.meta.url),
  "utf8"
));
const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
const workflowFiles = (await readdir(workflowDirectory)).filter((name) => name.endsWith(".yml")).sort();
const statefulWorkflowFiles = new Set([
  "stateful-datahike-dynamodb.yml",
  "stateful-datomic-dynamodb.yml",
  "stateful-datomic-seed.yml"
]);
const ordinaryWorkflows = await Promise.all(workflowFiles
  .filter((name) => !statefulWorkflowFiles.has(name))
  .map(async (name) => ({ name, source: await readFile(new URL(name, workflowDirectory), "utf8") })));

test("stateful Datahike workflow is manual, exact-targeted, and unreachable from merge CI", () => {
  assert.match(workflow, /^\s{2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|workflow_call|workflow_run):/mu);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /CREATE:\$\{TABLE_NAME\}:\$\{GENERATION_ID\}/u);
  assert.match(workflow, /PUBLISH:\$\{TABLE_NAME\}:\$\{GENERATION_ID\}/u);
  assert.match(workflow, /TABLE_NAME" == eacl-demo-datahike-fixture-v1-green/u);
  assert.match(workflow, /GENERATION_ID" == fixture-v1-green/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /ce list-cost-allocation-tags --status Active --type UserDefined --tag-keys Project Workload/u);
  assert.doesNotMatch(workflow, /secrets\./u);
  assert.doesNotMatch(workflow, /delete-table|delete-stack|rm -/iu);
  assert.match(workflow, /Require a quiet write window[\s\S]*Phase=transition[\s\S]*StateValue!=="OK"[\s\S]*Remove seed role[\s\S]*Phase=serving[\s\S]*Verify post-transition write telemetry/u);
});

test("publication removes the seed role and keeps the table recoverable", () => {
  assert.match(table, /IsSeed: !Not \[!Condition IsServing\]/u);
  assert.match(table, /SeedRole:\s*\n\s+Type: AWS::IAM::Role\s*\n\s+Condition: IsSeed/u);
  assert.match(table, /DeletionProtectionEnabled: true/u);
  assert.match(table, /PointInTimeRecoveryEnabled: true/u);
  assert.match(table, /DeletionPolicy: Retain/u);
});

test("stateful Datomic workflow is manual, exact-targeted, alarm-first, and immutable", () => {
  assert.match(datomicWorkflow, /^\s{2}workflow_dispatch:/mu);
  assert.doesNotMatch(datomicWorkflow, /^\s{2}(?:push|pull_request|workflow_call|workflow_run):/mu);
  assert.match(datomicWorkflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(datomicWorkflow, /TABLE_NAME" == eacl-demo-datomic-fixture-v1-green/u);
  assert.match(datomicWorkflow, /GENERATION_ID" == fixture-v1-green/u);
  for (const token of [
    "CREATE:${TABLE_NAME}:${GENERATION_ID}",
    "BACKUP:${TABLE_NAME}:${GENERATION_ID}:${BACKUP_NAME}",
    "PUBLISH:${TABLE_NAME}:${GENERATION_ID}"
  ]) assert.ok(datomicWorkflow.includes(token));
  assert.match(datomicWorkflow, /Install quiet alarms before creating the table[\s\S]*Create retained protected seed generation/u);
  assert.match(datomicWorkflow, /Require a quiet write window[\s\S]*Phase=transition[\s\S]*StateValue!=="OK"[\s\S]*Apply immutable serving caps[\s\S]*Phase=serving/u);
  assert.match(datomicWorkflow, /Require temporary writer cleanup before immutable publication[\s\S]*describe-stacks[\s\S]*get-role[\s\S]*get-instance-profile[\s\S]*describe-instances[\s\S]*describe-volumes[\s\S]*describe-addresses/u);
  assert.match(datomicWorkflow, /Install immutable-serving alarms[\s\S]*Verify post-transition write telemetry remains quiet/u);
  assert.match(datomicWorkflow, /Verify exact immutable seed and normal-Peer history evidence[\s\S]*s3api get-object[\s\S]*--version-id[\s\S]*sha256sum --check --strict/u);
  assert.match(datomicWorkflow, /historyVerified[\s\S]*finalResourceCount!==1000000/u);
  assert.doesNotMatch(datomicWorkflow, /SeedArtifactObject|FixtureStreamObject|TemporaryWriter/u);
  assert.doesNotMatch(datomicWorkflow, /dynamodb wait backup-exists/u);
  assert.match(datomicWorkflow, /for attempt in \{1\.\.60\}/u);
  assert.match(datomicWorkflow, /id-token: write/u);
  assert.match(datomicWorkflow, /ce list-cost-allocation-tags --status Active --type UserDefined --tag-keys Project Workload/u);
  assert.doesNotMatch(datomicWorkflow, /secrets\.|delete-table|delete-stack|rm -/iu);
});

test("Datomic seed compute requires preview confirmation and always cleans exact temporary resources", () => {
  assert.match(datomicSeedWorkflow, /^\s{2}workflow_dispatch:/mu);
  assert.doesNotMatch(datomicSeedWorkflow, /^\s{2}(?:push|pull_request|workflow_call|workflow_run):/mu);
  assert.match(datomicSeedWorkflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(datomicSeedWorkflow, /node scripts\/datomic-seed-authorization\.mjs authorize/u);
  assert.match(datomicSeedWorkflow, /CAPABILITY_NAMED_IAM/u);
  assert.match(datomicSeedWorkflow, /AssociatePublicIpAddress=false/u);
  assert.match(datomicSeedWorkflow, /HttpTokens=required/u);
  assert.match(datomicSeedWorkflow, /ManagedBy[^\n]*eacl-demo-temp-watchdog/u);
  assert.match(datomicSeedWorkflow, /ce list-cost-allocation-tags --status Active --type UserDefined --tag-keys Project Workload/u);
  assert.match(datomicSeedWorkflow, /if: always\(\)[\s\S]*terminate-instances[\s\S]*wait instance-terminated[\s\S]*delete-stack[\s\S]*stack-delete-complete/u);
  assert.match(datomicSeedWorkflow, /remaining_volumes[\s\S]*remaining_addresses[\s\S]*get-role[\s\S]*get-instance-profile/u);
  assert.match(datomicSeedWorkflow, /post_table[\s\S]*MaxReadRequestUnits!==250[\s\S]*post_tags[\s\S]*Workload!=="eacl-demo-seed"[\s\S]*post_alarms[\s\S]*OKActions\.length!==0/u);
  assert.match(datomicSeedWorkflow, /cleanup_status=0[\s\S]*exit "\$cleanup_status"/u);
  assert.match(datomicSeedWorkflow, /stack_authorization[\s\S]*== "\$PREVIEW_ID"[\s\S]*delete-stack/u);
  assert.match(datomicSeedWorkflow, /Owner[^\n]*theronic\/eacl-demo/u);
  assert.doesNotMatch(datomicSeedWorkflow, /secrets\.|KeyName|AuthorizeSecurityGroupIngress|allocate-address|concurrency:|cancel-in-progress|max-parallel/u);
});

test("DynamoDB alarm handoff has a write guard without bootstrap OK notifications", () => {
  assert.match(costControls, /AllowedValues:[\s\S]*- seed[\s\S]*- transition[\s\S]*- serving/u);
  assert.match(costControls, /WritesFrozen: !Not \[!Equals \[!Ref Phase, seed\]\]/u);
  assert.match(costControls, /UnexpectedServingWrite:[\s\S]*Condition: WritesFrozen/u);
  assert.match(costControls, /ReadCapConfigurationDrift:[\s\S]*Condition: NotTransition/u);
  assert.match(costControls, /WriteCapConfigurationDrift:[\s\S]*Condition: NotTransition/u);
  assert.doesNotMatch(costControls, /OKActions:/u);
});

test("every ordinary workflow is structurally unable to invoke stateful data or temporary compute", () => {
  const forbidden = [
    /AWS_STATEFUL|STATEFUL_ROLE|MAINTENANCE_PRINCIPAL/u,
    /authorize:datomic-seed|preview:datomic-seed|verify:post-compute/u,
    /stateful-(?:datahike|datomic)|authorized-initial-stateful-operations/u,
    /datahike-dynamodb-table\.yaml|datomic-dynamodb-table\.yaml|dynamodb-cost-controls\.yaml/u,
    /(?:datahike|datomic)-dynamodb-seed-(?:role|network)\.yaml|temp-compute-watchdog\.yaml/u,
    /aws\s+(?:ec2\s+(?:run-instances|terminate-instances)|dynamodb\s+(?:create-table|update-table|delete-table|create-backup|restore-table|import-table|export-table))/u,
    /secrets\./u
  ];
  for (const { name, source } of ordinaryWorkflows) {
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${name} crosses the stateful authority boundary`);
  }
});

test("the automatic workflow directly deploys every public profile independently", () => {
  const automatic = ordinaryWorkflows.filter(({ source }) => /^\s{2}push:/mu.test(source));
  const publicTargets = ["static", ...profileDefinitions.profiles
    .filter(({ apiOrigin }) => typeof apiOrigin === "string" && apiOrigin.length > 0)
    .map(({ id }) => id)].sort();
  assert.equal(automatic.length, 1, "one automatic workflow must deploy the public demo catalog");
  for (const { name, source } of automatic) {
    assert.match(source, /^on:\s*\n\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- main\s*$/mu, `${name} has a non-exact main trigger`);
    assert.doesNotMatch(source, /^\s{2}(?:pull_request|workflow_call|workflow_dispatch|workflow_run|schedule):/mu);
    assert.doesNotMatch(source, /\bconcurrency:|cancel-in-progress|max-parallel|latest[-_ ]head/iu);
    if (/\bmatrix:/u.test(source)) assert.match(source, /fail-fast:\s*false/u);
    assert.match(source, /^permissions:\s*\n\s{2}contents: read\s*$/mu);
    for (const target of publicTargets) {
      assert.match(source, new RegExp(`^  deploy-${target}:`, "mu"), `${name} omits live target ${target}`);
    }
    assert.doesNotMatch(source, /^  build-|^\s{4}needs:|upload-artifact|download-artifact|change-readiness/imu);
    assert.doesNotMatch(source, /(?:build|deploy)-jank-memory/u);
  }
});
