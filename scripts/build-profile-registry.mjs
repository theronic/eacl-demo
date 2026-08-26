import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateProfileRegistry } from "../packages/explorer-state/src/profile-registry.mjs";

const root = path.resolve(import.meta.dirname, "..");
const source = await readFile(path.join(root, "registry/profile-registry.v1.json"));
const registry = JSON.parse(source.toString("utf8"));
const definitions = JSON.parse(await readFile(path.join(root, "packages/contracts/profiles.v1.json"), "utf8"));
validateProfileRegistry(registry, definitions, { evidenceRecords: [] });
const output = path.join(root, "dist/registry");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "profile-registry.v1.json"), source);
await writeFile(path.join(output, "profile-registry.v1.sha256"), `${createHash("sha256").update(source).digest("hex")}  profile-registry.v1.json\n`);
console.log(output);
