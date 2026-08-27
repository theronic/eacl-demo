import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderQualificationReports, writeQualificationReports } from "./src/reports.mjs";

const identity = {
  profileId: "datascript-browser",
  demoSha: "a".repeat(40),
  eaclSha: "b".repeat(40),
  artifactSha256: "c".repeat(64),
  deploymentId: "release-1",
  dataManifestSha256: "d".repeat(64)
};

function qualification() {
  return {
    schema: "eacl-demo.qualification-report.v1",
    result: "fail",
    startedAt: "2026-08-25T00:00:00.000Z",
    completedAt: "2026-08-25T00:01:00.000Z",
    target: { kind: "local", origin: "http://127.0.0.1:3000", path: "/", profileId: "datascript-browser" },
    identity,
    descriptorIdentity: identity,
    releaseOutcome: "released",
    counts: { passed: 1, failed: 1, unsupported: 1 },
    cases: [
      { id: "health", category: "contract", status: "passed", durationMs: 1, reason: null, details: {} },
      { id: "history", category: "consistency", status: "unsupported", durationMs: 0, reason: "exact history is not advertised", details: {} },
      { id: "authorization", category: "authorization", status: "failed", durationMs: 2, reason: "secret=do-not-serialize /Users/name/file", details: { token: "also-secret", note: "https://example.invalid/private" } }
    ]
  };
}

const workload = {
  schema: "eacl-demo.qualification-workload.v1",
  result: "pass",
  profileId: identity.profileId,
  dataset: { fixtureId: "small-v1", logicalResourceCount: 10_000, manifestSha256: "d".repeat(64) },
  cacheStates: ["warm"],
  concurrency: 4,
  criteria: {},
  phases: [
    { phase: "cold", status: "passed", reason: null, samples: 3, errors: 0, latencyMs: { p50: 2, p95: 3 }, memory: { minimumHeadroomPercent: 25 } },
    { phase: "restore", status: "unsupported", reason: "restore lifecycle is not exposed", samples: 0, errors: 0, latencyMs: null, memory: null }
  ]
};

test("machine and human reports keep unsupported separate from failed and redact secrets", () => {
  const reports = renderQualificationReports(qualification(), workload);
  assert.equal(reports.machine.qualification.cases[1].status, "unsupported");
  assert.equal(reports.machine.qualification.cases[2].status, "failed");
  assert.equal(reports.machine.qualification.cases[2].details.token, "[redacted]");
  assert.equal(reports.machine.qualification.cases[2].details.note, "[redacted]");
  assert.equal(reports.machine.qualification.target.origin, "http://127.0.0.1:3000");
  assert.doesNotMatch(reports.json, /do-not-serialize|also-secret|\/Users\/name/u);
  assert.match(reports.markdown, /Unsupported means the profile did not advertise the capability/);
  assert.match(reports.markdown, /\| unsupported \| consistency \| history \|/);
  assert.match(reports.markdown, /\| failed \| authorization \| authorization \|/);
  assert.match(reports.markdown, /restore \| unsupported/);
});

test("report files are written as deterministic JSON and Markdown", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "eacl-qualification-report-"));
  const paths = await writeQualificationReports({ qualification: qualification(), workload, outputDirectory, basename: "datascript-browser" });
  assert.equal(JSON.parse(await readFile(paths.json, "utf8")).qualification.counts.unsupported, 1);
  assert.match(await readFile(paths.markdown, "utf8"), /^# EACL demo qualification report/u);
});

test("inconsistent status counts cannot be published", () => {
  const report = qualification();
  report.counts.unsupported = 0;
  assert.throws(() => renderQualificationReports(report), /counts are inconsistent/u);
});
