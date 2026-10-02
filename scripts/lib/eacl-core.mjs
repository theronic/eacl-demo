import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const EACL_REPOSITORY = "https://github.com/theronic/eacl.git";
export const DEPS_EDN_PATH = "deps.edn";
const SHA1 = /^[0-9a-f]{40}$/u;
const MAVEN_VERSION = /^[0-9][0-9A-Za-z.+-]*$/u;
// One dev.eacl coordinate map. Coordinate maps hold scalars and vectors only.
const EACL_COORDINATE = /(dev\.eacl\/eacl[a-z0-9-]*)\s*\{([^{}]*)\}/gu;

// deps.edn is the sole source of truth for the EACL release the demo runs.
// Every published dev.eacl module is a Maven coordinate, and all of them use
// the same :mvn/version. The release's source commit is the SHA embedded in
// target/eacl-core-source/<sha> paths: the unpublished eacl-datalevin module
// builds from that checkout. scripts/lib/prepare-eacl-core.mjs checks that the
// published POM names the same commit as its SCM tag.
export function parseEaclRelease(depsEdnText) {
  const text = String(depsEdnText);
  const where = (offset) => locate(text, offset);

  const versions = [];
  const modules = new Set(["modules/eacl"]);
  for (const match of text.matchAll(EACL_COORDINATE)) {
    const [, lib, body] = match;
    modules.add(`modules/${lib.slice("dev.eacl/".length)}`);
    if (/:git\//u.test(body)) {
      throw new Error(`deps.edn pins ${lib} as a Git dependency at ${where(match.index)}; use the published :mvn/version release`);
    }
    const version = /:mvn\/version\s+"([^"]*)"/u.exec(body)?.[1];
    if (version === undefined) continue;
    if (!MAVEN_VERSION.test(version)) {
      throw new Error(`deps.edn has a malformed ${lib} :mvn/version ${JSON.stringify(version)} at ${where(match.index)}`);
    }
    versions.push({ lib, version, offset: match.index });
  }
  if (versions.length === 0) throw new Error("deps.edn pins no published EACL release (a dev.eacl :mvn/version)");
  const distinctVersions = [...new Set(versions.map(({ version }) => version))];
  if (distinctVersions.length > 1) {
    const detail = distinctVersions.map((version) => {
      const first = versions.find((pin) => pin.version === version);
      return `${first.lib} ${version} at ${where(first.offset)}`;
    });
    throw new Error(`deps.edn EACL release versions disagree: ${detail.join(" vs ")}`);
  }

  const pins = [];
  for (const match of text.matchAll(/target\/eacl-core-source\/([^/"]*)/gu)) {
    if (!SHA1.test(match[1])) {
      throw new Error(`deps.edn has a malformed EACL source commit ${JSON.stringify(match[1])} at ${where(match.index)}`);
    }
    pins.push({ sha: match[1], offset: match.index });
  }
  if (pins.length === 0) throw new Error("deps.edn names no EACL release source commit (target/eacl-core-source/<sha>)");
  const shas = [...new Set(pins.map(({ sha }) => sha))];
  if (shas.length > 1) {
    const detail = shas.map((sha) => {
      const first = pins.find((pin) => pin.sha === sha);
      return `${sha} at ${where(first.offset)}`;
    });
    throw new Error(`deps.edn EACL source commits disagree: ${detail.join(" vs ")}`);
  }

  return Object.freeze({
    repository: EACL_REPOSITORY,
    version: distinctVersions[0],
    sha: shas[0],
    modules: Object.freeze([...modules].sort()),
  });
}

// The deployment identity of the pinned release: its source commit.
export function parseEaclCore(depsEdnText) {
  const { repository, sha, modules } = parseEaclRelease(depsEdnText);
  return Object.freeze({ repository, sha, modules });
}

export function readEaclRelease(root) {
  return parseEaclRelease(readFileSync(path.join(root, DEPS_EDN_PATH), "utf8"));
}

export function readEaclCore(root) {
  return parseEaclCore(readFileSync(path.join(root, DEPS_EDN_PATH), "utf8"));
}

export function committedDepsEdn(root, demoSha) {
  if (!SHA1.test(demoSha ?? "")) throw new Error("a lowercase 40-hex demo commit is required to read the committed deps.edn");
  return execFileSync("git", ["show", `${demoSha}:${DEPS_EDN_PATH}`], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function committedEaclCore(root, demoSha) {
  return parseEaclCore(committedDepsEdn(root, demoSha).toString("utf8"));
}

// The source commit a published dev.eacl POM records as its SCM tag.
export function pomScmTag(pomText) {
  const scm = /<scm>([\s\S]*?)<\/scm>/u.exec(String(pomText))?.[1] ?? "";
  const tag = /<tag>\s*([^<\s]*)\s*<\/tag>/u.exec(scm)?.[1];
  return tag !== undefined && SHA1.test(tag) ? tag : null;
}

function locate(text, offset) {
  const before = text.slice(0, offset).split("\n");
  const line = before.length;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const alias = /^\s?\{?\s?(:[a-z][a-z0-9-]*)\s*$/u.exec(before[index].trimEnd());
    if (alias) return `alias ${alias[1]} (line ${line})`;
  }
  return `line ${line}`;
}
