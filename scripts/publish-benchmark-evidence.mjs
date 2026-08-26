import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createBenchmarkEvidenceIndex } from "../packages/explorer-state/src/benchmark-publication.mjs";
import { evidenceFileDigest } from "../packages/explorer-state/src/profile-registry-node.mjs";
import { validateFastestEvidence } from "../packages/explorer-state/src/fastest-evidence.mjs";

const root = path.resolve(import.meta.dirname, "..");
const requested = process.argv[2];
const publishedAt = process.argv[3];
if (!requested || path.isAbsolute(requested) || !/^registry\/benchmark-evidence\/[a-z0-9._-]+\.json$/u.test(requested)) {
  throw new Error("usage: node scripts/publish-benchmark-evidence.mjs registry/benchmark-evidence/<evidence>.json <published-at>");
}
if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("published-at must be an explicit ISO-8601 timestamp");

const target = path.resolve(root, requested);
if (!target.startsWith(`${path.join(root, "registry", "benchmark-evidence")}${path.sep}`)) throw new Error("evidence path escapes the registry directory");
const targetBytes = await readFile(target);
validateFastestEvidence(JSON.parse(targetBytes));

const evidenceRecords = [];
for (const name of (await readdir(path.dirname(target))).filter((entry) => entry.endsWith(".json") && entry !== "index.v1.json").sort()) {
  const bytes = await readFile(path.join(path.dirname(target), name));
  const evidence = JSON.parse(bytes);
  validateFastestEvidence(evidence);
  evidenceRecords.push({ evidence, path: `registry/benchmark-evidence/${name}`, sha256: evidenceFileDigest(bytes) });
}

const index = await createBenchmarkEvidenceIndex({ evidenceRecords, publishedAt }, { now: publishedAt });
await writeFile(path.join(path.dirname(target), "index.v1.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`${requested}\t${JSON.parse(targetBytes).evidenceId}\t${index.indexId}`);
