import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeFixtureNdjson } from "../packages/fixture-generator/batching.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-jank-native-test-"));

try {
  const flags = execFileSync("pkg-config", ["--cflags", "--libs", "libcurl", "json-c", "openssl"], { encoding: "utf8" }).trim().split(/\s+/u).filter(Boolean);
  const runtimeTest = compile("runtime_api_test.cpp", "runtime-api-test", flags);
  execFileSync(runtimeTest, [], { cwd: root, stdio: "inherit" });

  const fixtureFile = path.join(temporary, "fixture-10000.ndjson");
  const stream = createWriteStream(fixtureFile, { encoding: "utf8", flags: "wx" });
  await writeFixtureNdjson(10_000, stream);
  await new Promise((resolve, reject) => stream.end(resolve).on("error", reject));
  const fixtureTest = compile("fixture_reader_test.cpp", "fixture-reader-test", flags);
  execFileSync(fixtureTest, [fixtureFile], { cwd: root, stdio: "inherit" });
  console.log("Jank native Runtime API and canonical fixture reader tests passed");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function compile(source, name, flags) {
  const output = path.join(temporary, name);
  execFileSync("c++", [
    "-std=c++20",
    "-Wall",
    "-Wextra",
    "-Wno-unused-function",
    "-I", path.join(root, "services/jank-memory/native"),
    path.join(root, "test/jank", source),
    ...flags,
    "-o", output
  ], { cwd: root, stdio: "inherit" });
  return output;
}
