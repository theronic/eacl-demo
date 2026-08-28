import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";

import { loadLockedJvmBuildIdentity, readJvmBuildIdentityFromJar } from "./lib/jvm-build-identity.mjs";

const root = path.resolve(import.meta.dirname, "..");
const [input] = process.argv.slice(2);
if (!input || path.isAbsolute(input)) {
  throw new Error("usage: node scripts/verify-jvm-build-identity.mjs <repository-relative-jar>");
}
const archive = path.resolve(root, input);
if (!archive.startsWith(`${root}${path.sep}`)) {
  throw new Error("JVM build identity input escapes the repository");
}
assert.deepEqual(readJvmBuildIdentityFromJar(archive), await loadLockedJvmBuildIdentity(root),
  "the JAR's baked EACL identity differs from the committed Core lock");
process.stdout.write(`verified baked EACL identity in ${input}\n`);
