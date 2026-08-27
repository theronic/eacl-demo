import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  createPreReleaseReport,
  renderReleaseReportMarkdown,
  sealReleaseReport,
  validateReleaseReport
} from "./lib/release-report.mjs";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const readJson = async (relative) => JSON.parse(await read(relative));
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
const sources = Object.fromEntries(await Promise.all(sourcePaths.map(async (relative) => [relative, await read(relative)])));
const baseInput = {
  registry: await readJson("registry/profile-registry.v1.json"),
  profileDefinitions: await readJson("packages/contracts/profiles.v1.json"),
  buildUnits: await readJson("build-units.json"),
  eaclLock: JSON.parse(sources["dependencies/eacl-core.lock.json"]),
  fixtureManifests: await Promise.all([
    readJson("fixtures/manifests/fixture-10000.v1.json"),
    readJson("fixtures/manifests/fixture-1000000.v1.json")
  ]),
  benchmarkEvidenceRecords: [],
  sources
};
const committed = await readJson("registry/release-report.v1.json");
const schema = await readJson("schemas/release-report.v1.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

const input = () => structuredClone(baseInput);

test("the checked-in pre-release report is deterministic, content-addressed, and schema-valid", () => {
  const generated = createPreReleaseReport(input());
  assert.deepEqual(generated, committed);
  assert.equal(validateReleaseReport(generated), generated);
  assert.equal(validateSchema(generated), true, JSON.stringify(validateSchema.errors));
  const markdown = renderReleaseReportMarkdown(generated);
  assert.match(markdown, /Status: \*\*pre-release\*\*/u);
  assert.match(markdown, /not evidence that a production release exists/u);
  assert.doesNotMatch(markdown, /deployed and verified/iu);
});

test("all profiles and both fixture identities are listed without fabricated deployment identities", () => {
  assert.deepEqual(committed.profiles.map(({ id }) => id), [
    "datahike-s3", "datahike-dynamodb", "datomic-dynamodb", "datalevin-memory",
    "jank-memory", "datascript-browser-memory"
  ]);
  assert.equal(committed.profiles.every(({ deployment, deploymentEligible }) => deployment === null && deploymentEligible === false), true);
  assert.deepEqual(committed.fixtures.map(({ logicalResources }) => logicalResources), [10000, 1000000]);
  assert.equal(committed.source.demo.sha, null);
  assert.equal(committed.release, null);
});

test("candidate memory, alarm templates, budgets, and Telegram routing are not promoted to live evidence", () => {
  const serverProfiles = committed.profiles.filter(({ id }) => id !== "datascript-browser-memory");
  assert.equal(serverProfiles.every(({ memory }) => memory.status === "candidate-unqualified" && memory.qualifiedMiB === null && memory.evidenceId === null), true);
  assert.equal(serverProfiles.every(({ alarms }) => alarms.status === "defined-not-deployed" && alarms.count === 7 && alarms.evidenceId === null), true);
  assert.deepEqual(serverProfiles.map(({ memory }) => memory.configuredMiB), [1024, 1024, 1024, 1024, 4096]);
  assert.equal(committed.costControls.budgets.every(({ status, evidenceId }) => status === "defined-not-deployed" && evidenceId === null), true);
  assert.equal(committed.costControls.notifications.status, "defined-not-verified");
  assert.equal(committed.costControls.notifications.evidenceId, null);
});

test("a storage performance claim without comparable benchmark evidence is rejected", () => {
  const candidate = input();
  candidate.registry.storageDefaults[0] = {
    ...candidate.registry.storageDefaults[0],
    outcome: "winner",
    profileId: "datahike-s3",
    storage: "s3",
    claim: "fastest-qualified",
    reason: null
  };
  assert.throws(() => createPreReleaseReport(candidate), /lacks evidence/u);
});

test("benchmark summaries cannot exist without their exact validated evidence files", () => {
  const candidate = input();
  candidate.registry.benchmarkEvidence.push({
    evidenceId: `sha256:${"a".repeat(64)}`,
    backend: "datahike",
    profiles: ["datahike-s3", "datahike-dynamodb"],
    measuredAt: "2026-08-25T12:00:00Z",
    expiresAt: "2026-09-25T12:00:00Z",
    path: "registry/benchmark-evidence/forged.json",
    sha256: "b".repeat(64)
  });
  assert.throws(() => createPreReleaseReport(candidate), /exact source records/u);
});

test("profile mapping, fixture scale, and manifest self-identity fail closed", () => {
  const route = input();
  route.registry.profiles[0].route = "/api/v1/datahike-s3";
  assert.throws(() => createPreReleaseReport(route), /profile mapping|route is not canonical/u);

  const fixture = input();
  fixture.fixtureManifests[0].counts.records.total += 1;
  assert.throws(() => createPreReleaseReport(fixture), /self-digest/u);
});

test("enabled availability cannot outrun deployment, memory, alarms, or rollback evidence", () => {
  const candidate = input();
  candidate.registry.profiles[0].state = "enabled";
  candidate.registry.profiles[0].reason = null;
  candidate.buildUnits.units["datahike-s3"].deploymentEligible = true;
  assert.throws(() => createPreReleaseReport(candidate), /requires deployment identity|not release eligible|lacks an immutable/u);
});

test("a released aggregate permits exact mixed profile generations without a convergence claim", () => {
  const candidate = structuredClone(committed);
  const reportDemoSha = "a".repeat(40);
  const profileDemoSha = "c".repeat(40);
  const profileEaclSha = "d".repeat(40);
  const artifactSha256 = "e".repeat(64);
  candidate.reportState = "released";
  candidate.release = {
    deploymentIdentity: `1345904214:12345:1:${reportDemoSha}`,
    releaseManifestSha256: "b".repeat(64),
    publishedAt: "2026-08-26T12:05:00Z"
  };
  candidate.source.demo = { repository: candidate.source.demo.repository, sha: reportDemoSha, status: "committed", reason: null };
  candidate.blockers = [];
  const profile = candidate.profiles.find(({ id }) => id === "datascript-browser-memory");
  profile.availabilityState = "enabled";
  profile.availabilityReason = null;
  profile.deploymentEligible = true;
  profile.deployment = {
    demoSha: profileDemoSha,
    eaclSha: profileEaclSha,
    artifact: { kind: "static", sha256: artifactSha256, version: "datascript-runtime-e.js" },
    deploymentId: "datascript-run-9",
    dataManifestSha256: profile.fixture.manifestSha256.slice("sha256:".length),
    deployedAt: "2026-08-26T12:00:00Z"
  };
  profile.lastOutcome = {
    outcome: "succeeded",
    attemptedDemoSha: profileDemoSha,
    attemptedEaclSha: profileEaclSha,
    artifactSha256,
    at: "2026-08-26T12:01:00Z",
    message: "The independently deployed browser profile passed."
  };
  profile.rollback = {
    status: "ready",
    kind: "static-versioned-prefix",
    alias: null,
    statusObject: null,
    static: { bucket: "eacl-demo-static-123", activePrefix: `releases/${profileDemoSha}`, restorePrefix: `releases/${"f".repeat(40)}`, distributionId: "EDIST123" },
    reason: null
  };
  const released = sealReleaseReport(candidate);
  assert.notEqual(released.profiles[5].deployment.demoSha, released.source.demo.sha);
  assert.equal(validateSchema(released), true, JSON.stringify(validateSchema.errors));

  const retainedAfterFailure = structuredClone(released);
  retainedAfterFailure.profiles[5].lastOutcome = {
    outcome: "failed",
    attemptedDemoSha: "1".repeat(40),
    attemptedEaclSha: "2".repeat(40),
    artifactSha256: "3".repeat(64),
    at: "2026-08-26T12:04:00Z",
    message: "The newer attempt failed and the healthy profile was retained."
  };
  assert.equal(sealReleaseReport(retainedAfterFailure).profiles[5].deployment.demoSha, profileDemoSha);
});

test("qualified and verified labels require evidence IDs", () => {
  const memory = structuredClone(committed);
  memory.profiles[0].memory.status = "qualified";
  memory.profiles[0].memory.qualifiedMiB = memory.profiles[0].memory.configuredMiB;
  assert.throws(() => sealReleaseReport(memory), /lacks exact evidence/u);

  const budget = structuredClone(committed);
  budget.costControls.budgets[0].status = "verified";
  assert.throws(() => sealReleaseReport(budget), /lacks evidence/u);

  const telegram = structuredClone(committed);
  telegram.costControls.notifications.status = "verified";
  telegram.costControls.notifications.reason = null;
  assert.throws(() => sealReleaseReport(telegram), /lacks evidence/u);

  const aggregate = structuredClone(committed);
  aggregate.costControls.status = "verified";
  assert.throws(() => sealReleaseReport(aggregate), /aggregate cost-control status/u);
});

test("rollback cannot be called ready without exact released deployment coordinates", () => {
  const candidate = structuredClone(committed);
  candidate.profiles[0].rollback = {
    status: "ready",
    kind: "lambda-alias-and-versioned-status",
    alias: { functionName: "eacl-demo-datahike-s3", aliasName: "live", currentVersion: "8", revisionId: "revision-8", restoreVersion: "7" },
    statusObject: { bucket: "eacl-demo-static-123", key: "registry/profiles/datahike-s3.json", etag: "1".repeat(32), versionId: "version-7", publicationId: `sha256:${"2".repeat(64)}` },
    static: null,
    reason: null
  };
  assert.throws(() => sealReleaseReport(candidate), /do not belong to a deployed release/u);
});

test("mutable source language, unknown fields, and credential-shaped material fail closed", () => {
  for (const mutate of [
    (candidate) => { candidate.blockers[0].reason = "Use the latest deployment."; },
    (candidate) => { candidate.unreviewed = true; },
    (candidate) => { candidate.blockers[0].reason = `token ghp_${"a".repeat(30)}`; }
  ]) {
    const candidate = structuredClone(committed);
    mutate(candidate);
    assert.throws(() => sealReleaseReport(candidate));
  }
});

test("template drift changes the report identity and malformed safety definitions fail generation", () => {
  const changed = input();
  changed.sources["infra/profiles/datahike-s3-runtime.yaml"] = changed.sources["infra/profiles/datahike-s3-runtime.yaml"].replace("Default: 1024", "Default: 1536");
  const regenerated = createPreReleaseReport(changed);
  assert.equal(regenerated.profiles[0].memory.configuredMiB, 1536);
  assert.notEqual(regenerated.reportId, committed.reportId);

  const architecture = input();
  architecture.sources["infra/profiles/datahike-s3-runtime.yaml"] = architecture.sources["infra/profiles/datahike-s3-runtime.yaml"].replace("Architecture: arm64", "Architecture: x86_64");
  assert.throws(() => createPreReleaseReport(architecture), /Architecture: arm64/u);

  const malformed = input();
  malformed.sources["infra/observability/template.yaml"] = malformed.sources["infra/observability/template.yaml"].replace("Threshold: 100", "Threshold: 90");
  assert.throws(() => createPreReleaseReport(malformed), /budget notification thresholds/u);
});
