import { readFile } from "node:fs/promises";

import { parseTaskChecklist, validateChangeReadiness } from "./lib/change-readiness.mjs";

const root = new URL("../", import.meta.url);
const ledger = JSON.parse(await readFile(new URL("verification/change-readiness.v1.json", root), "utf8"));
const taskSource = await readFile(new URL(ledger.sourceTaskFile, root), "utf8");
const result = validateChangeReadiness(ledger, parseTaskChecklist(taskSource));

console.log(`${result.completed}/${result.total} complete; ${result.open} open across ${result.gateGroups} explicit gates`);
