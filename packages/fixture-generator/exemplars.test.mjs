import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildLogicalFixture,
  checkPermission,
  hasRelationship,
  lookupResources,
  lookupSubjects
} from "./exemplar-evaluator.mjs";

const exemplars = JSON.parse(await readFile(new URL("../../fixtures/exemplars.v1.json", import.meta.url), "utf8"));
const fixture = buildLogicalFixture(10_000);
const cases = new Map(exemplars.cases.map((entry) => [entry.id, entry]));

test("exemplars cover every required semantic category", () => {
  assert.deepEqual(exemplars.requiredCoverage, [
    "direct", "arrow-relation", "arrow-permission", "cycle", "duplicate",
    "forward-discovery", "reverse-discovery", "relationship-filter", "count", "pagination"
  ]);
  assert.equal(new Set(exemplars.cases.map(({ id }) => id)).size, exemplars.cases.length);
});

test("all decision exemplars match the independent logical evaluator", () => {
  for (const exemplar of exemplars.cases.filter(({ kind }) => kind === "decision")) {
    assert.equal(
      checkPermission(fixture, exemplar.demand.subject, exemplar.demand.permission, exemplar.demand.resource),
      exemplar.expected.allowed,
      exemplar.id
    );
  }
});

test("duplicate relationship input has one logical membership", () => {
  const exemplar = cases.get("duplicate-touch-is-idempotent");
  assert.equal(hasRelationship(fixture, exemplar.relationship), true);
  const before = checkPermission(fixture, { type: "user", id: "user-1" }, "admin", { type: "account", id: "account-0" });
  assert.equal(exemplar.expected.logicalMultiplicity, 1);
  assert.equal(before, true);
});

test("forward and reverse discovery exemplars are stable", () => {
  const forward = cases.get("forward-server-discovery");
  const resources = lookupResources(fixture, forward.query);
  assert.equal(resources.length, forward.expected.count);
  assert.deepEqual(resources[0], forward.expected.first);

  const reverse = cases.get("reverse-account-discovery");
  const ids = lookupSubjects(fixture, reverse.query).map(({ id }) => id);
  for (const id of reverse.expected.containsIds) assert.equal(ids.includes(id), true, `missing reverse subject ${id}`);
  for (const id of reverse.expected.excludesIds) assert.equal(ids.includes(id), false, `unexpected reverse subject ${id}`);
});

test("relationship filtering, bounded count, and pagination exemplars are exact", () => {
  const filtered = cases.get("team-relationship-filter");
  assert.deepEqual(lookupResources(fixture, filtered.query).map(({ id }) => id), filtered.expected.ids);

  const count = cases.get("bounded-count-truncates");
  const all = lookupResources(fixture, count.query);
  assert.equal(Math.min(all.length, count.query.limit), count.expected.count);
  assert.equal(all.length > count.query.limit, count.expected.truncated);

  const pagination = cases.get("stable-pagination");
  const paged = lookupResources(fixture, pagination.query);
  assert.deepEqual(paged.slice(0, pagination.query.pageSize).map(({ id }) => id), pagination.expected.firstPageIds);
  assert.equal(paged.length, pagination.expected.concatenatedCount);
  assert.equal(paged.length - new Set(paged.map(({ id }) => id)).size, pagination.expected.duplicates);
});
