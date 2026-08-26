import assert from "node:assert/strict";

const TASK = /^- \[([ x])\] (\d+\.\d+) (.+)$/gmu;
const TASK_ID = /^\d+\.\d+$/u;
const DISPOSITIONS = new Set([
  "awaiting-separate-authorization",
  "blocked-by-external-prerequisite",
  "blocked-by-live-evidence"
]);

export function parseTaskChecklist(source) {
  const tasks = [];
  for (const match of source.matchAll(TASK)) {
    tasks.push(Object.freeze({
      id: match[2],
      completed: match[1] === "x",
      description: match[3]
    }));
  }
  assert.ok(tasks.length > 0, "OpenSpec task checklist is empty");
  const ids = tasks.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "OpenSpec task IDs are not unique");
  return Object.freeze(tasks);
}

export function validateChangeReadiness(ledger, tasks) {
  exactKeys(ledger, [
    "schema", "schemaVersion", "change", "sourceTaskFile", "expected",
    "freeze", "gateGroups"
  ], "change readiness ledger");
  assert.equal(ledger.schema, "eacl-demo.change-readiness.v1");
  assert.equal(ledger.schemaVersion, 1);
  assert.equal(ledger.change, "consolidate-eacl-demo-backends");
  assert.equal(
    ledger.sourceTaskFile,
    "openspec/changes/consolidate-eacl-demo-backends/tasks.md"
  );

  exactKeys(ledger.expected, ["completed", "open", "total"], "expected counts");
  const completed = tasks.filter(({ completed: value }) => value);
  const open = tasks.filter(({ completed: value }) => !value);
  assert.equal(ledger.expected.completed, completed.length, "completed task count drifted");
  assert.equal(ledger.expected.open, open.length, "open task count drifted");
  assert.equal(ledger.expected.total, tasks.length, "total task count drifted");
  assert.equal(
    ledger.expected.completed + ledger.expected.open,
    ledger.expected.total,
    "expected task counts are inconsistent"
  );

  exactKeys(ledger.freeze, ["active", "reason", "prohibitedActions"], "freeze");
  assert.equal(ledger.freeze.active, true, "external mutation freeze must remain active");
  assertNonempty(ledger.freeze.reason, "freeze reason");
  assert.deepEqual(
    [...ledger.freeze.prohibitedActions].sort(),
    [
      "aws-mutation",
      "aws-reauthentication",
      "chrome-mutation",
      "deployment",
      "durable-seeding",
      "ec2-launch",
      "github-mutation",
      "telegram-test"
    ].sort(),
    "freeze action set drifted"
  );

  assert.ok(Array.isArray(ledger.gateGroups) && ledger.gateGroups.length > 0, "gate groups are empty");
  const groupIds = [];
  const mappedTaskIds = [];
  for (const group of ledger.gateGroups) {
    exactKeys(group, [
      "id", "disposition", "taskIds", "condition", "requiredEvidence",
      "safeActionNow"
    ], `gate group ${group?.id ?? "unknown"}`);
    assert.match(group.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.ok(DISPOSITIONS.has(group.disposition), `invalid disposition for ${group.id}`);
    assert.ok(Array.isArray(group.taskIds) && group.taskIds.length > 0, `empty task list for ${group.id}`);
    assert.equal(new Set(group.taskIds).size, group.taskIds.length, `duplicate task in ${group.id}`);
    for (const taskId of group.taskIds) assert.match(taskId, TASK_ID, `invalid task ID in ${group.id}`);
    assertNonempty(group.condition, `condition for ${group.id}`);
    assert.ok(Array.isArray(group.requiredEvidence) && group.requiredEvidence.length > 0, `required evidence is empty for ${group.id}`);
    for (const value of group.requiredEvidence) assertNonempty(value, `required evidence for ${group.id}`);
    assertNonempty(group.safeActionNow, `safe action for ${group.id}`);
    groupIds.push(group.id);
    mappedTaskIds.push(...group.taskIds);
  }
  assert.equal(new Set(groupIds).size, groupIds.length, "gate group IDs are not unique");
  assert.equal(new Set(mappedTaskIds).size, mappedTaskIds.length, "an open task appears in more than one gate group");

  const actualOpen = open.map(({ id }) => id).sort(compareTaskIds);
  const mappedOpen = [...mappedTaskIds].sort(compareTaskIds);
  assert.deepEqual(mappedOpen, actualOpen, "gate groups must cover exactly every unchecked task");

  const completedIds = new Set(completed.map(({ id }) => id));
  for (const taskId of mappedTaskIds) {
    assert.equal(completedIds.has(taskId), false, `completed task ${taskId} remains in an open gate group`);
  }

  return Object.freeze({
    completed: completed.length,
    open: open.length,
    total: tasks.length,
    gateGroups: ledger.gateGroups.length
  });
}

function exactKeys(value, keys, name) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${name} has unknown or missing fields`);
}

function assertNonempty(value, name) {
  assert.equal(typeof value, "string", `${name} must be a string`);
  assert.ok(value.trim().length > 0, `${name} must not be empty`);
}

function compareTaskIds(left, right) {
  const [leftSection, leftTask] = left.split(".").map(Number);
  const [rightSection, rightTask] = right.split(".").map(Number);
  return leftSection - rightSection || leftTask - rightTask;
}
