import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { accountServerCount, ids, sample64 } from "./typescript-port";

const golden = parseGolden(readFileSync("fixtures/golden/fixture-v1.tsv", "utf8"));
const small = JSON.parse(readFileSync("fixtures/manifests/fixture-10000.v1.json", "utf8"));
const large = JSON.parse(readFileSync("fixtures/manifests/fixture-1000000.v1.json", "utf8"));
const exemplars = JSON.parse(readFileSync("fixtures/exemplars.v1.json", "utf8"));

describe("TypeScript fixture golden port", () => {
  test("unsigned algorithm and IDs agree", () => {
    expect(sample64(8, 0).toString()).toBe(golden.get("sample.account-8.stream-0.unsigned"));
    expect(sample64(8, 1).toString()).toBe(golden.get("sample.account-8.stream-1.unsigned"));
    expect(accountServerCount(8).toString()).toBe(golden.get("account-8.server-count"));
    expect(ids.account(4)).toBe(golden.get("id.account-4"));
    expect(ids.owner(4)).toBe(golden.get("id.account-4.owner"));
    expect(ids.team(4, 3)).toBe(golden.get("id.account-4.team-3"));
    expect(ids.leader(4, 3)).toBe(golden.get("id.account-4.team-3.leader"));
    expect(ids.vpc(4, 1)).toBe(golden.get("id.account-4.vpc-1"));
    expect(ids.vpcAdmin(4, 1)).toBe(golden.get("id.account-4.vpc-1.admin"));
    expect(ids.server(4, 15)).toBe(golden.get("id.account-4.server-15"));
  });

  test("schema, counts, exemplars, and fixture digests agree", () => {
    const schemaDigest = `sha256:${createHash("sha256").update(readFileSync("fixtures/schema.v1.zed")).digest("hex")}`;
    expect(schemaDigest).toBe(golden.get("schema.digest"));
    expect(exemplars.cases.length.toString()).toBe(golden.get("exemplars.cases"));
    expect(small.exemplars.digest).toBe(golden.get("exemplars.digest"));
    expect(small.counts.objects.resources.total.toString()).toBe(golden.get("small.resources"));
    expect(small.counts.relationships.total.toString()).toBe(golden.get("small.relationships"));
    expect(small.digests.fixture).toBe(golden.get("small.fixture.digest"));
    expect(large.counts.objects.resources.total.toString()).toBe(golden.get("large.resources"));
    expect(large.counts.relationships.total.toString()).toBe(golden.get("large.relationships"));
    expect(large.digests.fixture).toBe(golden.get("large.fixture.digest"));
    expect(large.prefixProofs["10000"].recordsDigest).toBe(golden.get("small.semantic.digest"));
  });
});

function parseGolden(source: string): Map<string, string> {
  return new Map(source.split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t", 2) as [string, string]));
}
