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

const first = await build();
const second = await build();
if (first.sha256 !== second.sha256 || first.bytes !== second.bytes) {
  throw new Error(`Datahike/S3 Lambda builds differ: ${JSON.stringify({ first, second })}`);
}
console.log(`datahike-s3-lambda\tsha256:${second.sha256}\t${second.bytes} bytes\tbyte-for-byte reproducible`);

async function build() {
  execFileSync("clojure", ["-T:build", "datahike-s3-lambda"], {
    cwd: root,
    env: childEnvironment,
    stdio: "inherit",
  });
  const bytes = await readFile(path.join(root, "dist/datahike-s3/function.jar"));
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}
