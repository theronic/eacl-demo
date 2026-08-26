import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createOrdinaryArtifact, verifyOrdinaryArtifact } from "./lib/ordinary-artifact.mjs";
import { verifyCheckedOutIdentity } from "./lib/checked-out-identity.mjs";

const demoSha = "1".repeat(40);
const eaclSha = "2".repeat(40);

test("ordinary artifact handoff is closed, content-addressed, and identity-bound", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-ordinary-artifact-"));
  const source = path.join(temporary, "source");
  const output = path.join(temporary, "output");
  await mkdir(path.join(source, "assets"), { recursive: true });
  await writeFile(path.join(source, "index.html"), "<main>demo</main>\n");
  await writeFile(path.join(source, "assets", "app-deadbeef.js"), "export default 1;\n");
  const manifest = await createOrdinaryArtifact({ target: "static", demoSha, eaclSha, source, output });
  assert.match(manifest.artifactSha256, /^[0-9a-f]{64}$/u);
  assert.equal(manifest.artifactName, `eacl-demo-static-${manifest.artifactSha256}`);
  assert.deepEqual(manifest.files.map(({ path: relative }) => relative), ["payload/assets/app-deadbeef.js", "payload/index.html"]);
  assert.deepEqual(await verifyOrdinaryArtifact({
    directory: output,
    expectedTarget: "static",
    expectedDemoSha: demoSha,
    expectedEaclSha: eaclSha,
    expectedArtifactSha256: manifest.artifactSha256
  }), manifest);
});

test("ordinary artifact verification rejects tampering and undeclared files", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-ordinary-tamper-"));
  const source = path.join(temporary, "function.jar");
  const output = path.join(temporary, "output");
  await writeFile(source, "jar-one");
  const manifest = await createOrdinaryArtifact({ target: "datomic-dynamodb", demoSha, eaclSha, source, output });
  await writeFile(path.join(output, "payload", "function.jar"), "jar-two");
  await assert.rejects(() => verifyOrdinaryArtifact({ directory: output, expectedTarget: "datomic-dynamodb", expectedDemoSha: demoSha, expectedEaclSha: eaclSha, expectedArtifactSha256: manifest.artifactSha256 }), /differs from its closed manifest/u);
  await writeFile(path.join(output, "payload", "function.jar"), "jar-one");
  await writeFile(path.join(output, "payload", "undeclared"), "surprise");
  await assert.rejects(() => verifyOrdinaryArtifact({ directory: output, expectedTarget: "datomic-dynamodb", expectedDemoSha: demoSha, expectedEaclSha: eaclSha, expectedArtifactSha256: manifest.artifactSha256 }), /differs from its closed manifest/u);
});

test("ordinary artifact creation rejects symlink payloads", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-ordinary-symlink-"));
  const source = path.join(temporary, "source");
  await mkdir(source);
  await writeFile(path.join(temporary, "outside"), "outside");
  await symlink(path.join(temporary, "outside"), path.join(source, "link"));
  await assert.rejects(() => createOrdinaryArtifact({ target: "static", demoSha, eaclSha, source, output: path.join(temporary, "output") }), /symlink/u);
});

test("ordinary artifact source identity is the clean triggering commit and its committed Core lock", async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), "eacl-ordinary-identity-"));
  const git = (args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init"]);
  git(["config", "user.name", "EACL test"]);
  git(["config", "user.email", "eacl-test@example.invalid"]);
  await mkdir(path.join(repository, "dependencies"));
  await writeFile(path.join(repository, "dependencies", "eacl-core.lock.json"), `${JSON.stringify({
    schema: "eacl-demo.eacl-core-lock.v1",
    repository: "https://github.com/theronic/eacl.git",
    sha: eaclSha
  })}\n`);
  git(["add", "dependencies/eacl-core.lock.json"]);
  git(["commit", "-m", "identity"]);
  const commit = git(["rev-parse", "HEAD"]);
  assert.deepEqual(verifyCheckedOutIdentity(repository, commit), { demoSha: commit, eaclSha });
  assert.throws(() => verifyCheckedOutIdentity(repository, "3".repeat(40)), /does not match GITHUB_SHA/u);
  await writeFile(path.join(repository, "dependencies", "eacl-core.lock.json"), "{}\n");
  assert.throws(() => verifyCheckedOutIdentity(repository, commit), /tracked files differ/u);
});
