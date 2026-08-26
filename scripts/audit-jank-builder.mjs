import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { verifyJankBuilderWorkload } from "./verify-jank-builder-workload.mjs";

await verifyJankBuilderWorkload();

const lock = JSON.parse(await readFile(
  new URL("../dependencies/jank-linux-x86_64-builder.v1.json", import.meta.url),
  "utf8"
));
const portLock = JSON.parse(await readFile(
  new URL("../dependencies/jank-engine-port.v1.json", import.meta.url),
  "utf8"
));
const dockerfile = await readFile(
  new URL("../infra/builders/jank-al2023-x86_64.Dockerfile", import.meta.url),
  "utf8"
);
const readme = await readFile(
  new URL("../services/jank-memory/README.md", import.meta.url),
  "utf8"
);
const workflow = await readFile(
  new URL("../.github/workflows/build-jank-builder.yml", import.meta.url),
  "utf8"
);
const runtimeTemplate = await readFile(
  new URL("../infra/profiles/jank-memory-runtime.yaml", import.meta.url),
  "utf8"
);

assert.equal(lock.platform, "linux/amd64");
assert.equal(lock.lambda.runtime, "provided.al2023");
assert.equal(lock.lambda.architecture, "x86_64");
assert.equal(lock.lambda.snapStart, false);
assert.equal(lock.runtimeApiAdapter.httpLibraryBuildNevra, "libcurl-devel-8.17.0-1.amzn2023.0.3.x86_64");
assert.equal(lock.runtimeApiAdapter.runtimeSoname, "libcurl.so.4");
assert.equal(lock.runtimeApiAdapter.jsonLibraryBuildNevra, "json-c-devel-0.14-8.amzn2023.0.2.x86_64");
assert.equal(lock.runtimeApiAdapter.jsonRuntimeSoname, "libjson-c.so.5");
assert.match(lock.jank.commit, /^[0-9a-f]{40}$/u);
assert.match(lock.llvm.commit, /^[0-9a-f]{40}$/u);
assert.equal(Object.keys(lock.submodules).length, 14);
assert.match(lock.baseImage.amd64ManifestDigest, /^sha256:[0-9a-f]{64}$/u);
assert.match(lock.lambdaBaseImage.amd64ManifestDigest, /^sha256:[0-9a-f]{64}$/u);
assert.equal(lock.lambdaBaseImage.glibc, "2.34");
assert.equal(lock.lambdaRuntimeClosure.policy, "base-image-provided-no-shared-libraries-packaged");
assert.equal(lock.lambdaRuntimeClosure.baseManifestDigest, lock.lambdaBaseImage.amd64ManifestDigest);
assert.deepEqual(Object.keys(lock.lambdaRuntimeClosure.directAdapterLibraries).sort(), [
  "libcrypto.so.3", "libcurl.so.4", "libjson-c.so.5"
]);
assert.deepEqual(Object.keys(lock.lambdaRuntimeClosure.cxxRuntimeLibraries).sort(), [
  "libgcc_s.so.1", "libstdc++.so.6"
]);
assert.equal(lock.architectureMigrationPolicy.current, "x86_64");
assert.equal(lock.architectureMigrationPolicy.arm64IsSeparateMigration, true);
assert.deepEqual(lock.architectureMigrationPolicy.requiredArm64Gates, ["compiler", "native-dependencies", "al2023-package", "lambda-runtime", "price-performance"]);
assert.equal(portLock.compilerCompatibility.candidateLinuxCompilerCommit, lock.jank.commit);
assert.equal(portLock.port.runtimeMatchesRequiredReleaseCore, false);
assert.match(dockerfile, new RegExp(`^FROM [^\\n]+@${lock.baseImage.amd64ManifestDigest}`, "mu"));
assert.match(dockerfile, new RegExp(`ARG JANK_COMMIT=${lock.jank.commit}`, "u"));
assert.match(dockerfile, /libcurl-devel-8\.17\.0-1\.amzn2023\.0\.3/u);
assert.match(dockerfile, /json-c-devel-0\.14-8\.amzn2023\.0\.2/u);
assert.match(dockerfile, /^FROM build AS runtime$/mu);
assert.match(dockerfile, /jank check-health/u);
assert.doesNotMatch(dockerfile, /ubuntu|latest|aarch64|arm64/iu);
assert.match(readme, /SnapStart is unsupported/u);
assert.doesNotMatch(readme, /SnapStart (?:is )?enabled/iu);
assert.match(workflow, /^\s{2}workflow_dispatch:/mu);
assert.doesNotMatch(workflow, /^\s{2}(?:push|workflow_call|workflow_run):/mu);
assert.match(workflow, /platforms: linux\/amd64/u);
assert.match(workflow, new RegExp(lock.jank.commit, "u"));
assert.doesNotMatch(workflow, /concurrency:|max-parallel:|cancel-in-progress:/u);
assert.match(runtimeTemplate, /^\s{6}Runtime: provided\.al2023$/mu);
assert.match(runtimeTemplate, /^\s{8}- x86_64$/mu);
assert.doesNotMatch(runtimeTemplate, /^\s{6}SnapStart:/mu);
assert.doesNotMatch(runtimeTemplate, /AWS::KMS|KmsKeyArn/u);
assert.match(runtimeTemplate, /^\s{4}Default: 4096$/mu);
assert.match(runtimeTemplate, /^\s{4}MinValue: 128$/mu);
assert.match(runtimeTemplate, /^\s{4}MaxValue: 10240$/mu);
assert.match(runtimeTemplate, new RegExp(`AllowedValues:\\s*\\n\\s*- "${portLock.port.runtimeCoreBaselineSha}"`, "u"));
for (const name of [
  "EACL_DEMO_SHA",
  "EACL_CORE_SHA",
  "EACL_ARTIFACT_SHA256",
  "EACL_DEPLOYMENT_ID",
  "EACL_DATA_MANIFEST_SHA256"
]) assert.match(runtimeTemplate, new RegExp(`^\\s{10}${name}: !Ref `, "mu"));
assert.match(runtimeTemplate, /^\s{10}EACL_JANK_FIXTURE_PATH: \/var\/task\/fixture-10000\.ndjson$/mu);

console.log("Jank AL2023 x86_64 builder pin audit passed");
