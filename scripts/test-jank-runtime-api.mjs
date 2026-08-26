import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeFixtureNdjson } from "../packages/fixture-generator/batching.mjs";

const includeStore = process.argv.includes("--store");
for (const argument of process.argv.slice(2)) {
  if (argument !== "--store") throw new Error(`unknown argument: ${argument}`);
}
const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-jank-runtime-test-"));
const fixtureFile = path.join(temporary, "fixture-10000.ndjson");
const fixtureStream = createWriteStream(fixtureFile, { encoding: "utf8", flags: "wx" });
await writeFixtureNdjson(10_000, fixtureStream);
await new Promise((resolve, reject) => fixtureStream.end(resolve).on("error", reject));
for (const [source, destination] of [
  ["fixtures/schema.v1.zed", "schema.v1.zed"],
  ["fixtures/schema-wire.v1.json", "schema-wire.v1.json"],
  ["fixtures/exemplars.v1.json", "exemplars.v1.json"],
  ["fixtures/manifests/fixture-10000.v1.json", "fixture-10000.v1.json"],
  ["verification/contracts/function-url-v2.cases.json", "function-url-v2.cases.json"]
]) await copyFile(path.join(root, source), path.join(temporary, destination));
const includeDirectories = [
  path.join(root, "services/jank-memory/native"),
  ...pkgConfigTokens(["--cflags-only-I", "libcurl", "json-c", "openssl"]).map((value) => value.replace(/^-I/u, ""))
];
const libraries = process.platform === "darwin"
  ? [
      path.join(exec("xcrun", ["--show-sdk-path"]), "usr/lib/libcurl.tbd"),
      path.join(pkgVariable("json-c", "libdir"), "libjson-c.dylib"),
      path.join(pkgVariable("openssl", "libdir"), "libcrypto.dylib")
    ]
  : [
      path.join(pkgVariable("libcurl", "libdir"), "libcurl.so"),
      path.join(pkgVariable("json-c", "libdir"), "libjson-c.so"),
      path.join(pkgVariable("openssl", "libdir"), "libcrypto.so")
    ];
for (const library of libraries) await access(library);

try {
const testFiles = ["runtime_api_test.jank", "function_url_test.jank", "dispatcher_test.jank", "response_test.jank", "fixture_test.jank", "profile_test.jank", "observability_test.jank", "main_namespace_test.jank"];
if (includeStore) testFiles.push("store_handlers_test.jank");
  for (const testFile of testFiles) {
    const argumentsList = [
      "run",
      "--module-path", [
        path.join(root, "services/jank-memory/src"),
        path.join(root, "test/jank-modules")
      ].join(path.delimiter),
      ...includeDirectories.flatMap((directory) => ["-I", directory]),
      ...libraries.flatMap((library) => ["-l", library]),
      path.join(root, "test/jank", testFile)
    ];
    execFileSync("jank", argumentsList, {
      cwd: root,
      env: {
        ...process.env,
        LAMBDA_TASK_ROOT: temporary,
        EACL_JANK_FIXTURE_PATH: fixtureFile,
        EACL_DEMO_SHA: "1".repeat(40),
        EACL_CORE_SHA: "1cbf80c7aaf4bfcf2564d2bf30135794ff406383",
        EACL_ARTIFACT_SHA256: "3".repeat(64),
        EACL_DEPLOYMENT_ID: "jank-local-test",
        EACL_DATA_MANIFEST_SHA256: "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a",
        AWS_LAMBDA_FUNCTION_MEMORY_SIZE: "4096"
      },
      stdio: "inherit"
    });
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function pkgVariable(pkg, variable) {
  return exec("pkg-config", ["--variable=" + variable, pkg]);
}

function pkgConfigTokens(args) {
  return exec("pkg-config", args).split(/\s+/u).filter(Boolean);
}

function exec(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}
