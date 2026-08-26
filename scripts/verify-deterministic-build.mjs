import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const toolchain = JSON.parse(await readFile(path.join(root, "toolchain.json"), "utf8"));
const actualNode = process.versions.node;
if (actualNode !== toolchain.javascript.node) {
  throw new Error(`determinism check requires Node ${toolchain.javascript.node}; running ${actualNode}`);
}

const first = await cleanBuild();
const second = await cleanBuild();
if (JSON.stringify(first) !== JSON.stringify(second)) {
  const firstByPath = new Map(first.map((entry) => [entry.path, entry]));
  const differences = second.filter((entry) => firstByPath.get(entry.path)?.sha256 !== entry.sha256);
  throw new Error(`clean builds differ: ${JSON.stringify(differences)}`);
}
console.log(`deterministic source-unit build verified for ${second.length} files under Node ${actualNode}`);

async function cleanBuild() {
  await rm(path.join(root, "dist"), { recursive: true, force: true });
  execFileSync(process.execPath, [path.join(root, "scripts/build-unit.mjs"), "all"], { cwd: root, stdio: "inherit" });
  execFileSync(process.execPath, [path.join(root, "scripts/generate-artifact-digests.mjs")], { cwd: root, stdio: "inherit" });
  return snapshot(path.join(root, "dist"));
}

async function snapshot(directory, prefix = "") {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const full = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const entryStat = await stat(full);
    if (entryStat.isDirectory()) files.push(...await snapshot(full, relative));
    else if (entryStat.isFile()) {
      const bytes = await readFile(full);
      files.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
    } else throw new Error(`unsupported output type: ${relative}`);
  }
  return files;
}
