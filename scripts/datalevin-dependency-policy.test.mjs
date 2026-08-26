import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const decision = JSON.parse(await readFile(
  new URL("../dependencies/datalevin-memory.v1.json", import.meta.url),
  "utf8"
));
const buildUnits = JSON.parse(await readFile(
  new URL("../build-units.json", import.meta.url),
  "utf8"
));
const registry = JSON.parse(await readFile(
  new URL("../registry/profile-registry.v1.json", import.meta.url),
  "utf8"
));
const workspaceDeps = await readFile(new URL("../deps.edn", import.meta.url), "utf8");
const lifecycleSource = await readFile(
  new URL("../services/datalevin-memory/src/eacl_demo/datalevin_memory/lifecycle.clj", import.meta.url),
  "utf8"
);
const runtimeSource = await readFile(
  new URL("../services/datalevin-memory/src/eacl_demo/datalevin_memory/runtime.clj", import.meta.url),
  "utf8"
);
const nativeEvidence = JSON.parse(await readFile(
  new URL("../verification/datalevin-memory/native-abi-current-2026-08-26.json", import.meta.url),
  "utf8"
));
const serviceFiles = await readdir(new URL("../services/datalevin-memory", import.meta.url), {
  recursive: true
});

test("the exact Datalevin candidate is recorded but cannot masquerade as a release", () => {
  assert.equal(decision.$schema, "eacl-demo.datalevin-memory-dependency-decision.v1");
  assert.match(decision.fork.commit, /^[0-9a-f]{40}$/u);
  assert.match(decision.fork.tree, /^[0-9a-f]{40}$/u);
  assert.equal(decision.fork.remoteBranchCommitObserved, decision.fork.commit);
  assert.equal(decision.fork.cleanCheckoutObserved, true);
  assert.equal(decision.fork.candidateTagged, false);
  assert.equal(decision.release.coordinate, "dev.eacl/datalevin-embedded-eacl");
  assert.equal(decision.release.artifactApiStatus, 404);
  assert.equal(decision.release.mavenMetadataStatus, 404);
  assert.equal(decision.release.published, false);
  assert.equal(decision.release.cleanRemoteConsumerInstallPassed, false);
  assert.equal(decision.eaclAdapter.forkDependencyKind, "local-root-development-only");
  assert.equal(decision.eaclAdapter.cleanRemoteConsumerInstallPassed, false);
  assert.equal(decision.reverification.forkBranchCommit, decision.fork.commit);
  assert.deepEqual(decision.reverification.candidateTagRefs, []);
  assert.equal(decision.reverification.artifactApiStatus, 404);
  assert.equal(decision.reverification.mavenMetadataStatus, 404);
  assert.equal(decision.reverification.latestNativeVersion, decision.native.version);
  assert.equal(decision.reverification.nativeMetadataLastUpdated, "20260715043343");
  assert.equal(decision.reverification.result, "release-unchanged-local-al2023-native-candidate-qualified");
});

test("the published upstream Linux arm64 native closure remains incompatible with AL2023", () => {
  assert.equal(decision.native.platform, "linux/arm64");
  assert.equal(decision.native.lambdaRuntime, "java25");
  assert.equal(decision.native.lambdaOperatingSystem, "Amazon Linux 2023");
  assert.equal(decision.native.lambdaGlibc, "2.34");
  assert.equal(decision.native.abiCompatible, false);
  assert.equal(decision.native.libraries.length, 3);
  for (const library of decision.native.libraries) {
    assert.equal(library.format, "elf64-littleaarch64");
    assert.equal(library.maximumRequiredGlibc, "2.38");
    assert.match(library.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(library.needed.includes("libc.so.6"));
  }
  assert.equal(nativeEvidence.artifactSha256, decision.native.artifactSha256);
  assert.equal(nativeEvidence.maximumAllowedGlibc, decision.native.lambdaGlibc);
  assert.equal(nativeEvidence.compatible, false);
  assert.deepEqual(nativeEvidence.libraries, decision.native.libraries.map((library) => ({
    ...library,
    compatible: false
  })));
});

test("the local AL2023 candidate closes ABI and in-memory smoke without claiming publication", () => {
  assert.equal(decision.al2023NativeCandidate.status, "locally-qualified-unpublished");
  assert.equal(decision.al2023NativeCandidate.maximumRequiredGlibc, "2.34");
  assert.equal(decision.al2023NativeCandidate.absoluteRuntimePathsAbsent, true);
  assert.equal(decision.al2023NativeCandidate.nativeInMemoryRoundTripPassed, true);
  assert.equal(decision.al2023NativeCandidate.published, false);
  assert.equal(decision.al2023NativeCandidate.cleanRemoteConsumerInstallPassed, false);
});

test("the incomplete Datalevin profile remains source-only and non-deployable", () => {
  assert.equal(decision.status, "blocked-unpublished-and-unintegrated");
  assert.equal(decision.deploymentEligible, false);
  assert.ok(decision.promotionBlockers.some((blocker) =>
    blocker.includes("immutable versioned lifecycle record")
    && blocker.includes("native source UUID")
    && blocker.includes("final revision")));
  assert.equal(buildUnits.units["datalevin-memory"].deploymentEligible, false);
  assert.equal(registry.profiles.find(({ id }) => id === "datalevin-memory").state, "unavailable");
  assert.doesNotMatch(workspaceDeps, /dev\.eacl\/datalevin-embedded-eacl/u);
  assert.doesNotMatch(lifecycleSource, /\[datalevin\.core/u);
  assert.doesNotMatch(lifecycleSource, /RequestStreamHandler|LambdaHandler/u);
  assert.doesNotMatch(runtimeSource, /\[datalevin\.core|RequestStreamHandler|LambdaHandler/u);
  assert.match(runtimeSource, /Actual Datalevin functions are injected/u);
  assert.match(runtimeSource, /close-transport-response!/u);
  assert.match(lifecycleSource, /read-state-bytes!/u);
  assert.match(lifecycleSource, /runtimeStateObjectVersion/u);
  assert.deepEqual(serviceFiles.sort(), [
    "README.md",
    "src",
    "src/eacl_demo",
    "src/eacl_demo/datalevin_memory",
    "src/eacl_demo/datalevin_memory/lifecycle.clj",
    "src/eacl_demo/datalevin_memory/runtime.clj"
  ]);
});
