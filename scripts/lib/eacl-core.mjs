import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const EACL_REPOSITORY = "https://github.com/theronic/eacl.git";
export const DEPS_EDN_PATH = "deps.edn";
const SHA1 = /^[0-9a-f]{40}$/u;

// deps.edn is the sole source of truth for the pinned EACL Core commit.
// Every pin must agree: :git/url values, :git/sha values, and the SHA
// embedded in target/eacl-core-source/<sha> paths (used by :extra-paths and
// the datalevin :local/root coordinate).
export function parseEaclCore(depsEdnText) {
  const text = String(depsEdnText);
  const where = (offset) => locate(text, offset);

  for (const match of text.matchAll(/:git\/url\s+"([^"]*)"/gu)) {
    if (match[1] !== EACL_REPOSITORY) {
      throw new Error(`deps.edn pins a non-canonical :git/url ${JSON.stringify(match[1])} at ${where(match.index)}; expected ${EACL_REPOSITORY}`);
    }
  }

  const pins = [];
  for (const match of text.matchAll(/:git\/sha\s+"([^"]*)"/gu)) {
    if (!SHA1.test(match[1])) {
      throw new Error(`deps.edn has a malformed :git/sha ${JSON.stringify(match[1])} at ${where(match.index)}`);
    }
    pins.push({ sha: match[1], offset: match.index });
  }
  for (const match of text.matchAll(/target\/eacl-core-source\/([0-9a-f]{40})/gu)) {
    pins.push({ sha: match[1], offset: match.index });
  }
  if (pins.length === 0) throw new Error("deps.edn contains no EACL Core pin");

  const shas = [...new Set(pins.map(({ sha }) => sha))];
  if (shas.length > 1) {
    const detail = shas.map((sha) => {
      const first = pins.find((pin) => pin.sha === sha);
      return `${sha} at ${where(first.offset)}`;
    });
    throw new Error(`deps.edn EACL Core pins disagree: ${detail.join(" vs ")}`);
  }

  const modules = new Set(["modules/eacl"]);
  for (const match of text.matchAll(/:(?:deps|local)\/root\s+"[^"]*?(modules\/eacl[a-z0-9-]*)"/gu)) {
    modules.add(match[1]);
  }
  return Object.freeze({
    repository: EACL_REPOSITORY,
    sha: shas[0],
    modules: Object.freeze([...modules].sort()),
  });
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

function locate(text, offset) {
  const before = text.slice(0, offset).split("\n");
  const line = before.length;
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const alias = /^\s?\{?\s?(:[a-z][a-z0-9-]*)\s*$/u.exec(before[index].trimEnd());
    if (alias) return `alias ${alias[1]} (line ${line})`;
  }
  return `line ${line}`;
}
