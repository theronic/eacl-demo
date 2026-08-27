import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "services/jank-memory/src");
const [
  portLock,
  coreLock,
  builderLock,
  registry,
  buildUnits,
  dispatcherSource,
  handlersSource,
  storeSource,
  profileSource,
  mainSource,
  observabilitySource,
  buildSource,
  compileSource,
  normalizerSource
] = await Promise.all([
  json("dependencies/jank-engine-port.v1.json"),
  json("dependencies/eacl-core.lock.json"),
  json("dependencies/jank-linux-x86_64-builder.v1.json"),
  json("registry/profile-registry.v1.json"),
  json("build-units.json"),
  text("services/jank-memory/src/eacl_demo/jank_memory/dispatcher.jank"),
  text("services/jank-memory/src/eacl_demo/jank_memory/handlers.jank"),
  text("services/jank-memory/src/eacl_demo/jank_memory/store.jank"),
  text("services/jank-memory/src/eacl_demo/jank_memory/profile.jank"),
  text("services/jank-memory/src/eacl_demo/jank_memory/main.jank"),
  text("services/jank-memory/src/eacl_demo/jank_memory/observability.jank"),
  text("scripts/build-jank-memory.mjs"),
  text("scripts/compile-jank-memory.sh"),
  text("scripts/normalize-zip.py")
]);

const inputs = (await enumerate(sourceRoot)).filter(({ path: relative }) => relative.startsWith("eacl/"));
const aggregate = digestInputs(inputs);
const adapterInputs = (await enumerate(sourceRoot)).filter(({ path: relative }) => relative.startsWith("eacl_demo/"));
const adapterAggregate = digestInputs(adapterInputs);
assert.equal(inputs.length, portLock.source.fileCount);
assert.equal(inputs.reduce((total, input) => total + input.bytes.length, 0), portLock.source.bytes);
assert.equal(aggregate, portLock.source.contentSha256);
assert.equal(portLock.port.requiredReleaseCoreSha, coreLock.sha);
assert.notEqual(portLock.port.runtimeCoreBaselineSha, coreLock.sha);
assert.equal(portLock.port.runtimeMatchesRequiredReleaseCore, false);
assert.equal(portLock.port.assuranceIdentityIsNotRuntimeIdentity, true);
assert.equal(portLock.semanticRebase.status, "in-progress");
assert.equal(portLock.semanticRebase.targetCoreSha, coreLock.sha);
assert.equal(portLock.semanticRebase.remainingCoreDeltaQualified, false);
const coverage = await json(portLock.semanticRebase.coverage);
assert.equal(coverage.status, "incomplete");
assert.equal(coverage.baselineCoreSha, portLock.port.runtimeCoreBaselineSha);
assert.equal(coverage.targetCoreSha, coreLock.sha);
assert.equal(coverage.entries.length, coverage.sourceDelta.changedPathCount);
assert.equal(coverage.entries.length, 33);
const coveragePaths = coverage.entries.map(({ corePath }) => corePath);
assert.equal(new Set(coveragePaths).size, coveragePaths.length);
assert.equal(
  `sha256:${createHash("sha256")
    .update(`${[...coveragePaths].sort().join("\n")}\n`)
    .digest("hex")}`,
  coverage.sourceDelta.sortedTargetPathSetSha256
);
const coverageStatuses = new Set([
  "verified", "partial", "unqualified", "not-applicable"
]);
for (const entry of coverage.entries) {
  assert.ok(coverageStatuses.has(entry.status));
  if (entry.status !== "verified") assert.ok(entry.rationale);
  if (entry.portPath) await stat(path.join(root, entry.portPath));
}
assert.ok(coverage.entries.some(({ status }) => status === "unqualified"));
const verifiedDeltaIds = new Set(
  portLock.semanticRebase.verifiedDeltas.map(({ id }) => id)
);
for (const entry of coverage.entries) {
  for (const id of entry.deltaIds ?? []) assert.ok(verifiedDeltaIds.has(id));
}
for (const delta of portLock.semanticRebase.verifiedDeltas) {
  for (const coreSource of delta.coreSources) {
    assert.ok(coveragePaths.includes(coreSource), `${delta.id}: ${coreSource}`);
  }
}
const cacheControlDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "cache-read-vs-publication-control"
);
assert.ok(cacheControlDelta);
assert.match(cacheControlDelta.behavior, /cache\? false.*populate-cache\? false/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/cache_controls_test.jank",
  "test/jank-modules/eacl_demo/jank_memory/cache_controls_test_support.jank"
]) {
  assert.ok(cacheControlDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const planScopeDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "sealed-plan-read-scope-certification"
);
assert.ok(planScopeDelta);
assert.match(planScopeDelta.behavior, /independently derived.*rejects/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/cache_controls_test.jank",
  "test/jank/plan_scope_rejection_test.jank"
]) {
  assert.ok(planScopeDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const errorIdentityDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "locked-core-error-identities"
);
assert.ok(errorIdentityDelta);
assert.match(errorIdentityDelta.behavior, /before snapshot work/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/execution_contract_rejection_test.jank",
  "test/jank/cancellation_contract_rejection_test.jank",
  "test/jank/permission_tree_request_rejection_test.jank",
  "test/jank/consistency_rejection_test.jank"
]) {
  assert.ok(errorIdentityDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const lineageCursorDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "source-lineage-and-cursor-binding"
);
assert.ok(lineageCursorDelta);
assert.match(lineageCursorDelta.behavior, /locked Core lineage/u);
assert.match(lineageCursorDelta.behavior, /future-skew/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/handler_cursor_test.jank",
  "test/jank/lineage_counters_test.jank"
]) {
  assert.ok(lineageCursorDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const consistencyLifecycleDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "memory-consistency-selection-and-lifecycle-authentication"
);
assert.ok(consistencyLifecycleDelta);
assert.match(consistencyLifecycleDelta.behavior, /exact retained basis/u);
assert.match(consistencyLifecycleDelta.behavior, /foreign lifecycles/u);
assert.match(consistencyLifecycleDelta.behavior, /response tokens.*selected basis/u);
assert.match(consistencyLifecycleDelta.behavior, /pre-selection cancellation/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/consistency_lifecycle_test.jank"
]) {
  assert.ok(consistencyLifecycleDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const permissionTreeDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "permission-tree-selected-basis-and-validation"
);
assert.ok(permissionTreeDelta);
assert.match(permissionTreeDelta.behavior, /expanded-at token/u);
assert.match(permissionTreeDelta.behavior, /historical basis exactly/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/permission_tree_delta_test.jank"
]) {
  assert.ok(permissionTreeDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const selectedBasisDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "memory-selected-basis-semantic-identity"
);
assert.ok(selectedBasisDelta);
assert.match(selectedBasisDelta.behavior, /target-shaped semantic identity/u);
assert.match(selectedBasisDelta.behavior, /conservatively as-of/u);
assert.match(selectedBasisDelta.behavior, /exact-once close boundary/u);
assert.match(selectedBasisDelta.behavior, /construction failures/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/consistency_lifecycle_test.jank",
  "test/jank/lineage_counters_test.jank"
]) {
  assert.ok(selectedBasisDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const basisAdapterDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "memory-basis-adapter-boundary"
);
assert.ok(basisAdapterDelta);
assert.match(basisAdapterDelta.behavior, /closed read-operation table/u);
assert.match(basisAdapterDelta.behavior, /no source-selection.*writer authority/u);
assert.match(basisAdapterDelta.behavior, /relationship-half certification/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/consistency_lifecycle_test.jank",
  "test/jank/lineage_counters_test.jank"
]) {
  assert.ok(basisAdapterDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const contextBasisDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "memory-context-basis-bound-derived-and-proof-state"
);
assert.ok(contextBasisDelta);
assert.match(contextBasisDelta.behavior, /plans.*store.*lifecycle.*schema generation/u);
assert.match(contextBasisDelta.behavior, /relation stamps/u);
assert.match(contextBasisDelta.behavior, /newer-basis artifacts.*older exact snapshots/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/basis_cache_binding_test.jank",
  "test/jank/lineage_counters_test.jank"
]) {
  assert.ok(contextBasisDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const subproblemCacheDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "specialized-subproblem-cache-controls"
);
assert.ok(subproblemCacheDelta);
assert.match(subproblemCacheDelta.behavior, /read-only cache requests.*read/u);
assert.match(subproblemCacheDelta.behavior, /false and nil memo results/u);
assert.match(subproblemCacheDelta.behavior, /suppressing.*publication/u);
assert.match(subproblemCacheDelta.behavior, /schema generation/u);
assert.match(subproblemCacheDelta.behavior, /type and eacl\/error identities/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/cache_controls_test.jank",
  "test/jank-modules/eacl_demo/jank_memory/cache_controls_test_support.jank",
  "test/jank/lineage_counters_test.jank",
  "test/jank/basis_cache_binding_test.jank"
]) {
  assert.ok(subproblemCacheDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const ttlCursorDelta = portLock.semanticRebase.verifiedDeltas.find(
  ({ id }) => id === "ttl-cursor-codec-and-pagination-error-identity"
);
assert.ok(ttlCursorDelta);
assert.match(ttlCursorDelta.behavior, /TTL-bearing cursor encode entries/u);
assert.match(ttlCursorDelta.behavior, /decode hits.*expiry.*current-time validation/u);
assert.match(ttlCursorDelta.behavior, /pagination invalid-cursor identity/u);
for (const evidence of [
  "scripts/test-jank-semantic-deltas.mjs",
  "test/jank/cache_controls_test.jank",
  "test/jank/handler_cursor_test.jank"
]) {
  assert.ok(ttlCursorDelta.evidence.includes(evidence));
  await stat(path.join(root, evidence));
}
const coverageByPath = new Map(
  coverage.entries.map((entry) => [entry.corePath, entry])
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/backend/source.cljc").status,
  "verified"
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/backend/v8.cljc").status,
  "verified"
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/execution.cljc").status,
  "verified"
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/request/counters.cljc").status,
  "verified"
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/request/context.cljc").status,
  "verified"
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/subproblem_cache.cljc").status,
  "verified"
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/cursor.cljc").status,
  "verified"
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/consistency.cljc").status,
  "verified"
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/permission_tree.cljc").status,
  "verified"
);
assert.equal(
  coverageByPath.get("modules/eacl/src/eacl/verified_kernel.cljc").status,
  "not-applicable"
);
assert.equal(portLock.compilerCompatibility.candidateLinuxCompilerCommit, builderLock.jank.commit);
assert.equal(portLock.compilerCompatibility.candidateLinuxCompilePassed, false);
assert.equal(builderLock.status, "source-pinned-image-unbuilt");
assert.equal(buildUnits.units["jank-memory"].deploymentEligible, false);
const profile = registry.profiles.find(({ id }) => id === "jank-memory");
assert.equal(profile.state, "unavailable");
assert.match(profile.reason, /Core|Linux|artifact/u);
assert.deepEqual(portLock.promotionBlockers.length, 4);
for (const key of [
  "requireVendoredTreeDigestMatch",
  "requireRuntimeCoreBaselineEqualsLockedCore",
  "requireCandidateLinuxCompile",
  "requireQualifiedBuilderDigest",
  "requireAl2023ArtifactSmoke",
  "requireLambdaTransportSmoke"
]) assert.equal(portLock.promotionPolicy[key], true);

const exactOperations = [
  "health", "bootstrap", "list-subjects", "get-object",
  "list-relationships", "reverse-relationships", "check-permission", "get-schema",
  "get-cache-info", "count-objects"
];
for (const operation of exactOperations) assert.match(dispatcherSource, new RegExp(`"${operation}"`, "u"));
for (const forbidden of ["seed", "setup", "mutation", "benchmark", "debug", "lan-server"]) {
  assert.doesNotMatch(dispatcherSource, new RegExp(`"${forbidden}"`, "iu"));
}
assert.match(dispatcherSource, /\(= operation-set \(set \(keys handlers\)\)\)/u);
assert.match(dispatcherSource, /handler-outcome\?/u);
assert.match(dispatcherSource, /\(if-let \[error \(:error outcome\)\]/u);
const handlerTableSource = handlersSource.slice(
  handlersSource.indexOf("(defn create-handlers"),
  handlersSource.indexOf("(defn error-code")
);
assert.equal((handlerTableSource.match(/catch cpp\/jank\.runtime\.object_ref error/gu) ?? []).length, 10);
assert.doesNotMatch(handlersSource, /\(case\b/u);
assert.match(handlersSource, /:eacl\/unsupported-consistency/u);
assert.match(storeSource, /\(def maximum-bootstrap-forms 80000\)/u);
assert.match(storeSource, /\(def expected-object-count 10080\)/u);
assert.match(storeSource, /\(def expected-subject-count 80\)/u);
assert.match(storeSource, /\(def expected-resource-count 10000\)/u);
assert.match(storeSource, /\(def expected-relationship-count 38613\)/u);
assert.match(storeSource, /:history \{next-basis after-database\}/u);
assert.match(storeSource, /verify-exemplars! connection client exemplars/u);
const sealedPlanSource = await text("services/jank-memory/src/eacl/engine/sealed_plan.cljc");
const cursorSource = await text("services/jank-memory/src/eacl/cursor.cljc");
const contextSource = await text("services/jank-memory/src/eacl/request/context.cljc");
const orchestrationSource = await text(
  "services/jank-memory/src/eacl/client/orchestration.cljc"
);
const counterSource = await text("services/jank-memory/src/eacl/request/counters.cljc");
const permissionTreeSource = await text("services/jank-memory/src/eacl/engine/permission_tree.cljc");
const memorySource = await text("services/jank-memory/src/eacl/datomic/memory/source.cljc");
const basisStoreSource = await text("services/jank-memory/src/eacl/store.cljc");
assert.match(sealedPlanSource, /permission-dependency-closure!/u);
assert.match(sealedPlanSource, /certify-plan-read-scope!/u);
assert.match(sealedPlanSource, /:relation-outside-dependency-closure/u);
assert.match(cursorSource, /maximum-future-skew-seconds 300/u);
assert.match(cursorSource, /:type :eacl\.pagination\/invalid-cursor/u);
assert.doesNotMatch(cursorSource, /:eacl\.cursor\/invalid/u);
assert.match(orchestrationSource, /\[:encode bucket payload\]/u);
assert.match(orchestrationSource, /cursor\/validate-current! payload/u);
assert.match(orchestrationSource, /:eacl\.pagination\/invalid-cursor/u);
assert.doesNotMatch(orchestrationSource, /:eacl\.cursor\/invalid/u);
assert.match(contextSource, /defn lineage-for-source-scope/u);
assert.match(contextSource, /:source-lifecycle \(:lifecycle-id scope\)/u);
assert.match(contextSource, /#\(memory-source\/release! selection\)/u);
assert.match(contextSource, /construction-failure! release-fn error/u);
assert.match(handlersSource, /:eacl\.pagination\/invalid-cursor/u);
assert.match(observabilitySource, /:eacl\.pagination\/invalid-cursor/u);
assert.doesNotMatch(handlersSource, /:eacl\.cursor\/invalid/u);
assert.doesNotMatch(observabilitySource, /:eacl\.cursor\/invalid/u);
assert.match(permissionTreeSource, /\(if \(nil\? overrides\) \{\} overrides\)/u);
assert.match(memorySource, /def semantic-identity-keys/u);
assert.match(memorySource, /:basis-kind basis-kind/u);
assert.match(memorySource, /:ownership :borrowed/u);
assert.match(memorySource, /:snapshot-thread :any/u);
assert.match(memorySource, /defn release!/u);
assert.match(memorySource, /:eacl\/snapshot-released/u);
assert.match(memorySource, /compare-and-set! release-state :open :releasing/u);
assert.match(cursorSource, /:issued-in-future/u);
assert.match(counterSource, /:writer-submissions/u);
assert.match(basisStoreSource, /def read-operation-keys/u);
assert.match(basisStoreSource, /:relationship-halves-certified\?/u);
for (const forbidden of [
  ":source-scope", ":source-lifecycle", ":select-current",
  ":select-authoritative", ":select-at-least", ":select-exact", ":writer"
]) assert.doesNotMatch(basisStoreSource, new RegExp(forbidden, "u"));
assert.match(profileSource, new RegExp(portLock.port.runtimeCoreBaselineSha, "u"));
assert.match(profileSource, new RegExp(portLock.port.requiredReleaseCoreSha, "u"));
assert.match(profileSource, /"datomic-like-not-datomic-pro"/u);
assert.match(profileSource, /"no-durability"/u);
assert.match(profileSource, /"no-datalog-api"/u);
assert.match(profileSource, /"no-distribution"/u);
assert.match(profileSource, /"not-production-database"/u);
assert.match(profileSource, /"no-snapstart"/u);
assert.match(mainSource, /runtime-api\/post-error! request-id invocation-error-json/u);
assert.match(mainSource, /\(when \(= "lambda" mode\) \(post-init-error-safe!\)\)/u);
assert.match(mainSource, /fixture-path-mismatch/u);
assert.match(mainSource, /observability\/initialize-with-telemetry!/u);
assert.match(mainSource, /observability\/observe-response!/u);
assert.match(mainSource, /observability\/observe-exception!/u);
assert.match(observabilitySource, /eacl-demo\.runtime-telemetry\.v1/u);
assert.match(observabilitySource, /EaclDemo\/Runtime/u);
assert.match(observabilitySource, /maximum-record-bytes 8192/u);
assert.doesNotMatch(observabilitySource, /stack-trace|errorMessage|AWS_SECRET/iu);
const nativeRuntimeSource = await text("services/jank-memory/native/runtime_api.hpp");
const nativeFixtureSource = await text("services/jank-memory/native/fixture_reader.hpp");
assert.match(nativeRuntimeSource, /CURLOPT_NOPROXY, "\*"/u);
assert.match(nativeRuntimeSource, /maximum_runtime_header_bytes\{ 64U \* 1024U \}/u);
assert.match(nativeFixtureSource, /maximum_fixture_records\{ 48693U \}/u);
assert.match(nativeFixtureSource, /maximum_semantic_bytes\{ 6753401U \}/u);
assert.match(buildSource, /@sha256:\[0-9a-f\]\{64\}/u);
assert.match(buildSource, /EACL_JANK_QUALIFICATION_BUILD/u);
assert.match(buildSource, /unexpected DT_NEEDED library/u);
assert.match(buildSource, /minor <= 34/u);
assert.match(buildSource, /qualification-only/u);
assert.match(buildSource, /status", "--porcelain=v1", "--untracked-files=all/u);
assert.match(buildSource, /EACL_DEMO_SHA must equal the checked-out commit/u);
assert.match(buildSource, /portClosure\.contentSha256, portLock\.source\.contentSha256/u);
assert.match(buildSource, /adapterSourceDigest: adapterClosure\.contentSha256/u);
assert.match(buildSource, /serviceAdapterDigest: adapterClosure\.contentSha256/u);
assert.ok(adapterInputs.length > 0);
assert.match(compileSource, /test "\$\(uname -m\)" = x86_64/u);
assert.match(compileSource, /--runtime static/u);
assert.match(compileSource, /--optimization 3/u);
assert.match(compileSource, /Machine:\[\[:space:\]\]\+Advanced Micro Devices X86-64/u);
assert.match(compileSource, /THIRD-PARTY-LICENSES\.txt/u);
assert.match(compileSource, /\/opt\/source\/jank -type f/u);
assert.match(compileSource, /\/usr\/share\/licenses -maxdepth 2/u);
assert.match(normalizerSource, /EXECUTABLE_PATHS = \{"bootstrap"\}/u);
assert.match(normalizerSource, /forbidden symlink/u);
const qualification = await json("verification/jank-memory/qualification.v1.json");
assert.equal(qualification.runtime, "provided.al2023");
assert.equal(qualification.architecture, "x86_64");
assert.equal(qualification.snapStart, false);
assert.equal(qualification.thresholds.initializationMillisecondsMaximum, 9000);
assert.equal(qualification.thresholds.coldHealthMillisecondsMaximum, 10000);
assert.equal(qualification.thresholds.memoryHeadroomPercentMinimum, 20);
assert.equal(qualification.costSafety.provisionedConcurrency, false);
assert.equal(qualification.costSafety.externalQualificationRequiresExplicitApproval, true);

console.log(`Jank source closure is content-bound and safely unavailable: ${inputs.length} EACL files, ${aggregate}; ${adapterInputs.length} adapter files, ${adapterAggregate}`);

async function json(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

async function text(relative) {
  return readFile(path.join(root, relative), "utf8");
}

async function enumerate(directory, prefix = "") {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const full = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const details = await stat(full);
    if (details.isSymbolicLink()) throw new Error(`Jank source symlink is forbidden: ${relative}`);
    if (details.isDirectory()) result.push(...await enumerate(full, relative));
    else if (details.isFile() && /\.(?:cljc|jank)$/u.test(name)) result.push({ path: relative, bytes: await readFile(full) });
  }
  return result;
}

function digestInputs(inputs) {
  const hash = createHash("sha256");
  for (const input of inputs) {
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(input.bytes.length));
    hash.update(Buffer.from(input.path, "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(size);
    hash.update(input.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}
