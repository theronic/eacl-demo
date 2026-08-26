import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

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
  const lockPath = "dependencies/eacl-core.lock.json";
  const workingLock = readFileSync(path.join(root, lockPath));
  const committedLock = git(["show", `${expectedDemoSha}:${lockPath}`], "buffer");
  if (!workingLock.equals(committedLock)) throw new Error("working EACL lock differs from the lock committed at GITHUB_SHA");
  const lock = JSON.parse(committedLock.toString("utf8"));
  if (lock.schema !== "eacl-demo.eacl-core-lock.v1" || lock.repository !== "https://github.com/theronic/eacl.git" || !SHA1.test(lock.sha)) throw new Error("committed EACL lock identity is invalid");
  return Object.freeze({ demoSha: head, eaclSha: lock.sha });
}
