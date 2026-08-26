import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const argumentsList = process.argv.slice(2);
const planOnly = argumentsList.includes("--plan");
const noCache = argumentsList.includes("--no-cache");
for (const argument of argumentsList) {
  if (!new Set(["--plan", "--no-cache"]).has(argument)) {
    throw new Error(`unknown argument: ${argument}`);
  }
}

const lockPath = path.join(root, "dependencies/datalevin-native-al2023-builder.v1.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const orchestratorPath = path.join(root, lock.builder.orchestrator);
assert.equal(await sha256File(orchestratorPath), lock.builder.orchestratorSha256,
  "Datalevin native build orchestrator differs from its lock");
const dockerfilePath = path.join(root, lock.builder.definition);
assert.equal(await sha256File(dockerfilePath), lock.builder.definitionSha256,
  "Datalevin native builder definition differs from its lock");
assert.equal(await sha256File(path.join(root, lock.builder.rpathPatch)), lock.builder.rpathPatchSha256,
  "Datalevin native rpath patch differs from its lock");
assert.equal(await sha256File(path.join(root, lock.builder.smokeSource)), lock.builder.smokeSourceSha256,
  "Datalevin native smoke source differs from its lock");

const plan = {
  schema: "eacl-demo.datalevin-native-al2023-build-plan.v1",
  status: lock.status,
  deploymentEligible: false,
  platform: lock.native.platform,
  baseImageDigest: lock.builder.baseImage.arm64ManifestDigest,
  lambdaBaseImageDigest: lock.builder.lambdaBaseImage.arm64ManifestDigest,
  sourceCommit: lock.builder.source.commit,
  artifactFile: lock.native.artifactFile,
  artifactSha256: lock.native.artifactSha256,
  noCache,
  promotionBlockers: lock.promotionBlockers
};
if (planOnly) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}

const outputDirectory = path.join(root, "dist/datalevin-native-al2023");
assert.equal(path.dirname(outputDirectory), path.join(root, "dist"));
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const dockerArguments = [
  "buildx", "build", "--progress", "plain", "--platform", "linux/arm64",
  "--file", dockerfilePath,
  "--output", `type=local,dest=${outputDirectory}`
];
if (noCache) dockerArguments.push("--no-cache");
dockerArguments.push(root);
run("docker", dockerArguments, { stdio: "inherit" });

const artifactPath = path.join(outputDirectory, lock.native.artifactFile);
const details = await stat(artifactPath);
assert.equal(details.size, lock.native.artifactBytes, "rebuilt native artifact size differs from lock");
assert.equal(await sha256File(artifactPath), lock.native.artifactSha256,
  "rebuilt native artifact bytes differ from lock");
const smoke = JSON.parse(await readFile(
  path.join(outputDirectory, "native-in-memory-smoke.v1.json"),
  "utf8"
));
assert.deepEqual(smoke, {
  nativeLoaded: true,
  storageMode: "MDB_INMEMORY",
  roundTrip: true
});
run(process.execPath, [
  path.join(root, "scripts/qualify-datalevin-native-arm64.mjs"),
  "--artifact", artifactPath,
  "--expectations", lockPath
]);
await smokeInExactLambdaImage(artifactPath, lock);
process.stdout.write(`${lock.native.artifactSha256}\tqualification-only\t${artifactPath}\n`);

async function smokeInExactLambdaImage(artifactPath, builderLock) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-datalevin-lambda-smoke-"));
  try {
    const javacppPath = path.join(temporary, "javacpp.jar");
    const response = await fetch(
      `https://repo1.maven.org/maven2/org/bytedeco/javacpp/${builderLock.builder.javacpp.version}/javacpp-${builderLock.builder.javacpp.version}.jar`
    );
    assert.equal(response.ok, true, `JavaCPP download failed with HTTP ${response.status}`);
    const javacpp = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(javacpp).digest("hex"),
      builderLock.builder.javacpp.artifactSha256, "JavaCPP smoke dependency differs from lock");
    await writeFile(javacppPath, javacpp, { flag: "wx", mode: 0o600 });
    const classes = path.join(temporary, "classes");
    await mkdir(classes);
    run("javac", [
      "--release", "21",
      "-cp", `${artifactPath}${path.delimiter}${javacppPath}`,
      "-d", classes,
      path.join(root, builderLock.builder.smokeSource)
    ]);
    const lambdaImage = `${builderLock.builder.lambdaBaseImage.repository}@${builderLock.builder.lambdaBaseImage.arm64ManifestDigest}`;
    const lambdaJava = builderLock.builder.lambdaBaseImage.java;
    assert.match(lambdaJava, /^[0-9][0-9.+-]+$/u, "locked Lambda Java version is invalid");
    const lambdaSmokeCommand = [
      "test \"$(uname -m)\" = 'aarch64'",
      "test \"$(getconf GNU_LIBC_VERSION)\" = 'glibc 2.34'",
      `java -XshowSettings:properties -version 2>&1 | grep -Fq 'java.runtime.version = ${lambdaJava}'`,
      "java --enable-native-access=ALL-UNNAMED --add-opens=java.base/java.nio=ALL-UNNAMED --add-opens=java.base/sun.nio.ch=ALL-UNNAMED -cp /smoke:/input/dtlvnative.jar:/input/javacpp.jar NativeInMemorySmoke"
    ].join(" && ");
    run("docker", [
      "run", "--rm", "--platform", "linux/arm64", "--network", "none",
      "--entrypoint", "/bin/bash",
      "--volume", `${classes}:/smoke:ro`,
      "--volume", `${artifactPath}:/input/dtlvnative.jar:ro`,
      "--volume", `${javacppPath}:/input/javacpp.jar:ro`,
      lambdaImage,
      "-lc",
      lambdaSmokeCommand
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: options.stdio ?? "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}
