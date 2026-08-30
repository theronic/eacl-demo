import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin") : null;
const childPath = [path.dirname(process.execPath), javaBin, process.env.PATH]
  .filter((entry) => typeof entry === "string" && entry.length > 0)
  .join(path.delimiter);
const childEnvironment = { ...process.env, PATH: childPath };

const artifacts = [
  { task: "datomic-lambda", path: "dist/datomic-dynamodb/function.jar" },
  { task: "datomic-seed", path: "dist/datomic-dynamodb-seed/seed.jar" }
];

for (const artifact of artifacts) {
  const first = await build(artifact);
  const second = await build(artifact);
  if (first.sha256 !== second.sha256 || first.bytes !== second.bytes) {
    throw new Error(`${artifact.task} builds differ: ${JSON.stringify({ first, second })}`);
  }
  console.log(`${artifact.task}\tsha256:${second.sha256}\t${second.bytes} bytes\tbyte-for-byte reproducible`);
}

async function build({ task, path: relative }) {
  execFileSync("clojure", ["-T:build", task], {
    cwd: root,
    env: childEnvironment,
    stdio: "inherit"
  });
  const bytes = await readFile(path.join(root, relative));
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}
