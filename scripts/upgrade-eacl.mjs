import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SHA1 = /^[0-9a-f]{40}$/u;
const root = path.resolve(import.meta.dirname, "..");
const lockPath = path.join(root, "dependencies", "eacl-core.lock.json");
const reference = process.argv[2];

if (!reference || reference.startsWith("-")) {
  throw new Error("usage: npm run upgrade:eacl -- <EACL commit, branch, or tag>");
}

const lock = JSON.parse(await readFile(lockPath, "utf8"));
if (lock?.schema !== "eacl-demo.eacl-core-lock.v1" || !SHA1.test(lock.sha)) {
  throw new Error("dependencies/eacl-core.lock.json is invalid");
}

const resolved = await resolveReference(lock.repository, reference);
const oldSha = lock.sha;
const changed = [];

for (const relative of trackedFiles()) {
  if (relative === "dependencies/eacl-core.lock.json" || !isCurrentSource(relative)) continue;
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) continue;
  const source = await readFile(absolute, "utf8");
  if (!source.includes(oldSha)) continue;
  const updated = source.replaceAll(oldSha, resolved.sha);
  if (updated !== source) {
    await writeFile(absolute, updated);
    changed.push(relative);
  }
}

lock.sha = resolved.sha;
await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
changed.push("dependencies/eacl-core.lock.json");

run("node", ["scripts/prepare-eacl-core.mjs"]);
run("node", ["scripts/build-release-report.mjs", "--write"]);

const stale = trackedFiles().filter((relative) => isCurrentSource(relative))
  .filter((relative) => existsSync(path.join(root, relative)))
  .filter((relative) => outputContains(path.join(root, relative), oldSha));
if (oldSha !== resolved.sha && stale.length > 0) {
  throw new Error(`old EACL SHA remains in current source: ${stale.join(", ")}`);
}

process.stdout.write([
  `EACL ${oldSha} -> ${resolved.sha}`,
  `Resolved from ${resolved.remoteRef}`,
  `Updated ${new Set(changed).size} tracked files.`,
  "Push the resulting commit to main to rebuild and deploy every live demo.",
  ""
].join("\n"));

async function resolveReference(repository, input) {
  if (SHA1.test(input)) {
    await verifyFetch(repository, input);
    return { sha: input, remoteRef: input };
  }
  const requested = input.startsWith("refs/")
    ? [input]
    : [`refs/heads/${input}`, `refs/tags/${input}^{}`, `refs/tags/${input}`];
  const rows = execFileSync("git", ["ls-remote", repository, ...requested], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  }).trim().split(/\r?\n/u).filter(Boolean).map((line) => line.split(/\s+/u));
  if (rows.length === 0) throw new Error(`EACL reference does not exist: ${input}`);
  const dereferenced = rows.find(([, remoteRef]) => remoteRef.endsWith("^{}"));
  const [sha, remoteRef] = dereferenced ?? rows[0];
  if (!SHA1.test(sha)) throw new Error(`EACL reference did not resolve to a commit: ${input}`);
  await verifyFetch(repository, sha);
  return { sha, remoteRef };
}

async function verifyFetch(repository, sha) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-demo-upgrade-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: temporary, stdio: "ignore" });
    execFileSync("git", ["fetch", "--quiet", "--depth=1", repository, sha], {
      cwd: temporary,
      stdio: "inherit"
    });
    const fetched = execFileSync("git", ["rev-parse", "FETCH_HEAD"], {
      cwd: temporary,
      encoding: "utf8"
    }).trim();
    if (fetched !== sha) throw new Error(`fetched ${fetched}, expected ${sha}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean);
}

function isCurrentSource(relative) {
  if (relative.startsWith("docs/provenance/") || relative.startsWith("openspec/")) return false;
  if (relative.startsWith("verification/")
      && !relative.endsWith(".latest.json")
      && !/\.(?:[cm]?js|ts)$/u.test(relative)) return false;
  return !relative.endsWith(".jar") && !relative.endsWith(".png") && !relative.endsWith(".zip");
}

function outputContains(file, needle) {
  const result = spawnSync("rg", ["-q", "--fixed-strings", needle, file], { stdio: "ignore" });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`rg failed for ${file} with status ${result.status}`);
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}
