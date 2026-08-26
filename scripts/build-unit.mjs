import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const registry = JSON.parse(await readFile(path.join(root, "build-units.json"), "utf8"));
const requested = process.argv[2];

if (!requested) {
  console.error("usage: node scripts/build-unit.mjs <unit|all>");
  process.exit(64);
}

const names = requested === "all" ? Object.keys(registry.units).sort() : [requested];
for (const name of names) {
  const unit = registry.units[name];
  if (!unit) {
    console.error(`unknown build unit: ${name}`);
    process.exit(64);
  }
  await build(name, unit);
}

async function build(name, unit) {
  if (!/^dist\/foundation-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(unit.target)) {
    throw new Error(`foundation target must be isolated from concrete artifacts for ${name}: ${unit.target}`);
  }
  const source = resolveInsideRoot(unit.source);
  const target = resolveInsideRoot(unit.target);
  const sourceStat = await stat(source).catch(() => null);
  if (!sourceStat?.isDirectory()) throw new Error(`source directory missing for ${name}: ${unit.source}`);

  const inputs = await enumerate(source);
  const sourceDigest = digestInputs(inputs);
  const qualificationState = unit.deploymentTrack === "parked"
    ? "parked"
    : unit.deploymentEligible
      ? "eligible"
      : "foundation-only";
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  const artifact = {
    schemaVersion: 1,
    unit: name,
    kind: unit.kind,
    source: unit.source,
    sourceDigest,
    inputCount: inputs.length,
    deploymentTrack: unit.deploymentTrack,
    ordinaryDeploymentTarget: unit.ordinaryDeploymentTarget,
    deploymentEligible: unit.deploymentEligible,
    qualificationState
  };
  await writeFile(path.join(target, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`${name}\t${unit.kind}\t${sourceDigest}\t${qualificationState}`);
}

function resolveInsideRoot(relative) {
  if (path.isAbsolute(relative)) throw new Error(`absolute path forbidden: ${relative}`);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`path escapes workspace: ${relative}`);
  return resolved;
}

async function enumerate(directory, prefix = "") {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const full = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const entryStat = await stat(full);
    if (entryStat.isSymbolicLink()) throw new Error(`symlink build input forbidden: ${relative}`);
    if (entryStat.isDirectory()) entries.push(...await enumerate(full, relative));
    else if (entryStat.isFile()) entries.push({ path: relative, bytes: await readFile(full) });
    else throw new Error(`unsupported build input: ${relative}`);
  }
  return entries;
}

function digestInputs(inputs) {
  const hash = createHash("sha256");
  for (const input of inputs) {
    const pathBytes = Buffer.from(input.path, "utf8");
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(input.bytes.length));
    hash.update(pathBytes);
    hash.update(Buffer.from([0]));
    hash.update(size);
    hash.update(input.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}
