import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const ORDINARY_ARTIFACT_SCHEMA = "eacl-demo.ordinary-artifact.v1";

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TARGET = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAXIMUM_FILE_COUNT = 20_000;
const MAXIMUM_FILE_BYTES = 512 * 1024 * 1024;
const MAXIMUM_TOTAL_BYTES = 1024 * 1024 * 1024;

export async function createOrdinaryArtifact({ target, demoSha, eaclSha, source, output }) {
  validateIdentity({ target, demoSha, eaclSha });
  const sourceMetadata = await lstat(source);
  if (sourceMetadata.isSymbolicLink()) throw new Error("ordinary artifact source must not be a symlink");
  if (!sourceMetadata.isDirectory() && !sourceMetadata.isFile()) throw new Error("ordinary artifact source must be a file or directory");
  await mkdir(output, { recursive: false });
  const payload = path.join(output, "payload");
  await mkdir(payload);
  if (sourceMetadata.isDirectory()) await copyDirectory(source, payload);
  else await copyRegularFile(source, path.join(payload, path.basename(source)));

  const files = await describeFiles(output, { excludeManifest: true });
  if (files.length === 0) throw new Error("ordinary artifact payload is empty");
  validateFileRecords(files);
  const unsigned = { schema: ORDINARY_ARTIFACT_SCHEMA, target, demoSha, eaclSha, files };
  const artifactSha256 = canonicalDigest(unsigned);
  const artifactName = `eacl-demo-${target}-${artifactSha256}`;
  const manifest = { ...unsigned, artifactSha256, artifactName };
  await writeFile(path.join(output, "artifact-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

export async function verifyOrdinaryArtifact({ directory, expectedTarget, expectedDemoSha, expectedEaclSha, expectedArtifactSha256 }) {
  const manifest = JSON.parse(await readFile(path.join(directory, "artifact-manifest.json"), "utf8"));
  exactKeys(manifest, ["schema", "target", "demoSha", "eaclSha", "files", "artifactSha256", "artifactName"], "ordinary artifact manifest");
  validateIdentity({ target: manifest.target, demoSha: manifest.demoSha, eaclSha: manifest.eaclSha });
  if (manifest.schema !== ORDINARY_ARTIFACT_SCHEMA) throw new Error("ordinary artifact schema is invalid");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("ordinary artifact file list is empty");
  if (manifest.target !== expectedTarget) throw new Error("ordinary artifact target mismatch");
  if (manifest.demoSha !== expectedDemoSha) throw new Error("ordinary artifact demo SHA mismatch");
  if (manifest.eaclSha !== expectedEaclSha) throw new Error("ordinary artifact EACL SHA mismatch");
  if (manifest.artifactSha256 !== expectedArtifactSha256) throw new Error("ordinary artifact handoff digest mismatch");
  if (!SHA256.test(manifest.artifactSha256)) throw new Error("ordinary artifact digest is invalid");
  if (manifest.artifactName !== `eacl-demo-${manifest.target}-${manifest.artifactSha256}`) throw new Error("ordinary artifact name is not content-addressed");
  validateFileRecords(manifest.files);

  const actualFiles = await describeFiles(directory, { excludeManifest: true });
  if (JSON.stringify(actualFiles) !== JSON.stringify(manifest.files)) throw new Error("ordinary artifact payload differs from its closed manifest");
  const unsigned = {
    schema: manifest.schema,
    target: manifest.target,
    demoSha: manifest.demoSha,
    eaclSha: manifest.eaclSha,
    files: manifest.files
  };
  if (canonicalDigest(unsigned) !== manifest.artifactSha256) throw new Error("ordinary artifact content digest mismatch");
  return manifest;
}

async function copyDirectory(source, destination) {
  for (const name of (await readdir(source)).sort()) {
    const from = path.join(source, name);
    const to = path.join(destination, name);
    const metadata = await lstat(from);
    if (metadata.isSymbolicLink()) throw new Error(`ordinary artifact source contains a symlink: ${name}`);
    if (metadata.isDirectory()) {
      await mkdir(to);
      await copyDirectory(from, to);
    } else if (metadata.isFile()) await copyRegularFile(from, to);
    else throw new Error(`ordinary artifact source contains an unsupported entry: ${name}`);
  }
}

async function copyRegularFile(source, destination) {
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("ordinary artifact source entry is not a regular file");
  await cp(source, destination, { dereference: false, errorOnExist: true, force: false, preserveTimestamps: false });
}

async function describeFiles(directory, { excludeManifest }, prefix = "") {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    if (excludeManifest && prefix === "" && name === "artifact-manifest.json") continue;
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`ordinary artifact contains a symlink: ${relative}`);
    if (metadata.isDirectory()) files.push(...await describeFiles(absolute, { excludeManifest: false }, relative));
    else if (metadata.isFile()) {
      const bytes = await readFile(absolute);
      files.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    } else throw new Error(`ordinary artifact contains an unsupported entry: ${relative}`);
  }
  return files;
}

function validateIdentity({ target, demoSha, eaclSha }) {
  if (!TARGET.test(target)) throw new Error("ordinary artifact target is invalid");
  if (!SHA1.test(demoSha)) throw new Error("ordinary artifact demo SHA is invalid");
  if (!SHA1.test(eaclSha)) throw new Error("ordinary artifact EACL SHA is invalid");
}

function validateFileRecords(files) {
  if (files.length > MAXIMUM_FILE_COUNT) throw new Error("ordinary artifact contains too many files");
  const paths = new Set();
  let totalBytes = 0;
  for (const file of files) {
    exactKeys(file, ["path", "bytes", "sha256"], "ordinary artifact file");
    if (Buffer.byteLength(file.path, "utf8") > 512 || !/^payload\/[A-Za-z0-9._/-]+$/u.test(file.path) || file.path.split("/").includes("..") || file.path.includes("//")) throw new Error("ordinary artifact file path is invalid");
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAXIMUM_FILE_BYTES) throw new Error("ordinary artifact file size is invalid");
    totalBytes += file.bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAXIMUM_TOTAL_BYTES) throw new Error("ordinary artifact payload is too large");
    if (!SHA256.test(file.sha256)) throw new Error("ordinary artifact file digest is invalid");
    if (paths.has(file.path)) throw new Error("ordinary artifact file path is duplicated");
    paths.add(file.path);
  }
  if (JSON.stringify([...paths]) !== JSON.stringify([...paths].sort())) throw new Error("ordinary artifact files are not sorted");
}

function canonicalDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("ordinary artifact contains a non-canonical value");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has unknown or missing fields`);
  }
}
