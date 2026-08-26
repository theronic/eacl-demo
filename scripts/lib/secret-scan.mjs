import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const RULES = [
  ["private-key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gu],
  ["aws-access-key", /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/gu],
  ["aws-secret-assignment", /\b(?:AWS_SECRET_ACCESS_KEY|aws_secret_access_key)\s*[=:]\s*["']?[A-Za-z0-9/+=]{30,}/gu],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/gu],
  ["telegram-bot-token", /(?<![A-Za-z0-9_.:-])[0-9]{8,12}:[A-Za-z0-9_-]{30,50}\b/gu],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu],
  ["basic-auth-url", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/giu],
  ["credential-query", /[?&](?:access_?key|secret(?:_?access)?_?key|password|passwd|token|signing_?key)=[^&\s"']+/giu],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu]
];

const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".cpcache", ".clj-kondo", "target"]);
const OWN_REPORT = "dist/secret-scan-report.json";

export function scanBytes(bytes, file = "<memory>") {
  const text = bytes.toString("latin1");
  const findings = [];
  for (const [rule, pattern] of RULES) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push({ rule, file, offset: match.index, fingerprint: fingerprint(match[0]) });
    }
  }
  return findings;
}

export async function scanTree(root) {
  const files = await enumerate(root);
  const findings = [];
  const categories = { staticBundles: 0, sourceMaps: 0, logs: 0, manifests: 0, other: 0 };
  let bytesScanned = 0;
  for (const relative of files) {
    if (relative === OWN_REPORT) continue;
    const bytes = await readFile(path.join(root, relative));
    bytesScanned += bytes.length;
    categories[classify(relative)] += 1;
    findings.push(...scanBytes(bytes, relative));
  }
  return { schema: "eacl-demo.secret-scan.v1", filesScanned: files.length - Number(files.includes(OWN_REPORT)), bytesScanned, categories, findings };
}

async function enumerate(directory, prefix = "") {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    if (SKIP_DIRECTORIES.has(name)) continue;
    const full = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const entryStat = await stat(full);
    if (entryStat.isSymbolicLink()) throw new Error(`secret scan refuses symlink: ${relative}`);
    if (entryStat.isDirectory()) files.push(...await enumerate(full, relative));
    else if (entryStat.isFile()) files.push(relative);
  }
  return files;
}

function classify(file) {
  if (file.endsWith(".map")) return "sourceMaps";
  if (file.endsWith(".log") || file.includes("/logs/")) return "logs";
  if (/manifest|descriptor|registry|artifact-digests|lock[.]/iu.test(file) || file.endsWith(".lock") || file.endsWith(".lock.json")) return "manifests";
  if (file.startsWith("dist/") || /[.](?:js|mjs|cjs|css|html)$/u.test(file)) return "staticBundles";
  return "other";
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
