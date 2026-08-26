import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { writeFixtureNdjson } from "../packages/fixture-generator/batching.mjs";
import { generateFixtureManifest } from "../packages/fixture-generator/generator.mjs";

const root = path.resolve(import.meta.dirname, "..");
const planOnly = process.argv.includes("--plan");
const allowedArguments = new Set(["--plan"]);
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument)) throw new Error(`unknown argument: ${argument}`);
}

const [builderLock, portLock, coreLock, buildUnits] = await Promise.all([
  json("dependencies/jank-linux-x86_64-builder.v1.json"),
  json("dependencies/jank-engine-port.v1.json"),
  json("dependencies/eacl-core.lock.json"),
  json("build-units.json")
]);
const deploymentEligible =
  builderLock.status === "qualified" &&
  portLock.port.runtimeMatchesRequiredReleaseCore === true &&
  portLock.compilerCompatibility.candidateLinuxCompilePassed === true &&
  buildUnits.units["jank-memory"].deploymentEligible === true;
const adapterClosure = await digestJankPort(
  path.join(root, "services/jank-memory/src/eacl_demo"),
  "eacl_demo"
);

const plan = {
  schema: "eacl-demo.jank-memory-build-plan.v1",
  platform: builderLock.platform,
  runtime: builderLock.lambda.runtime,
  architecture: builderLock.lambda.architecture,
  snapStart: builderLock.lambda.snapStart,
  builderStatus: builderLock.status,
  compilerCommit: builderLock.jank.commit,
  runtimeCoreBaselineSha: portLock.port.runtimeCoreBaselineSha,
  requiredReleaseCoreSha: coreLock.sha,
  sourceDigest: portLock.source.contentSha256,
  adapterSourceDigest: adapterClosure.contentSha256,
  deploymentEligible,
  promotionBlockers: portLock.promotionBlockers,
  packageEntries: [
    "EACL-JANK-LICENCE",
    "EACL-JANK-NOTICE",
    "THIRD-PARTY-LICENSES.txt",
    "bootstrap",
    "exemplars.v1.json",
    "fixture-10000.ndjson",
    "fixture-10000.v1.json",
    "runtime-manifest.v1.json",
    "schema-wire.v1.json",
    "schema.v1.zed"
  ]
};

if (planOnly) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const builderImage = required("EACL_JANK_BUILDER_IMAGE");
assert.match(
  builderImage,
  /^ghcr\.io\/theronic\/eacl-demo-jank-builder@sha256:[0-9a-f]{64}$/u,
  "builder must be the expected repository pinned by digest"
);
const builderDigest = builderImage.slice(builderImage.indexOf("@") + 1);
if (builderLock.qualifiedImageDigest) {
  assert.equal(builderDigest, builderLock.qualifiedImageDigest);
} else {
  assert.equal(
    process.env.EACL_JANK_QUALIFICATION_BUILD,
    "1",
    "unqualified builder may only emit a non-deployable qualification artifact"
  );
}

const demoSha = required("EACL_DEMO_SHA");
assert.match(demoSha, /^[0-9a-f]{40}$/u);
assert.equal(capture("git", ["rev-parse", "HEAD"]), demoSha, "EACL_DEMO_SHA must equal the checked-out commit");
assert.equal(
  capture("git", ["status", "--porcelain=v1", "--untracked-files=all"]),
  "",
  "Jank artifacts must be built from a clean immutable checkout"
);
assert.equal(process.env.EACL_CORE_SHA, portLock.port.runtimeCoreBaselineSha);
assert.equal(process.env.EACL_DATA_MANIFEST_SHA256, "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a");
const portClosure = await digestJankPort(
  path.join(root, "services/jank-memory/src/eacl"),
  "eacl"
);
assert.equal(portClosure.fileCount, portLock.source.fileCount);
assert.equal(portClosure.bytes, portLock.source.bytes);
assert.equal(portClosure.contentSha256, portLock.source.contentSha256);

const distributionRoot = path.join(root, "dist/jank-memory");
const outputRoot = path.join(distributionRoot, "native-output");
const packageRoot = path.join(distributionRoot, "package");
const containerUser = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
await rm(distributionRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await mkdir(packageRoot, { recursive: true });

const fixtureFile = path.join(packageRoot, "fixture-10000.ndjson");
const fixtureStream = createWriteStream(fixtureFile, { encoding: "utf8", flags: "wx" });
await writeFixtureNdjson(10_000, fixtureStream);
await new Promise((resolve, reject) => fixtureStream.end(resolve).on("error", reject));
const generatedManifest = await generateFixtureManifest(10_000);
assert.equal(generatedManifest.digests.manifest, `sha256:${process.env.EACL_DATA_MANIFEST_SHA256}`);
await writeFile(
  path.join(packageRoot, "fixture-10000.v1.json"),
  `${JSON.stringify(generatedManifest, null, 2)}\n`,
  { flag: "wx" }
);
for (const [sourceName, destinationName] of [
  ["fixtures/schema.v1.zed", "schema.v1.zed"],
  ["fixtures/schema-wire.v1.json", "schema-wire.v1.json"],
  ["fixtures/exemplars.v1.json", "exemplars.v1.json"],
  ["services/jank-memory/licenses/EACL-JANK-LICENCE", "EACL-JANK-LICENCE"],
  ["services/jank-memory/licenses/EACL-JANK-NOTICE", "EACL-JANK-NOTICE"]
]) await copyFile(path.join(root, sourceName), path.join(packageRoot, destinationName));

run("docker", [
  "run", "--rm", "--platform", "linux/amd64",
  "--network", "none",
  "--user", containerUser,
  "--volume", `${root}:/workspace:ro`,
  "--volume", `${outputRoot}:/output`,
  "--entrypoint", "/bin/bash",
  builderImage,
  "/workspace/scripts/compile-jank-memory.sh"
]);
await copyFile(path.join(outputRoot, "bootstrap"), path.join(packageRoot, "bootstrap"));
await copyFile(
  path.join(outputRoot, "THIRD-PARTY-LICENSES.txt"),
  path.join(packageRoot, "THIRD-PARTY-LICENSES.txt")
);
await chmod(path.join(packageRoot, "bootstrap"), 0o755);

const elfDynamic = await readFile(path.join(outputRoot, "evidence/elf-dynamic.txt"), "utf8");
const elfVersions = await readFile(path.join(outputRoot, "evidence/elf-versions.txt"), "utf8");
const lddEvidence = await readFile(path.join(outputRoot, "evidence/ldd.txt"), "utf8");
const needed = [...elfDynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/gu)].map((match) => match[1]).sort();
const allowedNeeded = new Set([
  "ld-linux-x86-64.so.2",
  "libc.so.6",
  "libcrypto.so.3",
  "libcurl.so.4",
  "libdl.so.2",
  "libgcc_s.so.1",
  "libjson-c.so.5",
  "libm.so.6",
  "libpthread.so.0",
  "librt.so.1",
  "libstdc++.so.6"
]);
assert.ok(needed.length > 0, "bootstrap must have a visible dynamic dependency closure");
for (const libraryName of needed) assert.ok(allowedNeeded.has(libraryName), `unexpected DT_NEEDED library: ${libraryName}`);
const glibcVersions = [...elfVersions.matchAll(/GLIBC_(\d+)\.(\d+)/gu)]
  .map((match) => [Number(match[1]), Number(match[2])]);
assert.ok(glibcVersions.length > 0, "bootstrap must expose imported glibc symbol versions");
for (const [major, minor] of glibcVersions) {
  assert.ok(major < 2 || (major === 2 && minor <= 34), `glibc ${major}.${minor} exceeds AL2023`);
}
assert.doesNotMatch(lddEvidence, /not found|\/opt\/homebrew|\/usr\/local\/Homebrew|Mach-O/iu, "AL2023 ldd evidence contains an unresolved or foreign dependency");

const builderEvidence = await digestTree(path.join(outputRoot, "evidence"));
assert.deepEqual(builderEvidence.files.map(({ name }) => name), [
  "elf-dynamic.txt",
  "elf-header.txt",
  "elf-versions.txt",
  "jank-binary-version.txt",
  "jank-check-health.txt",
  "ldd.txt",
  "third-party-licenses.sha256"
]);
for (const entry of builderEvidence.files) assert.ok(entry.bytes > 0, `empty builder evidence: ${entry.name}`);
const licenseDigestRecord = await readFile(path.join(outputRoot, "evidence/third-party-licenses.sha256"), "utf8");
const recordedLicenseDigest = /^([0-9a-f]{64})\s+/u.exec(licenseDigestRecord)?.[1];
assert.equal(recordedLicenseDigest, await sha256File(path.join(packageRoot, "THIRD-PARTY-LICENSES.txt")), "third-party license evidence does not bind the packaged notice");

const nativeClosure = await digestTree(path.join(root, "services/jank-memory/native"));
const packageInputs = await digestTree(packageRoot);
const runtimeManifest = {
  schema: "eacl-demo.jank-memory-runtime-manifest.v1",
  builder: {
    image: builderImage,
    digest: builderDigest,
    platform: builderLock.platform,
    baseManifestDigest: builderLock.baseImage.amd64ManifestDigest,
    lambdaBaseManifestDigest: builderLock.lambdaBaseImage.amd64ManifestDigest
  },
  source: {
    demoSha,
    eaclRuntimeCoreSha: portLock.port.runtimeCoreBaselineSha,
    requiredReleaseCoreSha: coreLock.sha,
    vendoredTreeDigest: portLock.source.contentSha256,
    serviceAdapterDigest: adapterClosure.contentSha256,
    compilerCommit: builderLock.jank.commit
  },
  nativeAdapter: nativeClosure,
  builderEvidence,
  bootstrap: {
    sha256: await sha256File(path.join(packageRoot, "bootstrap")),
    format: "ELF64",
    architecture: "x86_64",
    runtime: "provided.al2023",
    snapStart: false,
    needed,
    maximumGlibc: maximumVersion(glibcVersions)
  },
  resources: Object.fromEntries(packageInputs.files.map((entry) => [entry.name, entry.sha256])),
  deploymentEligible,
  qualificationState: deploymentEligible ? "qualified" : "qualification-only",
  promotionBlockers: deploymentEligible ? [] : portLock.promotionBlockers
};
await writeFile(
  path.join(packageRoot, "runtime-manifest.v1.json"),
  `${JSON.stringify(runtimeManifest, null, 2)}\n`,
  { flag: "wx" }
);

const archive = path.join(distributionRoot, "jank-memory.zip");
run("zip", ["-q", "-r", archive, "."], { cwd: packageRoot });
run("python3", [path.join(root, "scripts/normalize-zip.py"), "--stored", archive]);
await verifyZip(packageRoot, archive, plan.packageEntries);

const artifactSha256 = await sha256File(archive);
const runtimeManifestSha256 = await sha256File(path.join(packageRoot, "runtime-manifest.v1.json"));
const artifactManifest = {
  schema: "eacl-demo.jank-memory-artifact.v1",
  artifact: "jank-memory.zip",
  artifactSha256,
  runtimeManifestSha256,
  builderDigest,
  builderWorkloadDigest: builderLock.buildWorkload.workloadDigest,
  builderEvidenceDigest: builderEvidence.aggregateSha256,
  sourceDigest: portLock.source.contentSha256,
  adapterSourceDigest: adapterClosure.contentSha256,
  nativeAdapterDigest: nativeClosure.aggregateSha256,
  deploymentEligible,
  qualificationState: deploymentEligible ? "qualified" : "qualification-only",
  promotionBlockers: deploymentEligible ? [] : portLock.promotionBlockers
};
await writeFile(
  path.join(distributionRoot, "jank-memory-artifact.v1.json"),
  `${JSON.stringify(artifactManifest, null, 2)}\n`,
  { flag: "wx" }
);

const lambdaImage = `${builderLock.lambdaBaseImage.repository}@${builderLock.lambdaBaseImage.amd64ManifestDigest}`;
const smoke = captureRun("docker", [
  "run", "--rm", "--platform", "linux/amd64",
  "--network", "none",
  "--volume", `${packageRoot}:/var/task:ro`,
  "--entrypoint", "/var/task/bootstrap",
  "--env", "LAMBDA_TASK_ROOT=/var/task",
  "--env", "EACL_JANK_MODE=self-test",
  "--env", `EACL_DEMO_SHA=${demoSha}`,
  "--env", `EACL_CORE_SHA=${portLock.port.runtimeCoreBaselineSha}`,
  "--env", `EACL_ARTIFACT_SHA256=${artifactSha256}`,
  "--env", "EACL_DEPLOYMENT_ID=jank-al2023-artifact-smoke",
  "--env", `EACL_DATA_MANIFEST_SHA256=${process.env.EACL_DATA_MANIFEST_SHA256}`,
  "--env", "AWS_LAMBDA_FUNCTION_MEMORY_SIZE=4096",
  lambdaImage
]);
const smokeEvidenceRoot = path.join(distributionRoot, "evidence");
await mkdir(smokeEvidenceRoot, { recursive: true });
assert.ok(Buffer.byteLength(smoke.stdout) <= 65_536 && Buffer.byteLength(smoke.stderr) <= 65_536, "AL2023 smoke output exceeds its evidence bound");
await writeFile(path.join(smokeEvidenceRoot, "lambda-smoke.stdout.txt"), smoke.stdout, { flag: "wx" });
await writeFile(path.join(smokeEvidenceRoot, "lambda-smoke.stderr.txt"), smoke.stderr, { flag: "wx" });
await writeFile(
  path.join(distributionRoot, "jank-memory-al2023-smoke.v1.json"),
  `${JSON.stringify({
    schema: "eacl-demo.jank-memory-al2023-smoke.v1",
    qualificationState: deploymentEligible ? "qualified" : "qualification-only",
    platform: builderLock.platform,
    runtime: builderLock.lambda.runtime,
    architecture: builderLock.lambda.architecture,
    snapStart: builderLock.lambda.snapStart,
    builderWorkloadDigest: builderLock.buildWorkload.workloadDigest,
    builderDigest,
    lambdaBaseManifestDigest: builderLock.lambdaBaseImage.amd64ManifestDigest,
    artifactSha256,
    runtimeManifestSha256,
    stdout: { bytes: Buffer.byteLength(smoke.stdout), sha256: sha256Buffer(Buffer.from(smoke.stdout)) },
    stderr: { bytes: Buffer.byteLength(smoke.stderr), sha256: sha256Buffer(Buffer.from(smoke.stderr)) },
    passed: true,
    promotionBlockers: deploymentEligible ? [] : portLock.promotionBlockers
  }, null, 2)}\n`,
  { flag: "wx" }
);

console.log(`${artifactSha256}\t${deploymentEligible ? "qualified" : "qualification-only"}\t${archive}`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function run(command, argumentsList, options = {}) {
  const result = spawnSync(command, argumentsList, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}

function capture(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
  return result.stdout.trim();
}

function captureRun(command, argumentsList, options = {}) {
  const result = spawnSync(command, argumentsList, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function json(relativeName) {
  return JSON.parse(await readFile(path.join(root, relativeName), "utf8"));
}

async function sha256File(fileName) {
  return createHash("sha256").update(await readFile(fileName)).digest("hex");
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function digestTree(directory, prefix = "") {
  const files = [];
  for (const entryName of (await readdir(directory)).sort()) {
    const fullName = path.join(directory, entryName);
    const relativeName = path.posix.join(prefix, entryName);
    const details = await stat(fullName);
    if (details.isSymbolicLink()) throw new Error(`symlink forbidden: ${relativeName}`);
    if (details.isDirectory()) files.push(...(await digestTree(fullName, relativeName)).files);
    else if (details.isFile()) files.push({ name: relativeName, sha256: await sha256File(fullName), bytes: details.size });
    else throw new Error(`unsupported artifact input: ${relativeName}`);
  }
  const aggregate = createHash("sha256");
  for (const entry of files) aggregate.update(`${entry.name}\0${entry.bytes}\0${entry.sha256}\n`);
  return { files, aggregateSha256: aggregate.digest("hex") };
}

async function digestJankPort(directory, prefix = "") {
  const files = [];
  for (const entryName of (await readdir(directory)).sort()) {
    const fullName = path.join(directory, entryName);
    const relativeName = path.posix.join(prefix, entryName);
    const details = await stat(fullName);
    if (details.isSymbolicLink()) throw new Error(`Jank port symlink forbidden: ${relativeName}`);
    if (details.isDirectory()) files.push(...(await digestJankPort(fullName, relativeName)).files);
    else if (details.isFile() && /\.(?:cljc|jank)$/u.test(entryName)) files.push({ name: relativeName, contents: await readFile(fullName) });
  }
  const digest = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(file.contents.length));
    digest.update(Buffer.from(file.name, "utf8"));
    digest.update(Buffer.from([0]));
    digest.update(size);
    digest.update(file.contents);
    bytes += file.contents.length;
  }
  return {
    files,
    fileCount: files.length,
    bytes,
    contentSha256: `sha256:${digest.digest("hex")}`
  };
}

function maximumVersion(versions) {
  return versions.reduce(
    (maximum, current) => current[0] > maximum[0] || (current[0] === maximum[0] && current[1] > maximum[1]) ? current : maximum,
    [0, 0]
  ).join(".");
}

async function verifyZip(packageDirectory, archiveName, expectedNames) {
  const script = [
    "import json, stat, sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1], 'r') as source:",
    "    infos = source.infolist()",
    "    print(json.dumps({'names': [i.filename for i in infos], 'modes': {i.filename: i.external_attr >> 16 for i in infos}}))"
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, archiveName], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const inspected = JSON.parse(result.stdout);
  assert.deepEqual(inspected.names, expectedNames);
  assert.equal(inspected.modes.bootstrap, 0o100755);
  for (const name of inspected.names.filter((entry) => entry !== "bootstrap")) assert.equal(inspected.modes[name], 0o100644);
  const packageNames = (await readdir(packageDirectory)).sort();
  assert.deepEqual(packageNames, expectedNames);
}
