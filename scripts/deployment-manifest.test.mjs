import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDeploymentManifest,
  validateCoreLock,
  validateDeploymentManifest,
} from "./lib/deployment-manifest.mjs";

const lockBytes = readFileSync(new URL("../dependencies/eacl-core.lock.json", import.meta.url));
const lock = JSON.parse(lockBytes.toString("utf8"));

test("the committed Core lock uses only an exact reachable SHA as identity", () => {
  assert.equal(validateCoreLock(lock), lock);
  assert.match(lock.sha, /^[0-9a-f]{40}$/u);
  assert.equal(lock.reachability.observedTip, lock.sha);
  assert.match(lock.identityRule, /Only sha/u);
});

test("the deployment manifest deterministically binds both repository SHAs", () => {
  const manifest = createDeploymentManifest({
    demoSha: "a".repeat(40),
    coreLock: lock,
    coreLockBytes: lockBytes,
    generatedAt: "2026-08-25T10:11:55Z",
    profiles: ["datahike-s3", "jank-memory"],
  });
  assert.equal(validateDeploymentManifest(manifest), manifest);
  assert.equal(manifest.deploymentId, `aaaaaaaaaaaa-${lock.sha.slice(0, 12)}`);
  assert.equal(manifest.demo.sha, "a".repeat(40));
  assert.equal(manifest.eacl.sha, lock.sha);
  assert.equal(manifest.eacl.lock.committedAtDemoSha, true);
  assert.equal("branch" in manifest.demo, false);
  assert.equal("branch" in manifest.eacl, false);
});

test("mutable or dirty-style identities are rejected", () => {
  assert.throws(() => createDeploymentManifest({
    demoSha: "main",
    coreLock: lock,
    coreLockBytes: lockBytes,
    generatedAt: "2026-08-25T10:11:55Z",
  }), /demoSha/u);

  const manifest = createDeploymentManifest({
    demoSha: "a".repeat(40),
    coreLock: lock,
    coreLockBytes: lockBytes,
    generatedAt: "2026-08-25T10:11:55Z",
  });
  manifest.demo.branch = "demos";
  assert.throws(() => validateDeploymentManifest(manifest), /Demo source keys/u);
});
