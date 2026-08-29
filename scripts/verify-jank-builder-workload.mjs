import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DEFAULT_ROOT = path.resolve(import.meta.dirname, "..");

export async function verifyJankBuilderWorkload({
  root = DEFAULT_ROOT,
  confirmation = null,
  demoSha = null,
  requireConfirmation = false,
  requireCleanCheckout = true
} = {}) {
  const [lockSource, dockerfileSource, workflowSource] = await Promise.all([
    readFile(path.join(root, "dependencies/jank-linux-x86_64-builder.v1.json"), "utf8"),
    readFile(path.join(root, "infra/builders/jank-al2023-x86_64.Dockerfile"), "utf8"),
    readFile(path.join(root, ".github/workflows/build-jank-builder.yml"), "utf8")
  ]);
  const lock = JSON.parse(lockSource);
  const workload = lock.buildWorkload;
  exactKeys(workload, [
    "schema", "runner", "timeoutMinutes", "platform", "dockerfile",
    "dockerfileSha256", "actions", "swapGiB", "imageRepository", "imageTag", "push",
    "provenance", "sbom", "artifactRetentionDays", "workloadDigest"
  ], "Jank builder workload");
  exactKeys(workload.actions, [
    "checkout", "setupNode", "setupBuildx", "login",
    "buildPush", "uploadArtifact"
  ], "Jank builder workflow actions");
  assert.equal(workload.schema, "eacl-demo.jank-builder-workload.v1");
  assert.equal(workload.runner, "ubuntu-24.04");
  assert.equal(workload.timeoutMinutes, 360);
  assert.equal(workload.platform, "linux/amd64");
  assert.equal(workload.dockerfile, "infra/builders/jank-al2023-x86_64.Dockerfile");
  assert.equal(workload.push, true);
  assert.equal(workload.provenance, "mode=max");
  assert.equal(workload.sbom, true);
  assert.equal(workload.artifactRetentionDays, 1);
  assert.equal(workload.swapGiB, 8);
  assert.equal(workload.imageRepository, "ghcr.io/theronic/eacl-demo-jank-builder");
  assert.equal(workload.imageTag, `jank-${lock.jank.commit}-al2023-amd64`);
  assert.match(workload.workloadDigest, SHA256);

  const dockerfileDigest = sha256(dockerfileSource);
  assert.equal(workload.dockerfileSha256, dockerfileDigest, "Jank builder Dockerfile changed without a new workload digest");
  const digestInput = structuredClone(lock);
  delete digestInput.buildWorkload.workloadDigest;
  assert.equal(workload.workloadDigest, contentDigest(digestInput), "Jank builder lock changed without a new workload digest");

  assert.match(workflowSource, /^\s{2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflowSource, /^\s{2}(?:push|workflow_call|workflow_run):/mu);
  assert.match(workflowSource, new RegExp(`runs-on: ${escapeRegex(workload.runner)}`, "u"));
  assert.match(workflowSource, new RegExp(`timeout-minutes: ${workload.timeoutMinutes}`, "u"));
  for (const action of Object.values(workload.actions)) assert.match(workflowSource, new RegExp(`uses: ${escapeRegex(action)}`, "u"));
  assert.match(workflowSource, new RegExp(`sudo fallocate --length ${workload.swapGiB}G /swapfile`, "u"));
  assert.match(workflowSource, /sudo swapon \/swapfile/u);
  for (const [field, value] of [
    ["context", "."],
    ["file", workload.dockerfile],
    ["platforms", workload.platform],
    ["push", String(workload.push)],
    ["provenance", workload.provenance],
    ["sbom", String(workload.sbom)],
    ["tags", `${workload.imageRepository}:${workload.imageTag}`]
  ]) assert.match(workflowSource, new RegExp(`^\\s{10}${field}: ${escapeRegex(value)}$`, "mu"));
  assert.match(workflowSource, new RegExp(`^\\s{10}retention-days: ${workload.artifactRetentionDays}$`, "mu"));
  assert.match(workflowSource, /node scripts\/verify-jank-builder-workload\.mjs --confirm/u);
  assert.match(workflowSource, /node scripts\/build-jank-memory\.mjs/u);
  assert.match(workflowSource, /dist\/jank-memory\//u);
  assert.doesNotMatch(workflowSource, /concurrency:|max-parallel:|cancel-in-progress:/u);

  if (requireConfirmation) {
    assert.match(demoSha, SHA, "EACL_DEMO_SHA must be an immutable commit");
    assert.equal(confirmation, expectedJankBuilderConfirmation(workload, demoSha), "builder confirmation does not bind the exact workload and demo commit");
    assert.equal(capture(root, "git", ["rev-parse", "HEAD"]), demoSha, "EACL_DEMO_SHA does not match the checkout");
    if (requireCleanCheckout) assert.equal(capture(root, "git", ["status", "--porcelain=v1", "--untracked-files=all"]), "", "Jank builder workload requires a clean checkout");
  }

  return Object.freeze({ workloadDigest: workload.workloadDigest, dockerfileDigest, expectedConfirmation: demoSha && SHA.test(demoSha) ? expectedJankBuilderConfirmation(workload, demoSha) : null });
}

export function expectedJankBuilderConfirmation(workload, demoSha) {
  assert.match(workload.workloadDigest, SHA256);
  assert.match(demoSha, SHA);
  return `BUILD:${workload.workloadDigest.slice("sha256:".length)}:${demoSha}`;
}

function capture(root, command, argumentsList) {
  const result = spawnSync(command, argumentsList, { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
  return result.stdout.trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function contentDigest(value) {
  return `sha256:${createHash("sha256").update(`${stableJson(value)}\n`).digest("hex")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${name} has unknown or missing fields`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

if (process.argv[1] && pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href === import.meta.url) {
  const requireConfirmation = process.argv.includes("--confirm");
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--confirm");
  if (unknownArguments.length) throw new Error(`unknown argument: ${unknownArguments[0]}`);
  const result = await verifyJankBuilderWorkload({
    confirmation: process.env.EACL_JANK_BUILDER_CONFIRMATION ?? null,
    demoSha: process.env.EACL_DEMO_SHA ?? null,
    requireConfirmation
  });
  console.log(`${result.workloadDigest}\t${result.dockerfileDigest}`);
}
