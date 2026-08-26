import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { writeFixtureNdjson } from "../packages/fixture-generator/batching.mjs";
import { CUT_POINTS, generateFixtureManifest } from "../packages/fixture-generator/generator.mjs";

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(import.meta.dirname, "..");
const output = options.output ? resolveInsideRoot(options.output) : null;
const manifestOutput = options.manifest
  ? resolveInsideRoot(options.manifest)
  : path.join(root, "fixtures", "manifests", `fixture-${options.cutPoint}.v1.json`);

let stream = null;
if (output) {
  await mkdir(path.dirname(output), { recursive: true });
  stream = createWriteStream(output, { encoding: "utf8", flags: "wx" });
}

try {
  if (stream) {
    await writeFixtureNdjson(options.cutPoint, stream);
    await new Promise((resolve, reject) => stream.end(resolve).on("error", reject));
  }
  const manifest = await generateFixtureManifest(options.cutPoint);
  await mkdir(path.dirname(manifestOutput), { recursive: true });
  await writeFile(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "w" });
  console.log(`${options.cutPoint}\t${manifest.digests.fixture}\t${manifestOutput}${output ? `\t${output}` : ""}`);
} catch (error) {
  stream?.destroy();
  throw error;
}

function parseArgs(args) {
  const parsed = { cutPoint: null, output: null, manifest: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--cut-point") parsed.cutPoint = Number(args[++index]);
    else if (argument === "--output") parsed.output = args[++index];
    else if (argument === "--manifest") parsed.manifest = args[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!CUT_POINTS.includes(parsed.cutPoint)) throw new Error(`--cut-point must be one of: ${CUT_POINTS.join(", ")}`);
  return parsed;
}

function resolveInsideRoot(relative) {
  if (path.isAbsolute(relative)) throw new Error(`absolute output path forbidden: ${relative}`);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`output path escapes workspace: ${relative}`);
  return resolved;
}
