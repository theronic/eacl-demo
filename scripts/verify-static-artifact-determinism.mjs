import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const actualNode = process.versions.node;

const first = await buildAndSnapshot();
const second = await buildAndSnapshot();
const differences = compare(first, second);
if (differences.length > 0) {
  throw new Error(`static artifact builds differ: ${JSON.stringify(differences)}`);
}

await verifyRuntimeBinding();
console.log(`deterministic static artifact verified for ${second.length} files under Node ${actualNode}`);

async function buildAndSnapshot() {
  execFileSync(process.execPath, [path.join(root, "scripts/build-static-site.mjs")], {
    cwd: root,
    stdio: "inherit"
  });
  return snapshotRoots([
    "dist/explorer-main/static",
    "dist/datascript-entry/static",
    "dist/datascript-runtime",
    "dist/static-site"
  ]);
}

async function snapshotRoots(relativeRoots) {
  const files = [];
  for (const relativeRoot of relativeRoots) {
    files.push(...await snapshot(path.join(root, relativeRoot), relativeRoot));
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function snapshot(directory, prefix) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const full = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const entryStat = await stat(full);
    if (entryStat.isDirectory()) files.push(...await snapshot(full, relative));
    else if (entryStat.isFile()) {
      const bytes = await readFile(full);
      files.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length });
    } else throw new Error(`unsupported static output type: ${relative}`);
  }
  return files;
}

function compare(first, second) {
  const firstByPath = new Map(first.map((entry) => [entry.path, entry]));
  const secondByPath = new Map(second.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...firstByPath.keys(), ...secondByPath.keys()])].sort();
  return paths.flatMap((entryPath) => {
    const left = firstByPath.get(entryPath) ?? null;
    const right = secondByPath.get(entryPath) ?? null;
    return left?.sha256 === right?.sha256 && left?.bytes === right?.bytes
      ? []
      : [{ path: entryPath, first: left, second: right }];
  });
}

async function verifyRuntimeBinding() {
  const runtimeArtifact = JSON.parse(await readFile(path.join(root, "dist/datascript-runtime/artifact.json"), "utf8"));
  const siteManifest = JSON.parse(await readFile(path.join(root, "dist/static-site/site-manifest.json"), "utf8"));
  const runtimeBytes = await readFile(path.join(root, "dist/datascript-runtime/datascript-runtime.js"));
  const siteRuntimeBytes = await readFile(path.join(root, "dist/static-site", siteManifest.entries.datascriptRuntime));
  const expected = runtimeArtifact.artifact.sha256;
  const expectedRelative = `datascript/assets/datascript-runtime-${expected}.js`;
  const manifestFile = siteManifest.files.find(({ path: relative }) => relative === expectedRelative);
  if (runtimeArtifact.artifact.path !== "datascript-runtime.js"
      || siteManifest.entries.datascriptRuntime !== expectedRelative
      || manifestFile?.sha256 !== expected) {
    throw new Error("static-site manifest does not bind the content-addressed DataScript runtime");
  }
  if (sha256(runtimeBytes) !== expected || sha256(siteRuntimeBytes) !== expected) {
    throw new Error("compiled and assembled DataScript runtime digests do not match the runtime artifact manifest");
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
