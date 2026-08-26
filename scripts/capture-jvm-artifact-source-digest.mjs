import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const profiles = Object.freeze({
  "datahike-s3": {
    service: "services/datahike-s3",
    dependencies: []
  },
  "datahike-dynamodb": {
    service: "services/datahike-dynamodb",
    dependencies: ["dependencies/datahike-dynamodb-adapter.v1.json"]
  },
  "datomic-dynamodb": {
    service: "services/datomic-dynamodb",
    dependencies: ["dependencies/datomic-dynamodb.v1.json"]
  }
});
const profileId = process.argv[2];
const profile = profiles[profileId];
if (!profile) throw new Error("expected one current JVM profile ID");

const roots = [
  "build.clj",
  "deps.edn",
  "toolchain.json",
  "dependencies/eacl-core.lock.json",
  "dependencies/jvm.lock.json",
  "fixtures/schema-wire.v1.json",
  "packages/contracts/src/eacl_demo/contracts",
  "scripts/lib/prepare-eacl-core.mjs",
  "scripts/normalize-zip.py",
  "scripts/prepare-eacl-core.mjs",
  profile.service,
  ...profile.dependencies
];
const files = [];
for (const relative of roots) files.push(...await enumerate(relative));
files.sort();
const unique = [...new Set(files)];
const digest = createHash("sha256");
const records = [];
for (const relative of unique) {
  const bytes = await readFile(path.join(root, relative));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  digest.update(relative).update("\0").update(sha256).update("\n");
  records.push({ path: relative, sha256, bytes: bytes.length });
}
process.stdout.write(`${JSON.stringify({
  schema: "eacl-demo.jvm-artifact-source-digest.v1",
  profileId,
  method: "sha256(sorted relative-path NUL file-sha256 LF)",
  fileCount: records.length,
  digest: `sha256:${digest.digest("hex")}`,
  records
}, null, 2)}\n`);

async function enumerate(relative) {
  const absolute = path.join(root, relative);
  const metadata = await stat(absolute);
  if (metadata.isSymbolicLink()) throw new Error(`source symlink is forbidden: ${relative}`);
  if (metadata.isFile()) return [relative];
  if (!metadata.isDirectory()) throw new Error(`unsupported source entry: ${relative}`);
  const result = [];
  for (const name of (await readdir(absolute)).sort()) {
    result.push(...await enumerate(path.posix.join(relative, name)));
  }
  return result;
}
