import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEPS_EDN_PATH, parseEaclCore } from "./eacl-core.mjs";

const SHA1 = /^[0-9a-f]{40}$/u;

export function verifyCheckedOutIdentity(root, expectedDemoSha) {
  if (!SHA1.test(expectedDemoSha ?? "")) throw new Error("GITHUB_SHA must identify the exact triggering demo commit");
  const git = (args, encoding = "utf8") => execFileSync("git", args, {
    cwd: root,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const head = git(["rev-parse", "--verify", "HEAD"]).trim();
  if (head !== expectedDemoSha) throw new Error("checked-out demo commit does not match GITHUB_SHA");
  try {
    git(["diff", "--quiet", "--no-ext-diff"]);
    git(["diff", "--cached", "--quiet", "--no-ext-diff"]);
  } catch {
    throw new Error("checked-out tracked files differ from the triggering demo commit");
  }
  const workingDeps = readFileSync(path.join(root, DEPS_EDN_PATH));
  const committedDeps = git(["show", `${expectedDemoSha}:${DEPS_EDN_PATH}`], "buffer");
  if (!workingDeps.equals(committedDeps)) throw new Error("working deps.edn differs from the deps.edn committed at GITHUB_SHA");
  const core = parseEaclCore(committedDeps.toString("utf8"));
  return Object.freeze({ demoSha: head, eaclSha: core.sha });
}
