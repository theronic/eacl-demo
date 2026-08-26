import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./canonical-json.mjs";

export const FIXTURE_ID = "eacl-demo-fixture-v1";
export const ALGORITHM_ID = "eacl-demo-fixture";
export const ALGORITHM_VERSION = 1;
export const SEED = 20260813n;
export const CUT_POINTS = Object.freeze([10_000, 1_000_000]);
export const PRELUDE_ACCOUNTS = 8;
export const PRELUDE_SERVERS_PER_ACCOUNT = 16;
export const TEAMS_PER_ACCOUNT = 4;
export const VPCS_PER_ACCOUNT = 2;
export const ACCOUNT_PARENT_GROUP_SIZE = 4;
export const SERVER_PARENT_GROUP_SIZE = 8;

const MASK_64 = (1n << 64n) - 1n;
const ORDINAL_MULTIPLIER = 104729n;
const STREAM_MULTIPLIER = 0x9e3779b97f4a7c15n;
const MIX_MULTIPLIER_1 = 0xbf58476d1ce4e5b9n;
const MIX_MULTIPLIER_2 = 0x94d049bb133111ebn;
const schemaUrl = new URL("../../fixtures/schema.v1.zed", import.meta.url);
const exemplarsUrl = new URL("../../fixtures/exemplars.v1.json", import.meta.url);

export function mix64(value) {
  let mixed = value & MASK_64;
  mixed = ((mixed ^ (mixed >> 30n)) * MIX_MULTIPLIER_1) & MASK_64;
  mixed = ((mixed ^ (mixed >> 27n)) * MIX_MULTIPLIER_2) & MASK_64;
  return (mixed ^ (mixed >> 31n)) & MASK_64;
}

export function sample64(accountOrdinal, stream) {
  if (!Number.isSafeInteger(accountOrdinal) || accountOrdinal < 0) throw new RangeError("account ordinal must be a non-negative safe integer");
  if (!Number.isSafeInteger(stream) || stream < 0) throw new RangeError("stream must be a non-negative safe integer");
  const input = (SEED + BigInt(accountOrdinal) * ORDINAL_MULTIPLIER + BigInt(stream) * STREAM_MULTIPLIER) & MASK_64;
  return mix64(input);
}

export function accountServerCount(accountOrdinal) {
  if (accountOrdinal < PRELUDE_ACCOUNTS) return PRELUDE_SERVERS_PER_ACCOUNT;
  const tier = Number(sample64(accountOrdinal, 0) % 10_000n);
  const [minimum, maximum] = tier < 5_500
    ? [1, 2_000]
    : tier < 8_400
      ? [2_001, 7_500]
      : tier < 9_600
        ? [7_501, 20_000]
        : [20_001, 50_000];
  return minimum + Number(sample64(accountOrdinal, 1) % BigInt(maximum - minimum + 1));
}

export function object(type, id) {
  return { type, id };
}

export function objectRecord(role, type, id) {
  return { kind: "object", object: object(type, id), role };
}

export function relationshipRecord(subjectType, subjectId, relation, resourceType, resourceId) {
  return {
    kind: "relationship",
    relation,
    resource: object(resourceType, resourceId),
    subject: object(subjectType, subjectId)
  };
}

export function *fixtureBundles(cutPointResources) {
  validateCutPoint(cutPointResources);
  let emittedResources = 0;

  const root = {
    resource: object("platform", "platform"),
    records: [
      objectRecord("resource", "platform", "platform"),
      objectRecord("subject", "user", "super-user"),
      objectRecord("subject", "user", "user-1"),
      objectRecord("subject", "user", "user-2"),
      relationshipRecord("user", "super-user", "super_admin", "platform", "platform")
    ]
  };
  yield root;
  emittedResources += 1;

  for (let accountOrdinal = 0; emittedResources < cutPointResources; accountOrdinal += 1) {
    const accountId = `account-${accountOrdinal}`;
    const ownerId = `${accountId}-owner`;
    const accountRecords = [
      objectRecord("subject", "user", ownerId),
      objectRecord("resource", "account", accountId),
      relationshipRecord("platform", "platform", "platform", "account", accountId),
      relationshipRecord("user", ownerId, "owner", "account", accountId)
    ];
    if (accountOrdinal > 0 && accountOrdinal % ACCOUNT_PARENT_GROUP_SIZE !== 0) {
      accountRecords.push(relationshipRecord("account", `account-${accountOrdinal - 1}`, "parent", "account", accountId));
    }
    if (accountOrdinal === 1) {
      accountRecords.push(relationshipRecord("account", "account-1", "parent", "account", "account-0"));
    }
    if (accountOrdinal === 0) accountRecords.push(relationshipRecord("user", "user-1", "owner", "account", accountId));
    if (accountOrdinal === 4) accountRecords.push(relationshipRecord("user", "user-2", "owner", "account", accountId));
    yield { resource: object("account", accountId), records: accountRecords };
    emittedResources += 1;
    if (emittedResources >= cutPointResources) break;

    for (let teamOrdinal = 0; teamOrdinal < TEAMS_PER_ACCOUNT && emittedResources < cutPointResources; teamOrdinal += 1) {
      const teamId = `${accountId}-team-${teamOrdinal}`;
      const leaderId = `${teamId}-leader`;
      yield {
        resource: object("team", teamId),
        records: [
          objectRecord("subject", "user", leaderId),
          objectRecord("resource", "team", teamId),
          relationshipRecord("account", accountId, "account", "team", teamId),
          relationshipRecord("user", leaderId, "leader", "team", teamId)
        ]
      };
      emittedResources += 1;
    }
    if (emittedResources >= cutPointResources) break;

    for (let vpcOrdinal = 0; vpcOrdinal < VPCS_PER_ACCOUNT && emittedResources < cutPointResources; vpcOrdinal += 1) {
      const vpcId = `${accountId}-vpc-${vpcOrdinal}`;
      const adminId = `${vpcId}-admin`;
      yield {
        resource: object("vpc", vpcId),
        records: [
          objectRecord("subject", "user", adminId),
          objectRecord("resource", "vpc", vpcId),
          relationshipRecord("account", accountId, "account", "vpc", vpcId),
          relationshipRecord("user", adminId, "shared_admin", "vpc", vpcId)
        ]
      };
      emittedResources += 1;
    }
    if (emittedResources >= cutPointResources) break;

    const serverCount = accountServerCount(accountOrdinal);
    for (let serverOrdinal = 0; serverOrdinal < serverCount && emittedResources < cutPointResources; serverOrdinal += 1) {
      const serverId = `${accountId}-server-${serverOrdinal}`;
      const records = [
        objectRecord("resource", "server", serverId),
        relationshipRecord("account", accountId, "account", "server", serverId),
        relationshipRecord("team", `${accountId}-team-${serverOrdinal % TEAMS_PER_ACCOUNT}`, "team", "server", serverId),
        relationshipRecord("vpc", `${accountId}-vpc-${serverOrdinal % VPCS_PER_ACCOUNT}`, "vpc", "server", serverId)
      ];
      if (serverOrdinal > 0 && serverOrdinal % SERVER_PARENT_GROUP_SIZE !== 0) {
        records.push(relationshipRecord("server", `${accountId}-server-${serverOrdinal - 1}`, "parent", "server", serverId));
      }
      yield { resource: object("server", serverId), records };
      emittedResources += 1;
    }
  }

  if (emittedResources !== cutPointResources) throw new Error(`generated ${emittedResources} resources for cut point ${cutPointResources}`);
}

export async function fixtureContext() {
  const [schemaBytes, exemplarBytes, generatorBytes] = await Promise.all([
    readFile(schemaUrl),
    readFile(exemplarsUrl),
    readFile(new URL("./generator.mjs", import.meta.url))
  ]);
  return {
    schemaDigest: sha256(schemaBytes),
    exemplarDigest: sha256(exemplarBytes),
    generatorDigest: sha256(generatorBytes)
  };
}

export function fixtureHeader(cutPointResources, context) {
  validateCutPoint(cutPointResources);
  return {
    algorithm: ALGORITHM_ID,
    algorithmVersion: ALGORITHM_VERSION,
    cutPointResources,
    exemplarDigest: context.exemplarDigest,
    fixtureId: FIXTURE_ID,
    kind: "fixture",
    schemaDigest: context.schemaDigest,
    seed: SEED.toString()
  };
}

export async function generateFixtureManifest(cutPointResources, { onLine } = {}) {
  validateCutPoint(cutPointResources);
  const context = await fixtureContext();
  const header = fixtureHeader(cutPointResources, context);
  const fixtureHash = createHash("sha256");
  const recordsHash = createHash("sha256");
  const prefixHashes = new Map(CUT_POINTS.filter((cut) => cut <= cutPointResources).map((cut) => [cut, createHash("sha256")]));
  const prefixRecordCounts = new Map([...prefixHashes.keys()].map((cut) => [cut, 0]));
  const counts = emptyCounts();
  let resourcesSeen = 0;

  emitLine(header, fixtureHash, onLine);
  for (const bundle of fixtureBundles(cutPointResources)) {
    resourcesSeen += 1;
    counts.bundles += 1;
    for (const record of bundle.records) {
      const line = `${canonicalJson(record)}\n`;
      fixtureHash.update(line);
      recordsHash.update(line);
      for (const [cut, hash] of prefixHashes) {
        if (resourcesSeen <= cut) {
          hash.update(line);
          prefixRecordCounts.set(cut, prefixRecordCounts.get(cut) + 1);
        }
      }
      onLine?.(line);
      countRecord(counts, record, line);
    }
  }

  const prefixProofs = {};
  for (const [cut, hash] of prefixHashes) {
    prefixProofs[String(cut)] = {
      recordCount: prefixRecordCounts.get(cut),
      recordsDigest: `sha256:${hash.digest("hex")}`
    };
  }

  const manifest = {
    schemaVersion: 1,
    fixtureId: FIXTURE_ID,
    algorithm: {
      id: ALGORITHM_ID,
      version: ALGORITHM_VERSION,
      seed: SEED.toString(),
      generatorSource: "packages/fixture-generator/generator.mjs",
      generatorDigest: context.generatorDigest,
      arithmetic: "unsigned-64-bit-modulo-2^64"
    },
    cutPoint: {
      logicalResources: cutPointResources,
      semanticPrefixOf: cutPointResources < 1_000_000 ? 1_000_000 : null
    },
    format: {
      mediaType: "application/x-ndjson",
      canonicalization: "UTF-8; lexicographically sorted object keys; LF after every record",
      headerRecords: 1,
      recordKinds: ["object", "relationship"]
    },
    schema: {
      source: "fixtures/schema.v1.zed",
      digest: context.schemaDigest,
      definitions: 6,
      relations: 13,
      permissions: 9
    },
    exemplars: {
      source: "fixtures/exemplars.v1.json",
      digest: context.exemplarDigest,
      cases: 14
    },
    counts: finalizeCounts(counts),
    prefixProofs,
    digests: {
      fixture: `sha256:${fixtureHash.digest("hex")}`,
      semanticRecords: prefixProofs[String(cutPointResources)].recordsDigest
    }
  };
  manifest.digests.manifest = sha256(`${canonicalJson(manifest)}\n`);
  return manifest;
}

export function validateCutPoint(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("cut point must be a positive safe integer");
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function emitLine(record, hash, onLine) {
  const line = `${canonicalJson(record)}\n`;
  hash.update(line);
  onLine?.(line);
}

function emptyCounts() {
  return {
    bundles: 0,
    bytes: 0,
    objects: { total: 0, subjects: { total: 0, byType: {} }, resources: { total: 0, byType: {} } },
    relationships: { total: 0, byRelation: {} },
    records: 0
  };
}

function countRecord(counts, record, line) {
  counts.records += 1;
  counts.bytes += Buffer.byteLength(line);
  if (record.kind === "object") {
    counts.objects.total += 1;
    const group = record.role === "subject" ? counts.objects.subjects : counts.objects.resources;
    group.total += 1;
    group.byType[record.object.type] = (group.byType[record.object.type] ?? 0) + 1;
  } else if (record.kind === "relationship") {
    counts.relationships.total += 1;
    counts.relationships.byRelation[record.relation] = (counts.relationships.byRelation[record.relation] ?? 0) + 1;
  } else {
    throw new Error(`unknown record kind: ${record.kind}`);
  }
}

function finalizeCounts(counts) {
  return {
    bundles: counts.bundles,
    objects: {
      total: counts.objects.total,
      subjects: { total: counts.objects.subjects.total, byType: sortObject(counts.objects.subjects.byType) },
      resources: { total: counts.objects.resources.total, byType: sortObject(counts.objects.resources.byType) }
    },
    relationships: { total: counts.relationships.total, unique: counts.relationships.total, byRelation: sortObject(counts.relationships.byRelation) },
    records: { total: counts.records, canonicalBytes: counts.bytes }
  };
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, "en")));
}
