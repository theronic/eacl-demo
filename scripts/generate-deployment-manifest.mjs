#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEPS_EDN_PATH, parseEaclCore } from "./lib/eacl-core.mjs";
import {
  createDeploymentManifest,
  validateDeploymentManifest,
} from "./lib/deployment-manifest.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const outputPath = resolve(process.argv[2] ?? resolve(repoRoot, "build", "deployment-manifest.json"));

function git(args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

let demoSha;
try {
  demoSha = git(["rev-parse", "--verify", "HEAD"]).trim();
} catch {
  throw new Error("Cannot generate a deployment manifest from an unborn repository; create the reviewed commit first.");
}

const workingDepsBytes = readFileSync(resolve(repoRoot, DEPS_EDN_PATH));
const committedDepsBytes = git(["show", `${demoSha}:${DEPS_EDN_PATH}`], "buffer");
if (!workingDepsBytes.equals(committedDepsBytes)) {
  throw new Error("The working deps.edn differs from the deps.edn committed at demoSha.");
}
const core = parseEaclCore(committedDepsBytes.toString("utf8"));

const coreCheckout = process.env.EACL_CORE_CHECKOUT;
if (!coreCheckout) {
  throw new Error("EACL_CORE_CHECKOUT must name the clean exact-SHA Core checkout used by this build.");
}
const coreDirectory = resolve(coreCheckout);
function coreGit(args) {
  return execFileSync("git", ["-C", coreDirectory, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
const coreHead = coreGit(["rev-parse", "--verify", "HEAD"]);
if (coreHead !== core.sha) {
  throw new Error(`Core checkout HEAD ${coreHead} does not equal pinned sha ${core.sha}.`);
}
const coreStatus = coreGit(["status", "--porcelain=v1", "--untracked-files=all"]);
if (coreStatus !== "") {
  throw new Error("Core checkout is dirty or contains untracked files and cannot establish release identity.");
}
const normalizeRepository = (url) => url
  .replace(/^git@github[.]com:/u, "https://github.com/")
  .replace(/^ssh:\/\/git@github[.]com\//u, "https://github.com/");
const coreOrigin = normalizeRepository(coreGit(["remote", "get-url", "origin"]));
if (coreOrigin !== core.repository) {
  throw new Error(`Core checkout origin ${coreOrigin} is not canonical ${core.repository}.`);
}

const profiles = (process.env.EACL_DEMO_PROFILES ?? "")
  .split(",")
  .map((profile) => profile.trim())
  .filter(Boolean);
const manifest = validateDeploymentManifest(createDeploymentManifest({
  demoSha,
  core,
  depsEdnBytes: committedDepsBytes,
  generatedAt: process.env.EACL_DEMO_GENERATED_AT ?? new Date().toISOString(),
  profiles,
}));

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(outputPath);
