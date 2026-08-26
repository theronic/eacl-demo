import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const aliases = ["test", "nrepl", "datascript-worker", "datahike-s3", "datahike-s3-upstream-audit", "datahike-dynamodb", "datahike-dynamodb-upstream-audit", "datomic-dynamodb", "datalevin-memory"];
const byPath = new Map();
for (const alias of aliases) {
  const classpath = execFileSync("clojure", [`-A:${alias}`, "-Spath"], {
    cwd: root, encoding: "utf8"
  }).trim();
  for (const entry of classpath.split(path.delimiter)) {
    if (!entry.endsWith(".jar")) continue;
    const bytes = await readFile(entry);
    const normalized = entry.includes(`${path.sep}.m2${path.sep}`)
      ? entry.slice(entry.indexOf(`${path.sep}.m2${path.sep}`) + 5).split(path.sep).join("/")
      : path.basename(entry);
    const locked = {
      path: normalized,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length
    };
    const existing = byPath.get(normalized);
    if (existing && (existing.sha256 !== locked.sha256 || existing.bytes !== locked.bytes)) {
      throw new Error(`conflicting JVM artifact bytes for ${normalized}`);
    }
    byPath.set(normalized, {
      ...(existing ?? locked),
      aliases: [...new Set([...(existing?.aliases ?? []), alias])].sort()
    });
  }
}
const artifacts = [...byPath.values()];
artifacts.sort((a, b) => a.path.localeCompare(b.path));
const lock = {
  schemaVersion: 1,
  source: "deps.edn",
  resolutionStrategy: "independent-alias-union",
  aliases,
  artifacts
};
await writeFile(path.join(root, "dependencies/jvm.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
console.log(`locked ${artifacts.length} JVM artifacts`);
