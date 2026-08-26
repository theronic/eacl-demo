import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { createGzip, constants } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const options = parseArgs(process.argv.slice(2));
const output = resolveInsideRoot(options.output);
await mkdir(path.dirname(output), { recursive: true });
await rm(output, { force: true });

const producer = spawn(process.execPath, [
  path.join(root, "scripts/stream-fixture-batches.mjs"),
  "--cut-point", String(options.cutPoint)
], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "inherit"]
});

try {
  await Promise.all([
    pipeline(
      producer.stdout,
      createGzip({ level: constants.Z_BEST_COMPRESSION }),
      createWriteStream(output, { flags: "wx", mode: 0o600 })
    ),
    new Promise((resolve, reject) => {
      producer.once("error", reject);
      producer.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`fixture producer failed (${signal ?? code})`));
      });
    })
  ]);
  const metadata = await stat(output);
  const digest = await sha256(output);
  process.stdout.write(`${JSON.stringify({
    schema: "eacl-demo.fixture-batch-stream-artifact.v1",
    cutPoint: options.cutPoint,
    encoding: "gzip",
    sha256: digest,
    bytes: metadata.size,
    output: path.relative(root, output)
  })}\n`);
} catch (error) {
  producer.kill("SIGTERM");
  await rm(output, { force: true });
  throw error;
}

function parseArgs(args) {
  if (args.length !== 4 || args[0] !== "--cut-point" || args[2] !== "--output") {
    throw new Error("usage: node scripts/package-fixture-batch-stream.mjs --cut-point 10000|1000000 --output <relative-path>");
  }
  const cutPoint = Number(args[1]);
  if (![10_000, 1_000_000].includes(cutPoint)) throw new Error("unsupported fixture cut point");
  if (!args[3].endsWith(".jsonl.gz")) throw new Error("fixture batch stream output must end with .jsonl.gz");
  return { cutPoint, output: args[3] };
}

function resolveInsideRoot(relative) {
  if (path.isAbsolute(relative)) throw new Error("absolute fixture batch output is forbidden");
  const resolved = path.resolve(root, relative);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) throw new Error("fixture batch output escapes workspace");
  return resolved;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
