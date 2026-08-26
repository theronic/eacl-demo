import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const toolchain = JSON.parse(await readFile(path.join(root, "toolchain.json"), "utf8"));
const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin") : null;
const javaCommand = javaBin ? path.join(javaBin, "java") : "java";
const childPath = [path.dirname(process.execPath), javaBin, process.env.PATH]
  .filter((entry) => typeof entry === "string" && entry.length > 0)
  .join(path.delimiter);
const childEnvironment = { ...process.env, PATH: childPath };

if (process.versions.node !== toolchain.javascript.node) {
  throw new Error(`Datahike/S3 artifact determinism requires Node ${toolchain.javascript.node}; running ${process.versions.node}`);
}

const javaVersion = output(javaCommand, ["-version"]);
const javaRelease = toolchain.jvm.javaRuntimeRelease;
const javaBuild = toolchain.jvm.javaRuntimeBuild;
if (!new RegExp(`(?:openjdk|java) version "${escapeRegex(javaRelease)}"`, "iu").test(javaVersion)
    || !new RegExp(`Temurin-${escapeRegex(javaRelease)}\\+${escapeRegex(javaBuild)}(?:\\D|$)`, "u").test(javaVersion)) {
  throw new Error(`Datahike/S3 artifact determinism requires Java ${toolchain.jvm.java} (runtime ${javaRelease}+${javaBuild}); received ${firstLine(javaVersion)}`);
}

const clojureDescription = output("clojure", ["-Sdescribe"]);
if (!clojureDescription.includes(`:version "${toolchain.jvm.clojureCli}"`)) {
  throw new Error(`Datahike/S3 artifact determinism requires Clojure CLI ${toolchain.jvm.clojureCli}`);
}

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

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}: ${firstLine(result.stderr)}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function firstLine(value) {
  return value.trim().split("\n", 1)[0] ?? "unknown Java";
}
