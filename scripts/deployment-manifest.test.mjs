import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseEaclCore } from "./lib/eacl-core.mjs";
import {
  createDeploymentManifest,
  validateCoreIdentity,
  validateDeploymentManifest,
} from "./lib/deployment-manifest.mjs";

const depsEdnBytes = readFileSync(new URL("../deps.edn", import.meta.url));
const core = parseEaclCore(depsEdnBytes.toString("utf8"));

test("the deps.edn-derived Core identity uses only an exact SHA", () => {
  assert.equal(validateCoreIdentity(core), core);
  assert.match(core.sha, /^[0-9a-f]{40}$/u);
  assert.deepEqual(Object.keys(core).sort(), ["modules", "repository", "sha"]);
});

test("the deployment manifest deterministically binds both repository SHAs", () => {
  const manifest = createDeploymentManifest({
    demoSha: "a".repeat(40),
    core,
    depsEdnBytes,
    generatedAt: "2026-08-25T10:11:55Z",
    profiles: ["datahike-s3", "jank-memory"],
  });
  assert.equal(validateDeploymentManifest(manifest), manifest);
  assert.equal(manifest.deploymentId, `aaaaaaaaaaaa-${core.sha.slice(0, 12)}`);
  assert.equal(manifest.demo.sha, "a".repeat(40));
  assert.equal(manifest.eacl.sha, core.sha);
  assert.equal(manifest.eacl.pin.path, "deps.edn");
  assert.equal(manifest.eacl.pin.committedAtDemoSha, true);
  assert.equal("branch" in manifest.demo, false);
  assert.equal("branch" in manifest.eacl, false);
});

test("mutable or dirty-style identities are rejected", () => {
  assert.throws(() => createDeploymentManifest({
    demoSha: "main",
    core,
    depsEdnBytes,
    generatedAt: "2026-08-25T10:11:55Z",
  }), /demoSha/u);

  const manifest = createDeploymentManifest({
    demoSha: "a".repeat(40),
    core,
    depsEdnBytes,
    generatedAt: "2026-08-25T10:11:55Z",
  });
  manifest.demo.branch = "production";
  assert.throws(() => validateDeploymentManifest(manifest), /Demo source keys/u);
});
