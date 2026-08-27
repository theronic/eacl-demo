import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseTaskChecklist, validateChangeReadiness } from "./lib/change-readiness.mjs";

const root = new URL("../", import.meta.url);
const ledger = JSON.parse(await readFile(new URL("verification/change-readiness.v1.json", root), "utf8"));
const taskSource = await readFile(new URL(ledger.sourceTaskFile, root), "utf8");
const tasks = parseTaskChecklist(taskSource);

test("completion ledger covers every and only open OpenSpec task", () => {
  assert.deepEqual(validateChangeReadiness(ledger, tasks), {
    completed: 146,
    open: 59,
    total: 205,
    gateGroups: 11
  });
});

test("an omitted or duplicated task cannot disappear from the completion audit", () => {
  const omitted = structuredClone(ledger);
  omitted.gateGroups[0].taskIds.pop();
  assert.throws(() => validateChangeReadiness(omitted, tasks), /cover exactly every unchecked task/u);

  const duplicated = structuredClone(ledger);
  duplicated.gateGroups[1].taskIds.push(duplicated.gateGroups[0].taskIds[0]);
  assert.throws(() => validateChangeReadiness(duplicated, tasks), /more than one gate group/u);
});

test("checkbox and freeze drift require an explicit ledger update", () => {
  const changedTasks = tasks.map((task) => task.id === "8.4" ? { ...task, completed: true } : task);
  assert.throws(() => validateChangeReadiness(ledger, changedTasks), /completed task count drifted/u);

  const inconsistentFreeze = structuredClone(ledger);
  inconsistentFreeze.freeze.prohibitedActions = ["deployment"];
  assert.throws(() => validateChangeReadiness(inconsistentFreeze, tasks), /inactive freeze cannot prohibit actions/u);
});
