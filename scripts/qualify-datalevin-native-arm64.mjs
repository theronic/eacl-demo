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
let expectationsPath = path.join(root, "dependencies/datalevin-memory.v1.json");
const allowed = new Set(["--artifact", "--expectations", "--report-only"]);
for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--artifact" || argument === "--expectations") {
    index += 1;
    if (index >= argumentsList.length) throw new Error(`${argument} requires a path`);
    if (argument === "--artifact") artifactPath = path.resolve(argumentsList[index]);
    else expectationsPath = path.resolve(argumentsList[index]);
  } else if (!allowed.has(argument)) {
    throw new Error(`unknown argument: ${argument}`);
  }
}
if (!artifactPath) throw new Error("--artifact is required");

const expectationsDocument = JSON.parse(await readFile(expectationsPath, "utf8"));
const expected = expectationsDocument.native ?? expectationsDocument;
assert.equal(typeof expected, "object", "native expectations must be an object");
assert.equal(expected.platform, "linux/arm64", "native expectations must target Linux arm64");
assert.equal(expected.lambdaOperatingSystem, "Amazon Linux 2023");
assert.equal(expected.lambdaGlibc, "2.34");
assert.ok(Array.isArray(expected.libraries) && expected.libraries.length > 0,
  "native expectations must declare libraries");
const artifact = await readFile(artifactPath);
const details = await stat(artifactPath);
assert.equal(details.isFile(), true, "native artifact must be a regular file");
assert.equal(artifact.length, expected.artifactBytes, "native artifact size differs from expectations");
assert.equal(sha256(artifact), expected.artifactSha256, "native artifact digest differs from expectations");

const names = outputText("unzip", ["-Z1", artifactPath]).trim().split("\n").filter(Boolean);
const expectedNames = expected.libraries.map(({ path: name }) => name).sort();
for (const name of expectedNames) assert.ok(names.includes(name), `native artifact is missing ${name}`);
assert.deepEqual(names.filter((name) => /\.(?:so|dylib|dll)$/u.test(name)).sort(), expectedNames,
  "native artifact contains an unexpected shared library");

const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-datalevin-native-abi-"));
const reports = [];
try {
  for (const expectedLibrary of expected.libraries) {
    const bytes = outputBytes("unzip", ["-p", artifactPath, expectedLibrary.path]);
    assert.equal(sha256(bytes), expectedLibrary.sha256,
      `${expectedLibrary.path} digest differs from expectations`);
    const localPath = path.join(temporary, path.basename(expectedLibrary.path));
    await writeFile(localPath, bytes, { flag: "wx", mode: 0o600 });
    const format = outputText("file", ["-b", localPath]);
    assert.match(format, /ELF 64-bit LSB shared object, ARM aarch64/u,
      `${expectedLibrary.path} is not Linux AArch64 ELF64`);
    const dynamic = outputText("objdump", ["-p", localPath]);
    const symbols = outputText("objdump", ["-T", localPath]);
    const glibcVersions = parseGlibcVersions(symbols);
    const maximumRequiredGlibc = maximumVersion(glibcVersions);
    const needed = parseNeededLibraries(dynamic);
    const runtimePaths = parseRuntimePaths(dynamic);
    assert.equal(maximumRequiredGlibc, expectedLibrary.maximumRequiredGlibc,
      `${expectedLibrary.path} glibc evidence differs from expectations`);
    assert.deepEqual(needed, [...expectedLibrary.needed].sort(),
      `${expectedLibrary.path} dependency closure differs from expectations`);
    if (expectedLibrary.runtimePaths) {
      assert.deepEqual(runtimePaths, [...expectedLibrary.runtimePaths].sort(),
        `${expectedLibrary.path} runtime paths differ from expectations`);
    }
    const glibcCompatible = atMost(maximumRequiredGlibc, expected.lambdaGlibc);
    const runtimePathsCompatible = runtimePaths.every((runtimePath) => runtimePath === "$ORIGIN");
    reports.push({
      path: expectedLibrary.path,
      sha256: expectedLibrary.sha256,
      format: expectedLibrary.format,
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
  expectations: path.relative(root, expectationsPath),
  artifactSha256: expected.artifactSha256,
  platform: expected.platform,
  lambdaRuntime: expected.lambdaRuntime,
  maximumAllowedGlibc: expected.lambdaGlibc,
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
