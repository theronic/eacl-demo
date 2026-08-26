import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const artifacts = [];
const buildUnits = JSON.parse(await readFile(path.join(root, "build-units.json"), "utf8"));

for (const [name, unit] of Object.entries(buildUnits.units).sort(([left], [right]) => left.localeCompare(right))) {
  if (!/^dist\/foundation-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(unit.target)) throw new Error(`invalid isolated foundation target for ${name}`);
  const artifactPath = path.join(root, unit.target, "artifact.json");
  const artifactStat = await stat(artifactPath).catch(() => null);
  if (!artifactStat?.isFile()) throw new Error(`missing artifact.json for ${name}`);
  const bytes = await readFile(artifactPath);
  artifacts.push({
    name,
    path: `${unit.target}/artifact.json`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length
  });
}

if (artifacts.length === 0) throw new Error("no build artifacts found");
const outputPath = path.join(dist, "artifact-digests.json");
await writeFile(outputPath, `${JSON.stringify({ schema: "eacl-demo.artifact-digests.v1", artifacts }, null, 2)}\n`);
console.log(outputPath);
