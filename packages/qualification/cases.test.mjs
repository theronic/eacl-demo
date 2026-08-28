import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { commonQualificationCases } from "./src/cases.mjs";
import { runQualification } from "./src/runner.mjs";
import { qualificationTarget } from "./src/targets.mjs";

const exemplars = JSON.parse(await readFile(new URL("../../fixtures/exemplars.v1.json", import.meta.url), "utf8"));
const identity = { profileId: "datahike-s3", demoSha: "a".repeat(40), eaclSha: "b".repeat(40), artifactSha256: "c".repeat(64), deploymentId: "deploy-1", dataManifestSha256: "d".repeat(64) };
const basis = { behavior: "request-snapshot", id: "basis-1", capturedAt: "2026-08-25T12:00:00Z", fixedForEnvironment: false };
const descriptor = { identity, basis, contract: { revision: 1 }, capabilities: { operations: ["health", "bootstrap", "list-subjects", "list-relationships", "reverse-relationships", "check-permission", "get-cache-info"], consistencyModes: ["minimize"], cacheBehavior: "environment-local" } };

test("common cases cover every qualification category and keep unsupported cleanup distinct", async () => {
  const transport = fixtureTransport();
  const report = await runQualification({
    target: qualificationTarget({ kind: "local", baseUrl: "http://localhost:8080/", profileId: "datahike-s3" }),
    expectedIdentity: identity,
    createTransport: async () => transport,
    cases: commonQualificationCases(exemplars)
  });
  assert.equal(report.result, "pass");
  assert.equal(report.counts.failed, 0);
  assert.equal(report.cases.find(({ id }) => id === "cancellation-cleanup").status, "unsupported");
  const categories = new Set(report.cases.map(({ category }) => category));
  for (const category of ["contract", "authorization", "relationship", "pagination-cursor", "cache", "consistency", "consistency-failure", "failure-redaction", "cleanup", "identity"]) assert.equal(categories.has(category), true, category);
});

function fixtureTransport() {
  const cursors = new Set(["cursor-1"]);
  return {
    async request(operation, input) {
      const meta = { revision: basis.id, requestId: `request-${operation}` };
      if (operation === "bootstrap") return { meta, data: descriptor };
      if (operation === "health") return { meta, data: { ready: true, status: "ready", identity, basis } };
      if (operation === "check-permission") {
        if (!input.resourceType || !input.permission) return failure(meta, "validation-error");
        if (input.consistency !== "minimize") return failure(meta, "unsupported-consistency");
        return { meta, data: { allowed: input.subjectId !== "user-2" } };
      }
      if (operation === "list-relationships") return { meta, data: { items: [{ resourceType: "account", resourceId: "account-0", relation: "owner", subjectType: "user", subjectId: "user-1", subjectRelation: null }], pageInfo: { hasNextPage: false, endCursor: null, pageSize: 1 } } };
      if (operation === "reverse-relationships") return { meta, data: { items: [{ type: "account", id: "account-0", displayName: null, attributes: [] }], pageInfo: { hasNextPage: false, endCursor: null, pageSize: 1 } } };
      if (operation === "list-subjects") {
        if (input.cursor && !cursors.has(input.cursor)) return failure(meta, "cursor-invalid");
        return { meta, data: { items: [{ type: "user", id: input.cursor ? "user-2" : "user-1", displayName: null, attributes: [] }], pageInfo: { hasNextPage: !input.cursor, endCursor: input.cursor ? null : "cursor-1", pageSize: 1 } } };
      }
      if (operation === "get-cache-info") return {
        meta,
        data: {
          provider: { "exact-hits": 1, "exact-entries": 1 },
          operations: {},
          capturedAt: "2026-08-26T00:00:00Z",
        },
      };
      throw new Error(`unexpected operation ${operation}`);
    },
    async release() { return true; }
  };
}

function failure(meta, code) { return { meta, error: { code, message: "Rejected." } }; }
