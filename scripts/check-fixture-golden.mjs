import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import { accountServerCount, sample64 } from "../packages/fixture-generator/generator.mjs";

const [small, large] = await Promise.all([
  readJson("../fixtures/manifests/fixture-10000.v1.json"),
  readJson("../fixtures/manifests/fixture-1000000.v1.json")
]);
const values = [
  ["algorithm.id", small.algorithm.id],
  ["algorithm.version", small.algorithm.version],
  ["algorithm.seed", small.algorithm.seed],
  ["sample.account-8.stream-0.unsigned", sample64(8, 0).toString()],
  ["sample.account-8.stream-0.signed", BigInt.asIntN(64, sample64(8, 0)).toString()],
  ["sample.account-8.stream-1.unsigned", sample64(8, 1).toString()],
  ["sample.account-8.stream-1.signed", BigInt.asIntN(64, sample64(8, 1)).toString()],
  ["account-8.server-count", accountServerCount(8)],
  ["id.account-4", "account-4"],
  ["id.account-4.owner", "account-4-owner"],
  ["id.account-4.team-3", "account-4-team-3"],
  ["id.account-4.team-3.leader", "account-4-team-3-leader"],
  ["id.account-4.vpc-1", "account-4-vpc-1"],
  ["id.account-4.vpc-1.admin", "account-4-vpc-1-admin"],
  ["id.account-4.server-15", "account-4-server-15"],
  ["schema.digest", small.schema.digest],
  ["schema.definitions", small.schema.definitions],
  ["schema.relations", small.schema.relations],
  ["schema.permissions", small.schema.permissions],
  ["exemplars.digest", small.exemplars.digest],
  ["exemplars.cases", small.exemplars.cases],
  ["small.resources", small.counts.objects.resources.total],
  ["small.subjects", small.counts.objects.subjects.total],
  ["small.relationships", small.counts.relationships.total],
  ["small.records", small.counts.records.total],
  ["small.fixture.digest", small.digests.fixture],
  ["small.semantic.digest", small.digests.semanticRecords],
  ["large.resources", large.counts.objects.resources.total],
  ["large.subjects", large.counts.objects.subjects.total],
  ["large.relationships", large.counts.relationships.total],
  ["large.records", large.counts.records.total],
  ["large.fixture.digest", large.digests.fixture],
  ["large.semantic.digest", large.digests.semanticRecords],
  ["large.prefix-10000.digest", large.prefixProofs["10000"].recordsDigest]
];
const rendered = `# eacl-demo-fixture-v1 cross-language golden vectors\n${values.map(([key, value]) => `${key}\t${value}\n`).join("")}`;
const goldenUrl = new URL("../fixtures/golden/fixture-v1.tsv", import.meta.url);

if (process.argv.includes("--write")) {
  await writeFile(goldenUrl, rendered);
  console.log("updated fixtures/golden/fixture-v1.tsv");
} else {
  assert.equal(await readFile(goldenUrl, "utf8"), rendered, "fixture golden vectors are stale; regenerate only with an intentional fixture identity change");
  console.log(`fixture-golden\tPASS\t${values.length} vectors`);
}

async function readJson(relative) {
  return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
}
