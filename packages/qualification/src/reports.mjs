import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const REPORT_SCHEMA = "eacl-demo.qualification-report.v1";

export function renderQualificationReports(qualification, workload = null) {
  validateQualification(qualification);
  if (workload !== null) validateWorkload(workload, qualification.identity.profileId);
  const machine = redactDeep({ qualification, workload });
  return {
    machine,
    json: `${JSON.stringify(sortDeep(machine), null, 2)}\n`,
    markdown: renderMarkdown(machine)
  };
}

export async function writeQualificationReports({ qualification, workload = null, outputDirectory, basename = "qualification" }) {
  if (typeof outputDirectory !== "string" || outputDirectory.length < 1) throw new TypeError("report outputDirectory is required");
  if (!/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/u.test(basename)) throw new TypeError("report basename is invalid");
  const reports = renderQualificationReports(qualification, workload);
  await mkdir(outputDirectory, { recursive: true });
  const paths = {
    json: join(outputDirectory, `${basename}.json`),
    markdown: join(outputDirectory, `${basename}.md`)
  };
  await Promise.all([
    atomicWrite(paths.json, reports.json),
    atomicWrite(paths.markdown, reports.markdown)
  ]);
  return paths;
}

function renderMarkdown({ qualification, workload }) {
  const counts = qualification.counts;
  const lines = [
    "# EACL demo qualification report",
    "",
    `Overall result: **${qualification.result.toUpperCase()}**`,
    "",
    "## Identity",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...Object.entries(qualification.identity).map(([key, value]) => `| ${escapeCell(key)} | \`${escapeCell(value)}\` |`),
    "",
    "## Contract cases",
    "",
    `Passed: **${counts.passed}** · Failed: **${counts.failed}** · Unsupported: **${counts.unsupported}**`,
    "",
    "> Unsupported means the profile did not advertise the capability. It is not a failed behavior check.",
    "",
    "| Status | Category | Case | Duration (ms) | Reason |",
    "| --- | --- | --- | ---: | --- |",
    ...qualification.cases.map((entry) => `| ${entry.status} | ${escapeCell(entry.category)} | ${escapeCell(entry.id)} | ${entry.durationMs} | ${escapeCell(entry.reason ?? "—")} |`)
  ];

  if (workload) {
    lines.push(
      "",
      "## Representative workloads",
      "",
      `Workload result: **${workload.result.toUpperCase()}** · Dataset: \`${escapeCell(workload.dataset.fixtureId)}\` · Concurrency: **${workload.concurrency}**`,
      "",
      "| Phase | Status | Samples | Errors | p50 (ms) | p95 (ms) | Minimum headroom | Reason |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
      ...workload.phases.map((phase) => `| ${phase.phase} | ${phase.status} | ${phase.samples} | ${phase.errors} | ${phase.latencyMs?.p50 ?? "—"} | ${phase.latencyMs?.p95 ?? "—"} | ${phase.memory?.minimumHeadroomPercent ?? "—"}% | ${escapeCell(phase.reason ?? "—")} |`)
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function atomicWrite(path, contents) {
  const temporary = `${path}.tmp-${process.pid}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function validateQualification(report) {
  if (!report || report.schema !== REPORT_SCHEMA || !report.identity || !Array.isArray(report.cases)
      || !report.counts || !new Set(["pass", "fail"]).has(report.result)) throw new TypeError("qualification report is invalid");
  const actual = report.cases.reduce((counts, entry) => {
    if (!new Set(["passed", "failed", "unsupported"]).has(entry.status)) throw new TypeError("qualification case status is invalid");
    counts[entry.status] += 1;
    return counts;
  }, { passed: 0, failed: 0, unsupported: 0 });
  for (const status of Object.keys(actual)) if (report.counts[status] !== actual[status]) throw new TypeError("qualification report counts are inconsistent");
  if ((actual.failed === 0 ? "pass" : "fail") !== report.result) throw new TypeError("qualification report result is inconsistent");
}

function validateWorkload(workload, profileId) {
  if (!workload || workload.schema !== "eacl-demo.qualification-workload.v1" || workload.profileId !== profileId
      || !Array.isArray(workload.phases) || !new Set(["pass", "fail"]).has(workload.result)) throw new TypeError("qualification workload report is invalid");
  for (const phase of workload.phases) if (!new Set(["passed", "failed", "unsupported"]).has(phase.status)) throw new TypeError("qualification workload phase status is invalid");
}

function redactDeep(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactDeep(child, childKey)]));
  if (/authorization|credential|password|secret|token/iu.test(key)) return "[redacted]";
  if (typeof value === "string") return value.replace(/https?:\/\/\S+|\b(?:token|secret|password|authorization)\b\s*[:=]\s*\S+|\/(?:Users|home|var|tmp)\/\S+/giu, "[redacted]");
  return value;
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
  return value;
}

function escapeCell(value) {
  return String(value).replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}
