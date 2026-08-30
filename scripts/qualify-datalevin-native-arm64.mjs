import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  atMost,
  maximumVersion,
  parseGlibcVersions,
  parseNeededLibraries,
  parseRuntimePaths
} from "./lib/elf-abi.mjs";

const root = path.resolve(import.meta.dirname, "..");
const argumentsList = process.argv.slice(2);
const reportOnly = argumentsList.includes("--report-only");
let artifactPath;
const allowed = new Set(["--artifact", "--report-only"]);
for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--artifact") {
    index += 1;
    if (index >= argumentsList.length) throw new Error(`${argument} requires a path`);
    artifactPath = path.resolve(argumentsList[index]);
  } else if (!allowed.has(argument)) {
    throw new Error(`unknown argument: ${argument}`);
  }
}
if (!artifactPath) throw new Error("--artifact is required");

const maximumAllowedGlibc = "2.34";
const artifact = await readFile(artifactPath);
const details = await stat(artifactPath);
assert.equal(details.isFile(), true, "native artifact must be a regular file");

const names = outputText("unzip", ["-Z1", artifactPath]).trim().split("\n").filter(Boolean);
const libraryNames = names.filter((name) => /\.so(?:\.[0-9]+)*$/u.test(name)).sort();
assert.ok(libraryNames.length > 0, "native artifact contains no shared libraries");
for (const name of libraryNames) {
  assert.match(name, /^datalevin\/dtlvnative\/linux-arm64\/[^/]+\.so(?:\.[0-9]+)*$/u,
    `native artifact contains a shared library outside the Linux arm64 runtime path: ${name}`);
}
assert.equal(names.some((name) => /\.(?:dylib|dll)$/u.test(name)), false,
  "native artifact contains a non-Linux shared library");

const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-datalevin-native-abi-"));
const reports = [];
try {
  for (const libraryName of libraryNames) {
    const bytes = outputBytes("unzip", ["-p", artifactPath, libraryName]);
    const librarySha256 = sha256(bytes);
    const localPath = path.join(temporary, path.basename(libraryName));
    await writeFile(localPath, bytes, { flag: "wx", mode: 0o600 });
    const format = outputText("file", ["-b", localPath]);
    assert.match(format, /ELF 64-bit LSB shared object, ARM aarch64/u,
      `${libraryName} is not Linux AArch64 ELF64`);
    const dynamic = outputText("objdump", ["-p", localPath]);
    const symbols = outputText("objdump", ["-T", localPath]);
    const glibcVersions = parseGlibcVersions(symbols);
    const maximumRequiredGlibc = maximumVersion(glibcVersions);
    const needed = parseNeededLibraries(dynamic);
    const runtimePaths = parseRuntimePaths(dynamic);
    const glibcCompatible = atMost(maximumRequiredGlibc, maximumAllowedGlibc);
    const runtimePathsCompatible = runtimePaths.every((runtimePath) => runtimePath === "$ORIGIN");
    reports.push({
      path: libraryName,
      sha256: librarySha256,
      format: format.trim(),
      maximumRequiredGlibc,
      glibcCompatible,
      runtimePaths,
      runtimePathsCompatible,
      compatible: glibcCompatible && runtimePathsCompatible,
      needed
    });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const report = {
  schema: "eacl-demo.datalevin-native-abi-report.v1",
  artifact: path.relative(root, artifactPath),
  artifactSha256: sha256(artifact),
  platform: "linux/arm64",
  lambdaRuntime: "java25",
  maximumAllowedGlibc,
  compatible: reports.every(({ compatible }) => compatible),
  libraries: reports
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.compatible && !reportOnly) process.exitCode = 1;

function outputText(command, args) {
  return output(command, args, "utf8");
}

function outputBytes(command, args) {
  return output(command, args, null);
}

function output(command, args, encoding) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr ?? "");
    throw new Error(`${command} failed: ${error.trim().slice(0, 500)}`);
  }
  return result.stdout;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
