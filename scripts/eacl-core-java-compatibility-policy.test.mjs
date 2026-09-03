import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("EACL Core preparation uses the upstream Java 25 default and validates the packaged classes", async () => {
  const [prepare, build, toolchain] = await Promise.all([
    read("scripts/lib/prepare-eacl-core.mjs"),
    read("build.clj"),
    read("toolchain.json").then(JSON.parse),
  ]);

  assert.equal(toolchain.jvm.javaRuntimeRelease, "25.0.4.1");
  assert.equal(toolchain.jvm.javaRuntimeBuild, "1");
  assert.doesNotMatch(prepare, /EACL_JAVA_RELEASE/u);
  assert.match(prepare, /const REQUIRED_CLASS_MAJOR = 69;/u);
  assert.match(prepare,
    /path\.join\(checkout, "target", "formal", "java", "classes"\)/u);
  assert.match(prepare,
    /run\("clojure", \["-T:build", "prep"\], coreModule\);/u);
  assert.match(prepare, /const classFiles = await filesBelow\(generatedClasses, "\.class"\);/u);
  assert.match(prepare, /for \(const classFile of classFiles\)/u);
  assert.match(prepare, /major !== REQUIRED_CLASS_MAJOR/u);

  assert.match(build,
    /target\/eacl-core-source\/21e661e09988dca6e416454dd7a29321076c17ac\/target\/formal\/java\/classes/u);
  assert.equal((build.match(/scripts\/prepare-eacl-core\.mjs/gu) ?? []).length, 6,
    "every current JVM artifact build must prepare and validate the same Core closure");
});

test("every JVM artifact audit verifies and loads the generated Java 25 kernel", async () => {
  const audits = await Promise.all([
    "scripts/audit-datahike-s3-lambda-artifact.mjs",
    "scripts/audit-datahike-dynamodb-lambda-artifact.mjs",
    "scripts/audit-datomic-lambda-artifact.mjs",
    "scripts/audit-datomic-seed-artifact.mjs",
  ].map(async (relative) => [relative, await read(relative)]));

  for (const [relative, source] of audits) {
    assert.match(source, /"EaclKernel\.__default"/u,
      `${relative} must inspect the generated kernel`);
    assert.match(source, /major version: 69/u,
      `${relative} must reject classfiles newer than Java 25`);
    assert.ok(source.includes('Class/forName \\"EaclKernel.__default\\"'),
      `${relative} must load the kernel rather than only inspecting its header`);
  }
});
