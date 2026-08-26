import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const [pkg, npmLock, toolchain, nativeLock, jvmLock, datalevinDecision, datalevinNativeBuilder] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("toolchain.json"),
  readJson("dependencies/native.lock.json"),
  readJson("dependencies/jvm.lock.json"),
  readJson("dependencies/datalevin-memory.v1.json"),
  readJson("dependencies/datalevin-native-al2023-builder.v1.json")
]);

assert(npmLock.lockfileVersion === 3, "npm lockfileVersion must be 3");
assert(npmLock.packages?.[""]?.engines?.node === toolchain.javascript.node, "Node engine differs from toolchain");
assert(pkg.packageManager === `npm@${toolchain.javascript.npm}`, "npm packageManager differs from toolchain");
assert(nativeLock.lambda.forbidDevelopmentFallback === true, "native Lambda lock must forbid host fallback");
assert(new Set(["unresolved-disabled", "builder-pinned-unqualified", "resolved-qualified"]).has(nativeLock.lambda.status), "invalid native target status");
assert(nativeLock.lambda.jankCommit === toolchain.native.builderJankCommit, "Jank builder commit differs from toolchain");
assert(nativeLock.lambda.baseImageDigest === toolchain.native.builderBaseImageDigest, "Jank base image differs from toolchain");
assert(jvmLock.artifacts.length > 0, "JVM lock is empty");
for (const artifact of jvmLock.artifacts) {
  assert(/^[0-9a-f]{64}$/.test(artifact.sha256), `invalid JVM digest: ${artifact.path}`);
}
assert(datalevinDecision.deploymentEligible === false, "unqualified Datalevin dependency decision must fail closed");
assert(datalevinDecision.release.published === false, "Datalevin release status changed without replacing its decision");
assert(datalevinDecision.native.abiCompatible === false, "Datalevin native ABI status changed without exact requalification");
assert(datalevinDecision.native.lambdaGlibc === "2.34", "Datalevin Lambda glibc target drifted");
assert(datalevinDecision.native.libraries.every(({ maximumRequiredGlibc }) => maximumRequiredGlibc === "2.38"), "Datalevin native glibc evidence is incomplete");
assert(datalevinDecision.al2023NativeCandidate.builderDefinition === "dependencies/datalevin-native-al2023-builder.v1.json", "Datalevin AL2023 candidate lock is not bound");
assert(datalevinDecision.al2023NativeCandidate.artifactSha256 === datalevinNativeBuilder.native.artifactSha256, "Datalevin AL2023 candidate identity differs from its builder lock");
assert(datalevinNativeBuilder.deploymentEligible === false, "unpublished Datalevin native candidate must remain ineligible");
assert(datalevinNativeBuilder.native.abiCompatible === true, "Datalevin AL2023 candidate ABI qualification is missing");
assert(datalevinNativeBuilder.qualification.byteForByteReproducible === true, "Datalevin AL2023 candidate reproducibility is missing");
assert(datalevinNativeBuilder.publication.published === false, "Datalevin native candidate cannot masquerade as published");

const requirements = await readFile(path.join(root, "infra/requirements.lock"), "utf8");
for (const pin of [`cfn-lint==${toolchain.infrastructure.cfnLint}`, `check-jsonschema==${toolchain.infrastructure.checkJsonschema}`]) {
  assert(requirements.includes(pin), `missing infrastructure pin: ${pin}`);
}
assert(requirements.includes("--hash=sha256:"), "infrastructure lock has no hashes");

const forbidden = /(?:\*|\^|~|>=|<=|\blatest\b|\bHEAD\b)/i;
for (const [name, value] of flatten(toolchain)) {
  if (typeof value === "string" && name !== "javascript.nodeReleaseLine") assert(!forbidden.test(value), `mutable toolchain value: ${name}=${value}`);
}
console.log("dependency locks verified");

function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, item]) => {
    const name = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === "object" && !Array.isArray(item) ? flatten(item, name) : [[name, item]];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
