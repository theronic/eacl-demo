import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const lock = JSON.parse(await readFile(
  new URL("dependencies/datalevin-native-al2023-builder.v1.json", root),
  "utf8"
));
const dockerfile = await readFile(new URL(lock.builder.definition, root), "utf8");
const patch = await readFile(new URL(lock.builder.rpathPatch, root), "utf8");
const smoke = await readFile(new URL(lock.builder.smokeSource, root), "utf8");
const orchestrator = await readFile(new URL(lock.builder.orchestrator, root), "utf8");

test("Datalevin native builder is closed and pinned to AL2023 arm64", () => {
  assert.equal(lock.deploymentEligible, false);
  assert.equal(lock.native.abiCompatible, true);
  assert.equal(lock.native.platform, "linux/arm64");
  assert.equal(lock.native.lambdaRuntime, "java25");
  assert.equal(lock.native.lambdaGlibc, "2.34");
  assert.equal(lock.publication.published, false);
  assert.equal(lock.publication.cleanRemoteConsumerInstallPassed, false);
  assert.equal(lock.qualification.noCacheRebuildPassed, true);
  assert.equal(lock.qualification.byteForByteReproducible, true);
  assert.equal(lock.qualification.exactLambdaJava25ImageSmokePassed, true);
  assert.match(lock.builder.lambdaBaseImage.arm64ManifestDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(sha256(dockerfile), lock.builder.definitionSha256);
  assert.equal(sha256(patch), lock.builder.rpathPatchSha256);
  assert.equal(sha256(smoke), lock.builder.smokeSourceSha256);
  assert.equal(sha256(orchestrator), lock.builder.orchestratorSha256);
  assert.ok(dockerfile.startsWith(
    `FROM ${lock.builder.baseImage.repository}@${lock.builder.baseImage.arm64ManifestDigest} AS build\n`
  ));
  assert.match(dockerfile, new RegExp(lock.builder.source.commit, "u"));
  for (const commit of Object.values(lock.builder.source.submodules)) {
    assert.match(dockerfile, new RegExp(commit, "u"));
  }
  assert.match(dockerfile, new RegExp(lock.builder.javacpp.artifactSha256, "u"));
  assert.match(dockerfile, /patchelf --set-rpath '\$ORIGIN'/u);
  assert.match(dockerfile, /find \. -type f -print0 \| LC_ALL=C sort -z/u);
  assert.match(smoke, /mdb_env_open\(env, \(String\) null, DTLV\.MDB_INMEMORY/u);
  assert.match(smoke, /mdb_put/u);
  assert.match(smoke, /mdb_get/u);
  assert.ok(orchestrator.includes('"--platform", "linux/arm64", "--network", "none"'));
  assert.ok(orchestrator.includes('"test \\"$(uname -m)\\" = \'aarch64\'"'));
  assert.ok(orchestrator.includes("java.runtime.version = ${lambdaJava}"));
  assert.ok(orchestrator.includes("lambdaBaseImage.arm64ManifestDigest"));
});

test("candidate ABI expectations bind exactly three libraries and safe runtime paths", () => {
  assert.equal(lock.native.libraries.length, 3);
  assert.deepEqual(lock.native.libraries.map(({ path }) => path).sort(), [
    "datalevin/dtlvnative/linux-arm64/libdtlv.so",
    "datalevin/dtlvnative/linux-arm64/libgomp.so",
    "datalevin/dtlvnative/linux-arm64/libjniDTLV.so"
  ]);
  for (const library of lock.native.libraries) {
    assert.equal(library.maximumRequiredGlibc, "2.34");
    assert.ok(library.runtimePaths.every((runtimePath) => runtimePath === "$ORIGIN"));
    assert.match(library.sha256, /^[0-9a-f]{64}$/u);
  }
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
