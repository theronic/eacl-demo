import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [build, compile, workflow, builderLock, portLock, buildUnits] = await Promise.all([
  read("scripts/build-jank-memory.mjs"),
  read("scripts/compile-jank-memory.sh"),
  read(".github/workflows/build-jank-builder.yml"),
  json("dependencies/jank-linux-x86_64-builder.v1.json"),
  json("dependencies/jank-engine-port.v1.json"),
  json("build-units.json")
]);

test("Jank qualification binds raw builder and AL2023 package evidence", () => {
  for (const evidence of [
    "elf-dynamic.txt", "elf-header.txt", "elf-versions.txt",
    "jank-binary-version.txt", "jank-check-health.txt", "ldd.txt",
    "third-party-licenses.sha256"
  ]) assert.match(build, new RegExp(evidence.replaceAll(".", "\\."), "u"));
  assert.match(build, /builderEvidenceDigest/u);
  assert.match(build, /builderWorkloadDigest/u);
  assert.match(build, /jank-memory-al2023-smoke\.v1\.json/u);
  assert.match(build, /lambda-smoke\.stdout\.txt/u);
  assert.match(build, /lambda-smoke\.stderr\.txt/u);
  assert.match(build, /not found\|\\\/opt\\\/homebrew/u);
  assert.match(build, /maximumGlibc/u);
  assert.match(build, /provided\.al2023/u);
  assert.match(build, /x86_64/u);
  assert.match(build, /snapStart: false/u);
});

test("Jank package carries the complete declared native-license scope", () => {
  for (const [dependency, pattern] of Object.entries({
    libcurl: "*/libcurl*/*",
    "json-c": "*/json-c/*",
    openssl: "*/openssl*/*",
    libgcc: "*/libgcc*/*",
    "libstdc++": "*/libstdc++*/*"
  })) {
    assert.equal(compile.includes(`-path '${pattern}'`), true, `${dependency} license scope is missing`);
  }
  assert.match(compile, /find \/opt\/source\/jank -type f/u);
  assert.match(compile, /THIRD-PARTY-LICENSES\.txt/u);
});

test("one confirmed manual run builds both image and qualification-only ZIP", () => {
  assert.match(workflow, /^\s{2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|workflow_call|workflow_run):/mu);
  assert.match(workflow, /verify-jank-builder-workload\.mjs --confirm/u);
  assert.match(workflow, /build-jank-memory\.mjs/u);
  assert.match(workflow, /EACL_JANK_QUALIFICATION_BUILD: "1"/u);
  assert.match(workflow, /retention-days: 1/u);
  assert.equal(builderLock.status, "source-pinned-image-unbuilt");
  assert.equal(portLock.compilerCompatibility.candidateLinuxCompilePassed, false);
  assert.equal(portLock.port.runtimeMatchesRequiredReleaseCore, false);
  assert.equal(buildUnits.units["jank-memory"].deploymentEligible, false);
});

async function read(name) {
  return readFile(new URL(`../${name}`, import.meta.url), "utf8");
}

async function json(name) {
  return JSON.parse(await read(name));
}
