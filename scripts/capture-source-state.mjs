#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(repoRoot, "..");
const codeRoot = resolve(workspaceRoot, "..");
const captureDate = process.env.EACL_DEMO_CAPTURE_DATE ?? "2026-08-25";
const outputBase = resolve(
  process.env.EACL_DEMO_SOURCE_STATE_OUTPUT
    ?? join(repoRoot, "docs", "provenance", `source-state-${captureDate}`),
);
const buildStatusFile = resolve(
  process.env.EACL_DEMO_BUILD_STATUS
    ?? join(repoRoot, "docs", "provenance", `build-status-${captureDate}.json`),
);

const repositories = [
  { id: "eacl-core", kind: "core", directory: join(workspaceRoot, "core") },
  { id: "datahike-demo", kind: "existing-demo", directory: join(workspaceRoot, "eacl-datahike-demo") },
  { id: "datomic-demo", kind: "existing-demo", directory: join(workspaceRoot, "eacl-datomic-solidjs") },
  { id: "datalevin-demo", kind: "existing-demo", directory: join(workspaceRoot, "eacl-datalevin-solidjs") },
  { id: "jank-demo", kind: "existing-demo", directory: join(workspaceRoot, "eacl-jank") },
  { id: "datascript-explorer", kind: "existing-demo", directory: join(codeRoot, "eacl-explorer") },
  { id: "datalevin-fork", kind: "dependency", directory: join(workspaceRoot, "datalevin") },
  { id: "rama-adapter", kind: "adjacent-source", directory: join(workspaceRoot, "eacl-rama") },
  { id: "spicedb-adapter", kind: "adjacent-source", directory: join(workspaceRoot, "eacl-spicedb") },
  { id: "eacl-demo", kind: "canonical-demo", directory: repoRoot },
];

const dependencyFileNames = new Set([
  "bb.edn",
  "build.gradle",
  "build.gradle.kts",
  "Cargo.lock",
  "deps.edn",
  "Dockerfile",
  "flake.lock",
  "jank-build.bb",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pom.xml",
  "project.clj",
  "shadow-cljs.edn",
  "yarn.lock",
]);
const ignoredDirectories = new Set([
  ".cpcache",
  ".git",
  ".shadow-cljs",
  ".worktrees",
  "build",
  "dist",
  "node_modules",
  "target",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function command(directory, executable, args, options = {}) {
  return execFileSync(executable, args, {
    cwd: directory,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function optionalCommand(directory, executable, args, options = {}) {
  try {
    return command(directory, executable, args, options);
  } catch {
    return null;
  }
}

function redactRemote(remote) {
  return remote.replace(/^(https?:\/\/)[^/@\s]+@/u, "$1[redacted]@");
}

function dependencyFiles(directory, current = directory) {
  const records = [];
  for (const name of readdirSync(current).sort()) {
    const absolute = join(current, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (!ignoredDirectories.has(name)) {
        records.push(...dependencyFiles(directory, absolute));
      }
    } else if (stat.isFile() && dependencyFileNames.has(name)) {
      const content = readFileSync(absolute);
      records.push({
        path: relative(directory, absolute),
        sha256: sha256(content),
        bytes: content.length,
      });
    }
  }
  return records;
}

function statusEntries(directory) {
  const raw = command(
    directory,
    "git",
    ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
    { encoding: "buffer" },
  );
  return {
    encoding: "git-status-porcelain-v2-z split into UTF-8 entries",
    sha256: sha256(raw),
    entries: raw
      .toString("utf8")
      .split("\0")
      .filter(Boolean),
  };
}

function remotes(directory) {
  const names = optionalCommand(directory, "git", ["remote"])
    ?.trim()
    .split("\n")
    .filter(Boolean) ?? [];
  return names.map((name) => ({
    name,
    fetch: (optionalCommand(directory, "git", ["remote", "get-url", "--all", name]) ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(redactRemote),
    push: (optionalCommand(directory, "git", ["remote", "get-url", "--push", "--all", name]) ?? "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(redactRemote),
  }));
}

const buildStatuses = existsSync(buildStatusFile)
  ? JSON.parse(readFileSync(buildStatusFile, "utf8"))
  : { capturedAt: null, results: {} };

const capturedAt = new Date().toISOString();
const records = repositories.map(({ id, kind, directory }) => {
  if (!existsSync(join(directory, ".git"))) {
    return { id, kind, directory, present: false };
  }
  const head = optionalCommand(directory, "git", ["rev-parse", "--verify", "HEAD"]);
  const branch = optionalCommand(directory, "git", ["branch", "--show-current"]);
  const upstream = optionalCommand(directory, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  return {
    id,
    kind,
    directory,
    present: true,
    head: head?.trim() ?? null,
    unborn: head === null,
    branch: branch?.trim() || null,
    upstream: upstream?.trim() || null,
    remotes: remotes(directory),
    status: statusEntries(directory),
    dependencyFiles: dependencyFiles(directory),
    buildStatus: buildStatuses.results?.[id] ?? {
      status: "not-run",
      reason: "No build result was supplied for this capture.",
    },
  };
});

const evidence = {
  schema: "eacl-demo.source-state.v1",
  capturedAt,
  captureDate,
  captureHost: "local-workspace",
  notes: [
    "Git status manifests are exact porcelain-v2 -z entries and include every non-ignored untracked path.",
    "Dependency files are bound by SHA-256; local-root targets are separately inventoried as repositories.",
    "The capture tool performs read-only Git and filesystem inspection of sibling repositories.",
    "A null HEAD means the repository is unborn and has no immutable commit identity.",
  ],
  buildStatusEvidence: existsSync(buildStatusFile) ? buildStatusFile : null,
  repositories: records,
};

function markdownFor(record) {
  if (!record.present) {
    return `## ${record.id}\n\nRepository missing at \`${record.directory}\`.\n`;
  }
  const remoteLines = record.remotes.flatMap((remote) => [
    ...remote.fetch.map((url) => `- fetch \`${remote.name}\`: \`${url}\``),
    ...remote.push.map((url) => `- push \`${remote.name}\`: \`${url}\``),
  ]);
  const locks = record.dependencyFiles.length === 0
    ? "- None found."
    : record.dependencyFiles.map((file) => `- \`${file.path}\` — \`${file.sha256}\` (${file.bytes} bytes)`).join("\n");
  const status = record.status.entries.length === 0
    ? "(empty)"
    : record.status.entries.join("\n");
  return [
    `## ${record.id}`,
    "",
    `- Kind: \`${record.kind}\``,
    `- Directory: \`${record.directory}\``,
    `- HEAD: ${record.head ? `\`${record.head}\`` : "unborn"}`,
    `- Branch: ${record.branch ? `\`${record.branch}\`` : "detached/none"}`,
    `- Upstream: ${record.upstream ? `\`${record.upstream}\`` : "none"}`,
    `- Status manifest SHA-256: \`${record.status.sha256}\``,
    `- Build status: \`${record.buildStatus.status}\` — ${record.buildStatus.summary ?? record.buildStatus.reason ?? "see JSON evidence"}`,
    "",
    "Remotes:",
    "",
    ...(remoteLines.length > 0 ? remoteLines : ["- None."]),
    "",
    "Dependency manifests and locks:",
    "",
    locks,
    "",
    "Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):",
    "",
    "```text",
    status,
    "```",
    "",
  ].join("\n");
}

const markdown = [
  "# Source-state provenance",
  "",
  `Captured at \`${capturedAt}\` for OpenSpec task 1.1.`,
  "",
  "This is an observational record. No sibling checkout was cleaned, reset, staged, committed, or otherwise modified by the capture tool. The JSON companion is authoritative for exact arrays and hashes.",
  "",
  ...records.map(markdownFor),
].join("\n");

mkdirSync(dirname(outputBase), { recursive: true });
writeFileSync(`${outputBase}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
writeFileSync(`${outputBase}.md`, `${markdown}\n`);
console.log(`${outputBase}.json`);
console.log(`${outputBase}.md`);
