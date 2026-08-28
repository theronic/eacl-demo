import path from "node:path";
import process from "node:process";

import { writeJvmBuildIdentity } from "./lib/jvm-build-identity.mjs";

const root = path.resolve(import.meta.dirname, "..");
const [output] = process.argv.slice(2);
if (!output || path.isAbsolute(output)) {
  throw new Error("usage: node scripts/generate-jvm-build-identity.mjs <repository-relative-class-directory>");
}
const classDirectory = path.resolve(root, output);
if (!classDirectory.startsWith(`${root}${path.sep}`)) {
  throw new Error("JVM build identity output escapes the repository");
}
const identity = await writeJvmBuildIdentity(root, classDirectory);
process.stdout.write(`${identity.eaclSha}\n`);
