import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DEPS_EDN_PATH, EACL_REPOSITORY, pomScmTag, readEaclRelease } from "./lib/eacl-core.mjs";

const CLOJARS = "https://repo.clojars.org";
const MAVEN_VERSION = /^[0-9][0-9A-Za-z.+-]*$/u;
const root = path.resolve(import.meta.dirname, "..");
const version = process.argv[2];

if (!version || !MAVEN_VERSION.test(version)) {
  throw new Error("usage: npm run upgrade:eacl -- <published EACL version, e.g. 8.0.0-RC-2026-10-02>");
}

const previous = readEaclRelease(root);
const depsEdn = await readFile(path.join(root, DEPS_EDN_PATH), "utf8");
const publishedArtifacts = [...new Set([...depsEdn.matchAll(
  /dev\.eacl\/(eacl[a-z0-9-]*)\s*\{\s*:mvn\/version\s+"/gu)].map((match) => match[1]))].sort();
const sha = await publishedSourceCommit(version, publishedArtifacts);
await verifyFetch(EACL_REPOSITORY, sha);
const changed = [];

for (const relative of trackedFiles()) {
  if (!isCurrentSource(relative)) continue;
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) continue;
  const source = await readFile(absolute, "utf8");
  let updated = source.replaceAll(previous.sha, sha);
  if (relative === DEPS_EDN_PATH) {
    updated = updated.replace(
      /(dev\.eacl\/eacl[a-z0-9-]*\s*\{\s*:mvn\/version\s+")([^"]*)(")/gu,
      (_, before, current, after) => current === previous.version ? `${before}${version}${after}` : `${before}${current}${after}`);
  }
  if (updated !== source) {
    await writeFile(absolute, updated);
    changed.push(relative);
  }
}

const identity = readEaclRelease(root);
if (identity.version !== version || identity.sha !== sha) {
  throw new Error(`deps.edn pins ${identity.version} (source ${identity.sha}) after the rewrite; expected ${version} (source ${sha})`);
}

run("node", ["scripts/prepare-eacl-core.mjs"]);

const stale = staleFiles(previous.sha, sha);
if (stale.length > 0) {
  throw new Error(`old EACL source commit remains in current source: ${stale.join(", ")}`);
}

process.stdout.write([
  `EACL ${previous.version} (source ${previous.sha}) -> ${version} (source ${sha})`,
  `Updated ${new Set(changed).size} tracked files.`,
  "Ship it as described in DEPLOY.md; the production push rebuilds and deploys every live demo.",
  ""
].join("\n"));

// Every published module the demo pins must exist at this version and name
// one source commit as its SCM tag.
async function publishedSourceCommit(release, artifacts) {
  const tags = new Map();
  for (const artifact of artifacts) {
    const url = `${CLOJARS}/dev/eacl/${artifact}/${release}/${artifact}-${release}.pom`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`dev.eacl/${artifact} ${release} is not published on Clojars (${response.status} ${url})`);
    const tag = pomScmTag(await response.text());
    if (!tag) throw new Error(`dev.eacl/${artifact} ${release} records no source commit as its SCM tag`);
    tags.set(artifact, tag);
  }
  const commits = [...new Set(tags.values())];
  if (commits.length !== 1) {
    throw new Error(`dev.eacl ${release} modules name different source commits: ${JSON.stringify(Object.fromEntries(tags))}`);
  }
  return commits[0];
}

async function verifyFetch(repository, commit) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-demo-upgrade-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: temporary, stdio: "ignore" });
    execFileSync("git", ["fetch", "--quiet", "--depth=1", repository, commit], {
      cwd: temporary,
      stdio: "inherit"
    });
    const fetched = execFileSync("git", ["rev-parse", "FETCH_HEAD"], {
      cwd: temporary,
      encoding: "utf8"
    }).trim();
    if (fetched !== commit) throw new Error(`fetched ${fetched}, expected ${commit}`);
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
      && !/\.(?:[cm]?js|ts)$/u.test(relative)) return false;
  return !relative.endsWith(".jar") && !relative.endsWith(".png") && !relative.endsWith(".zip");
}

function staleFiles(needle, replacement) {
  if (needle === replacement) return [];
  let result;
  try {
    result = execFileSync("git",
      ["grep", "--untracked", "-l", "--fixed-strings", "-e", needle, "--", "."],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (error?.status === 1) return [];
    throw error;
  }
  return result.split("\n").filter(Boolean)
    .filter((relative) => isCurrentSource(relative))
    .filter((relative) => existsSync(path.join(root, relative)));
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}
