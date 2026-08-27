import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mainRoot = path.join(root, "dist", "explorer-main", "static");
const runtimePath = path.join(root, "dist", "datascript-runtime", "datascript-runtime.js");
const evidencePath = path.join(root, "verification", "datascript", "bundle-isolation.latest.json");
const forbiddenSourceFragments = [
  "__vite-browser-external",
  "apps/explorer-datascript",
  "cljs-src",
  "eacl_demo/datascript",
  "node_modules/datascript",
  "EaclKernel.browser.js",
  "cljs/core.cljs"
];
const forbiddenBundleMarkers = [
  "node:crypto",
  "node:fs/promises",
  "node:path",
  "dev.eacl/eacl-datascript",
  "eacl.datascript.core",
  "datascript.core",
  "cljs.core",
  "EaclKernel.browser",
  "datascript-runtime"
];

const manifest = JSON.parse(await readFile(path.join(mainRoot, ".vite", "manifest.json"), "utf8"));
const entry = manifest["index.html"];
if (!entry?.isEntry || typeof entry.file !== "string") throw new Error("main Vite manifest has no index entry");
const files = await enumerate(mainRoot);
const scripts = files.filter((file) => file.endsWith(".js"));
const maps = files.filter((file) => file.endsWith(".js.map"));
if (scripts.length < 1 || maps.length < 1 || scripts.length !== maps.length) {
  throw new Error("every main JavaScript chunk must have a source map");
}
if (files.some((file) => /(?:datascript|worker|\.wasm$)/iu.test(file))) throw new Error("main output contains a DataScript-only artifact path");

const mainBytes = [];
for (const relative of scripts) {
  const bytes = await readFile(path.join(mainRoot, relative));
  const text = bytes.toString("utf8");
  for (const marker of forbiddenBundleMarkers) {
    if (text.includes(marker)) throw new Error(`main script contains forbidden DataScript marker: ${marker}`);
  }
  mainBytes.push(bytes);
}

const sources = [];
for (const relative of maps) {
  const map = JSON.parse(await readFile(path.join(mainRoot, relative), "utf8"));
  for (const source of map.sources ?? []) {
    const normalized = source.replaceAll("\\", "/");
    for (const fragment of forbiddenSourceFragments) {
      if (normalized.includes(fragment)) throw new Error(`main source graph reaches DataScript-only source: ${source}`);
    }
    sources.push(normalized);
  }
}

const runtimeBytes = await readFile(runtimePath);
const runtimeText = runtimeBytes.toString("utf8");
for (const marker of ["dev.eacl/eacl-datascript", "cljs.core", "4d781c4d9437e381d3dcb7f43db8c5fbcd1ffb85"]) {
  if (!runtimeText.includes(marker)) throw new Error(`dedicated DataScript runtime is missing expected isolation witness: ${marker}`);
}

const evidence = {
  schema: "eacl-demo.datascript-bundle-isolation.v1",
  result: "pass",
  main: {
    entry: entry.file,
    files,
    scriptBytes: mainBytes.reduce((total, bytes) => total + bytes.length, 0),
    scriptSha256: sha256(Buffer.concat(mainBytes)),
    sourceGraph: [...new Set(sources)].sort()
  },
  excluded: {
    sourceFragments: forbiddenSourceFragments,
    bundleMarkers: forbiddenBundleMarkers
  },
  dedicatedRuntime: {
    path: "dist/datascript-runtime/datascript-runtime.js",
    bytes: runtimeBytes.length,
    sha256: sha256(runtimeBytes),
    witnesses: ["dev.eacl/eacl-datascript", "cljs.core", "4d781c4d9437e381d3dcb7f43db8c5fbcd1ffb85"]
  }
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`DataScript bundle isolation passed: main ${evidence.main.scriptBytes} bytes, runtime ${evidence.dedicatedRuntime.bytes} bytes`);

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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
