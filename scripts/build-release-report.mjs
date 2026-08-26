import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createPreReleaseReport, renderReleaseReportMarkdown } from "./lib/release-report.mjs";

const root = path.resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "--check";
if (!new Set(["--check", "--write"]).has(mode)) throw new Error("usage: node scripts/build-release-report.mjs [--check|--write]");

const sourcePaths = [
  "dependencies/eacl-core.lock.json",
  "infra/observability/profile-runtime.yaml",
  "infra/observability/template.yaml",
  "infra/data/dynamodb-cost-controls.yaml",
  "infra/data/dynamodb-cap-policy.v1.json",
  "infra/profiles/datahike-s3-runtime.yaml",
  "infra/profiles/datahike-dynamodb-runtime.yaml",
  "infra/profiles/datomic-dynamodb-runtime.yaml",
  "infra/profiles/datalevin-memory-runtime.yaml",
  "infra/profiles/jank-memory-runtime.yaml"
];
const readText = (relative) => readFile(path.join(root, relative), "utf8");
const readJson = async (relative) => JSON.parse(await readText(relative));
const sources = Object.fromEntries(await Promise.all(sourcePaths.map(async (relative) => [relative, await readText(relative)])));
const registry = await readJson("registry/profile-registry.v1.json");
const report = createPreReleaseReport({
  registry,
  profileDefinitions: await readJson("packages/contracts/profiles.v1.json"),
  buildUnits: await readJson("build-units.json"),
  eaclLock: JSON.parse(sources["dependencies/eacl-core.lock.json"]),
  fixtureManifests: await Promise.all([
    readJson("fixtures/manifests/fixture-10000.v1.json"),
    readJson("fixtures/manifests/fixture-1000000.v1.json")
  ]),
  benchmarkEvidenceRecords: await Promise.all(registry.benchmarkEvidence.map(async ({ path: relative }) => ({
    path: relative,
    source: await readText(relative)
  }))),
  sources
});
const outputs = new Map([
  ["registry/release-report.v1.json", `${JSON.stringify(report, null, 2)}\n`],
  ["docs/release-report.md", renderReleaseReportMarkdown(report)]
]);

if (mode === "--write") {
  for (const [relative, content] of outputs) {
    const output = path.join(root, relative);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, content);
  }
  console.log(`wrote ${[...outputs.keys()].join(", ")}`);
} else {
  for (const [relative, expected] of outputs) {
    const actual = await readText(relative).catch(() => null);
    if (actual !== expected) throw new Error(`${relative} is missing or stale; run npm run build:release-report`);
  }
  console.log(`verified ${report.reportId}`);
}
