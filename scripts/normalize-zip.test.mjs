import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const normalizer = path.join(root, "scripts/normalize-zip.py");

test("normalization preserves only the root Lambda bootstrap execute bit", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-normalize-zip-"));
  try {
    const archive = path.join(temporary, "runtime.zip");
    createArchive(archive, [
      ["resource.txt", "resource", 0o100777],
      ["bootstrap", "binary", 0o100600],
      ["nested/bootstrap", "not-entrypoint", 0o100755],
      ["demo/core.clj", "(ns demo.core)", 0o100600],
      ["demo/core__init.class", "compiled", 0o100600],
      ["assets/", "", 0o40700],
      ["META-INF/MANIFEST.MF", "Manifest-Version: 1.0\nBuild-Jdk-Spec: 24\nName: demo\n", 0o100600]
    ]);

    runNormalizer(archive);
    const metadata = inspectArchive(archive);
    assert.deepEqual(metadata.names, [
      "META-INF/MANIFEST.MF",
      "assets/",
      "bootstrap",
      "demo/core.clj",
      "demo/core__init.class",
      "nested/bootstrap",
      "resource.txt"
    ]);
    assert.equal(metadata.modes.bootstrap, 0o100755);
    assert.equal(metadata.modes["nested/bootstrap"], 0o100644);
    assert.equal(metadata.modes["resource.txt"], 0o100644);
    assert.equal(metadata.modes["assets/"], 0o40755);
    assert.deepEqual(metadata.timestampsByName["demo/core.clj"], [2000, 1, 1, 0, 0, 0]);
    assert.deepEqual(metadata.timestampsByName["demo/core__init.class"], [2000, 1, 1, 0, 0, 2]);
    assert.equal(zipTimestamp(metadata.timestampsByName["demo/core__init.class"]) -
      zipTimestamp(metadata.timestampsByName["demo/core.clj"]), 2000);
    assert.deepEqual(metadata.timestampsByName["resource.txt"], [2000, 1, 1, 0, 0, 0]);
    assert.doesNotMatch(metadata.manifest, /Build-Jdk-Spec/u);

    const once = await readFile(archive);
    runNormalizer(archive);
    assert.deepEqual(await readFile(archive), once);

    runNormalizer(archive, true, true);
    const storedMetadata = inspectArchive(archive);
    assert.deepEqual(new Set(storedMetadata.compression), new Set([0]));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("normalization rejects symlinks and unsafe names", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-normalize-zip-invalid-"));
  try {
    const symlinkArchive = path.join(temporary, "symlink.zip");
    createArchive(symlinkArchive, [["link", "bootstrap", 0o120777]]);
    assert.match(runNormalizer(symlinkArchive, false).stderr, /forbidden symlink/u);

    const traversalArchive = path.join(temporary, "traversal.zip");
    createArchive(traversalArchive, [["../bootstrap", "binary", 0o100755]]);
    assert.match(runNormalizer(traversalArchive, false).stderr, /unsafe entry name/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function createArchive(archive, entries) {
  const input = JSON.stringify({ archive, entries });
  const script = [
    "import json, sys, zipfile",
    "request = json.loads(sys.stdin.read())",
    "with zipfile.ZipFile(request['archive'], 'w') as target:",
    "    for name, contents, mode in request['entries']:",
    "        info = zipfile.ZipInfo(name, (2026, 8, 25, 12, 0, 0))",
    "        info.create_system = 3",
    "        info.external_attr = mode << 16",
    "        target.writestr(info, contents)"
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { input, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function inspectArchive(archive) {
  const script = [
    "import json, sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1], 'r') as source:",
    "    infos = source.infolist()",
    "    print(json.dumps({",
    "      'names': [item.filename for item in infos],",
    "      'modes': {item.filename: item.external_attr >> 16 for item in infos},",
    "      'timestampsByName': {item.filename: item.date_time for item in infos},",
    "      'manifest': source.read('META-INF/MANIFEST.MF').decode('utf-8'),",
    "      'compression': [item.compress_type for item in infos]",
    "    }))"
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, archive], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runNormalizer(archive, expectSuccess = true, stored = false) {
  const result = spawnSync(
    "python3",
    [normalizer, ...(stored ? ["--stored"] : []), archive],
    { encoding: "utf8" }
  );
  if (expectSuccess) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0);
  return result;
}

function zipTimestamp([year, month, day, hour, minute, second]) {
  return Date.UTC(year, month - 1, day, hour, minute, second);
}
