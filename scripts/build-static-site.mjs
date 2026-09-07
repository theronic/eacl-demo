import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const node = process.execPath;
const generated = await run(node, ["scripts/generate-runtime-validators.mjs", "--check"]);
if (generated.code !== 0) throw new Error(`runtime validator verification failed with exit ${generated.code}`);
const builds = [
  [node, ["node_modules/vite/bin/vite.js", "build", "--config", "apps/explorer-main/vite.config.ts"]],
  [node, ["scripts/build-datascript-runtime.mjs"]]
];

const outcomes = await Promise.all(builds.map(([command, args]) => run(command, args)));
const failed = outcomes.find(({ code }) => code !== 0);
if (failed) throw new Error(`static constituent build failed with exit ${failed.code}: ${failed.command}`);

const target = path.join(root, "dist", "static-site");
const main = path.join(root, "dist", "explorer-main", "static");
const runtime = path.join(root, "dist", "datascript-runtime", "datascript-runtime.js");
const runtimeArtifact = JSON.parse(await readFile(path.join(root, "dist", "datascript-runtime", "artifact.json"), "utf8"));
const runtimeRelative = `datascript/assets/datascript-runtime-${runtimeArtifact.artifact.sha256}.js`;
await rm(target, { recursive: true, force: true });
await cp(main, target, { recursive: true, errorOnExist: true, force: false });
await mkdir(path.join(target, "datascript", "assets"), { recursive: true });
await copyFile(runtime, path.join(target, runtimeRelative));
const mainIndex = path.join(target, "index.html");
const html = (await readFile(mainIndex, "utf8")).replace("</head>",
  `<meta name="eacl-datascript-runtime" content="/${runtimeRelative}">\n</head>`);
await writeFile(mainIndex, html);
// Compatibility document, with the exact same app, assets and inert metadata.
await writeFile(path.join(target, "datascript", "index.html"), html);
await rm(path.join(target, ".vite"), { recursive: true, force: true });

const files = [];
for (const relative of await enumerate(target)) {
  if (relative.startsWith("registry/profiles/")) throw new Error("static build cannot overwrite independently owned profile status objects");
  const bytes = await readFile(path.join(target, relative));
  files.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), cacheClass: cacheClass(relative) });
}
for (const file of files) {
  if (!["index.html", "datascript/index.html"].includes(file.path) && file.cacheClass !== "immutable") {
    throw new Error(`static deployment file is neither an entry document nor content-addressed: ${file.path}`);
  }
  if (file.path.endsWith(".js")) {
    const source = (await readFile(path.join(target, file.path))).toString("utf8");
    if (/\b(?:eval|Function)\s*\(/u.test(source)) throw new Error(`static JavaScript requires dynamic code generation forbidden by the production CSP: ${file.path}`);
  }
}
const assembledRuntime = files.find(({ path: relative }) => relative === runtimeRelative);
if (!assembledRuntime || assembledRuntime.sha256 !== runtimeArtifact.artifact.sha256) throw new Error("assembled DataScript runtime digest mismatch");

const manifest = {
  schema: "eacl-demo.static-site.v1",
  result: "assembled",
  uploadRoot: "dist/static-site",
  entries: { main: "index.html", datascript: "datascript/index.html", datascriptRuntime: runtimeRelative },
  sourceBuilds: ["explorer-main", "datascript-runtime"],
  files
};
await writeFile(path.join(target, "site-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`static-site\t${files.length} files\tmain + conditional DataScript runtime\tone upload root`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ command: `${command} ${args.join(" ")}`, code: signal ? 1 : code ?? 1 }));
  });
}

async function enumerate(directory, prefix = "") {
  const found = [];
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const metadata = await stat(absolute);
    if (metadata.isDirectory()) found.push(...await enumerate(absolute, relative));
    else if (metadata.isFile()) found.push(relative);
  }
  return found;
}

function cacheClass(relative) {
  if (relative === "index.html" || relative === "datascript/index.html" || relative.endsWith("manifest.json")) return "no-cache";
  if (/^assets\/.+-[A-Za-z0-9_-]+\..+$/u.test(relative) || /^datascript\/assets\/.+-[A-Za-z0-9_-]+\..+$/u.test(relative)) return "immutable";
  return "revalidate";
}
