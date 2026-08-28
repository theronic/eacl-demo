import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  JVM_BUILD_IDENTITY_RESOURCE,
  loadLockedJvmBuildIdentity,
  writeJvmBuildIdentity
} from "./lib/jvm-build-identity.mjs";

const root = path.resolve(import.meta.dirname, "..");
const handlers = [
  "services/datahike-s3/src/eacl_demo/datahike_s3/lambda_handler.clj",
  "services/datahike-dynamodb/src/eacl_demo/datahike_dynamodb/lambda_handler.clj",
  "services/datomic-dynamodb/src/eacl_demo/datomic_dynamodb/lambda_handler.clj",
  "services/datalevin-memory/src/eacl_demo/datalevin_memory/lambda_handler.clj"
];

test("the generated JVM identity is an exact deterministic projection of the Core lock", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-jvm-build-identity-"));
  try {
    const expected = await loadLockedJvmBuildIdentity(root);
    assert.deepEqual(await writeJvmBuildIdentity(root, temporary), expected);
    assert.equal(
      await readFile(path.join(temporary, ...JVM_BUILD_IDENTITY_RESOURCE.split("/")), "utf8"),
      `${JSON.stringify(expected)}\n`
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("every JVM service reports the baked SHA and only cross-checks an optional deployment assertion", async () => {
  const build = await readFile(path.join(root, "build.clj"), "utf8");
  assert.equal((build.match(/\(generate-build-identity! [^)]+\)/gu) ?? []).length, 4);
  assert.equal((build.match(/\(verify-build-identity! [^)]+\)/gu) ?? []).length, 4);
  for (const file of handlers) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.match(source, /\[eacl-demo\.contracts\.build-identity :as build-identity\]/u, file);
    assert.match(source, /baked-eacl-sha \(build-identity\/eacl-sha\)/u, file);
    assert.match(source, /:eaclSha baked-eacl-sha/u, file);
    assert.match(source, /declared-eacl-sha \(get environment "EACL_CORE_SHA"\)/u, file);
    assert.doesNotMatch(source, /def \^:private pinned-eacl-sha|:eaclSha \(get environment "EACL_CORE_SHA"\)/u, file);
  }
  const lifecycle = await readFile(path.join(root,
    "services/datalevin-memory/src/eacl_demo/datalevin_memory/lifecycle.clj"), "utf8");
  assert.match(lifecycle, /baked-eacl-sha \(build-identity\/eacl-sha\)/u);
  assert.match(lifecycle, /:eaclSha baked-eacl-sha/u);
  assert.doesNotMatch(lifecycle, /:eaclSha "EACL_CORE_SHA"/u);
});

test("DataScript keeps its equivalent CI-baked closure define", async () => {
  const source = await readFile(path.join(root, "scripts", "build-datascript-runtime.mjs"), "utf8");
  assert.match(source, /closure-defines \{eacl-demo\.datascript\.runtime\/core-sha \$\{ednString\(prepared\.lock\.sha\)\}\}/u);
});
