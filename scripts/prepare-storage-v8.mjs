import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLockedEaclCore } from "./lib/prepare-eacl-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.argv[2];
if (!["datahike-s3", "datahike-dynamodb", "datomic-dynamodb"].includes(profile)) {
  throw new Error("An exact migration profile is required");
}
await prepareLockedEaclCore(root);
const work = path.join(root, "target/storage-v8", profile);
await mkdir(work, { recursive: true });
const aliases = profile === "datomic-dynamodb"
  ? ":datomic-dynamodb:storage-migration"
  : ":datahike-s3:datahike-dynamodb-maintenance:storage-migration";
const classpath = execFileSync("clojure", ["-Spath", `-M${aliases}`],
  { cwd: root, encoding: "utf8" }).trim();
await writeFile(path.join(work, "java-command.json"), JSON.stringify([
  "java", "-Xms1g", profile === "datomic-dynamodb" ? "-Xmx8g" : "-Xmx12g",
  "-cp", classpath, "clojure.main", "-m", "eacl-demo.storage-v8"
]));
if (profile === "datomic-dynamodb") {
  const archive = path.join(work, "datomic-pro.zip");
  execFileSync("curl", ["--fail", "--silent", "--show-error", "--location",
    "--proto", "=https", "--tlsv1.2",
    "https://datomic-pro-downloads.s3.amazonaws.com/1.0.7705/datomic-pro-1.0.7705.zip",
    "--output", archive], { stdio: "inherit" });
  const bytes = await readFile(archive);
  if (bytes.length !== 272642957 || createHash("sha256").update(bytes).digest("hex") !==
      "a17c2603b893dfb0d998a35a032a7295736d234d32937222c8ec21d81a1b8c7e") {
    throw new Error("Datomic transactor distribution does not match its reviewed pin");
  }
  execFileSync("unzip", ["-oq", archive, "-d", work], { stdio: "inherit" });
}
