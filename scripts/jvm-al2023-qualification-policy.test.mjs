import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(
  new URL("./qualify-jvm-artifacts-al2023.sh", import.meta.url), "utf8"
);
const toolchain = JSON.parse(await readFile(
  new URL("../toolchain.json", import.meta.url), "utf8"
));

test("AL2023 JVM qualification pins architecture and every downloaded tool byte", () => {
  assert.match(script, /uname -m[\s\S]*x86_64/u);
  assert.match(script, /--proto '=https' --tlsv1\.2/u);
  const nodeArchive = `node-v${toolchain.javascript.node}-linux-x64.tar.xz`;
  assert.match(script, new RegExp(nodeArchive.replaceAll(".", "\\."), "u"));
  assert.match(script, new RegExp(`[0-9a-f]{64}  ${nodeArchive.replaceAll(".", "\\.")}`, "u"));
  assert.match(script, new RegExp(toolchain.jvm.linuxX64Archive.replaceAll(".", "\\."), "u"));
  assert.match(script, new RegExp(toolchain.jvm.linuxX64ArchiveSha256, "u"));
  assert.match(script, new RegExp(toolchain.jvm.clojureCliArchive.replaceAll(".", "\\."), "u"));
  assert.match(script, new RegExp(toolchain.jvm.clojureCliArchiveSha256, "u"));
});

test("qualification double-builds and audits every current JVM artifact", () => {
  for (const command of [
    "verify-datahike-s3-artifact-determinism.mjs",
    "audit-datahike-s3-lambda-artifact.mjs",
    "verify-datahike-dynamodb-artifact-determinism.mjs",
    "audit-datahike-dynamodb-lambda-artifact.mjs",
    "verify-datomic-artifact-determinism.mjs",
    "audit-datomic-lambda-artifact.mjs",
    "audit-datomic-seed-artifact.mjs"
  ]) assert.match(script, new RegExp(command.replaceAll(".", "\\."), "u"));
  assert.match(script, /trap cleanup EXIT/u);
  assert.match(script, /find "\$\{qualification_tmp\}" -mindepth 1 -delete/u);
});
