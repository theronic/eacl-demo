import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createOrdinaryArtifact } from "./lib/ordinary-artifact.mjs";
import { createStaticPublicationPlan, createStaticStatus, executeStaticPublication, smokeStaticPublication } from "./lib/static-publication.mjs";

const demoSha = "1".repeat(40);
const eaclSha = "2".repeat(40);
const statusSchema = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../schemas/static-deployment-status.v1.schema.json", import.meta.url), "utf8")));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateStatus = ajv.compile(statusSchema);

test("static publication plan admits only immutable assets plus two versioned entries", async () => {
  const fixture = await staticArtifact();
  const plan = await createStaticPublicationPlan(fixture);
  assert.deepEqual(plan.immutable.map(({ key }) => key), ["assets/app-deadbeef.js", "datascript/assets/datascript-worker-" + "a".repeat(64) + ".js"]);
  assert.deepEqual(plan.preSmoke.map(({ key }) => key), ["site-manifest.json", "datascript/index.html", "index.html"]);
  assert.equal(plan.postSmokeStatusKey, "registry/static.json");
  assert.deepEqual(plan.invalidationPaths, ["/index.html", "/datascript/index.html", "/site-manifest.json"]);
  assert.equal(plan.invalidationPaths.some((entry) => entry.includes("assets/")), false);
  assert.equal(plan.immutable.every(({ publicationMode }) => publicationMode === "append-only"), true);
  assert.equal(plan.preSmoke.every(({ publicationMode }) => publicationMode === "versioned-replace"), true);
});

test("static publication smoke verifies every byte through the trusted origin", async () => {
  const fixture = await staticArtifact();
  const plan = await createStaticPublicationPlan(fixture);
  const bodies = new Map();
  for (const item of [...plan.preSmoke, ...plan.immutable]) bodies.set(`https://staged.demo.example/${item.key}`, await import("node:fs/promises").then(({ readFile }) => readFile(item.source)));
  const fetchImpl = async (url) => {
    const bytes = bodies.get(url.href);
    const item = [...plan.preSmoke, ...plan.immutable].find(({ key }) => url.pathname === `/${key}`);
    return {
      ok: Boolean(bytes),
      status: bytes ? 200 : 404,
      redirected: false,
      headers: { get: (name) => name === "content-type" ? item?.contentType : name === "cache-control" ? item?.cacheControl : name === "content-length" ? String(bytes?.length ?? 0) : null },
      arrayBuffer: async () => bytes
    };
  };
  assert.deepEqual(await smokeStaticPublication({ plan, origin: "https://staged.demo.example/", fetchImpl }), { result: "pass", checked: 5, bytes: [...bodies.values()].reduce((sum, value) => sum + value.length, 0) });
  bodies.set("https://staged.demo.example/index.html", Buffer.alloc(bodies.get("https://staged.demo.example/index.html").length, 88));
  await assert.rejects(() => smokeStaticPublication({ plan, origin: "https://staged.demo.example/", fetchImpl }), /content mismatch/u);
});

test("static status binds exact object versions and rejects incomplete rollback coordinates", async () => {
  const plan = await createStaticPublicationPlan(await staticArtifact());
  const versions = Object.fromEntries(plan.preSmoke.map(({ key }, index) => [key, `version-${index + 1}`]));
  const rollbackVersions = Object.fromEntries([...plan.preSmoke.map(({ key }) => key), plan.postSmokeStatusKey].map((key, index) => [key, `previous-${index + 1}`]));
  const status = createStaticStatus({ plan, deployedAt: "2026-08-26T12:00:00.000Z", runId: 42, runAttempt: 3, objectVersions: versions, rollbackVersions });
  assert.equal(validateStatus(status), true, JSON.stringify(validateStatus.errors));
  assert.equal(status.deploymentId, `github:42:3:${plan.artifactSha256.slice(0, 16)}`);
  assert.deepEqual(status.rollback.objectVersions, rollbackVersions);
  assert.throws(() => createStaticStatus({ plan, deployedAt: status.deployedAt, runId: 42, runAttempt: 3, objectVersions: {}, rollbackVersions }), /incomplete/u);
});

test("static transaction publishes status last and restores only replaced keys on smoke failure", async () => {
  const plan = await createStaticPublicationPlan(await staticArtifact());
  const events = [];
  const storage = fakeStorage(events);
  const succeeded = await executeStaticPublication({
    plan,
    deployedAt: "2026-08-26T12:00:00.000Z",
    runId: 7,
    runAttempt: 1,
    storage,
    smoke: async () => events.push("smoke")
  });
  assert.equal(succeeded.statusVersionId, "new:registry/static.json");
  assert.ok(events.indexOf("smoke") < events.indexOf("status"));
  assert.deepEqual(events.filter((event) => event.startsWith("restore:")), []);

  const failedEvents = [];
  const failedStorage = fakeStorage(failedEvents);
  await assert.rejects(() => executeStaticPublication({
    plan,
    deployedAt: "2026-08-26T12:00:00.000Z",
    runId: 8,
    runAttempt: 1,
    storage: failedStorage,
    smoke: async () => { throw new Error("smoke failed"); }
  }), /smoke failed/u);
  assert.deepEqual(failedEvents.filter((event) => event.startsWith("restore:")), [
    "restore:index.html:old:index.html",
    "restore:datascript/index.html:old:datascript/index.html",
    "restore:site-manifest.json:old:site-manifest.json"
  ]);
  assert.equal(failedEvents.some((event) => event.startsWith("restore:registry/static.json")), false);
});

test("static transaction treats ambiguous object and status writes as mutated during rollback", async () => {
  const plan = await createStaticPublicationPlan(await staticArtifact());
  const objectEvents = [];
  const objectStorage = fakeStorage(objectEvents);
  objectStorage.putVersioned = async ({ key }) => {
    objectEvents.push(`versioned:${key}`);
    if (key === "datascript/index.html") throw new Error("ambiguous object write");
    return `new:${key}`;
  };
  await assert.rejects(() => executeStaticPublication({ plan, deployedAt: "2026-08-26T12:00:00.000Z", runId: 9, runAttempt: 1, storage: objectStorage, smoke: async () => {} }), /ambiguous object write/u);
  assert.deepEqual(objectEvents.filter((event) => event.startsWith("restore:")), [
    "restore:datascript/index.html:old:datascript/index.html",
    "restore:site-manifest.json:old:site-manifest.json"
  ]);

  const statusEvents = [];
  const statusStorage = fakeStorage(statusEvents);
  statusStorage.putStatus = async () => {
    statusEvents.push("status");
    throw new Error("ambiguous status write");
  };
  await assert.rejects(() => executeStaticPublication({ plan, deployedAt: "2026-08-26T12:00:00.000Z", runId: 10, runAttempt: 1, storage: statusStorage, smoke: async () => {} }), /ambiguous status write/u);
  assert.equal(statusEvents.filter((event) => event.startsWith("restore:"))[0], "restore:registry/static.json:old:registry/static.json");
});

test("static publication rejects undeclared and non-content-addressed assets", async () => {
  const fixture = await staticArtifact();
  fixture.artifactManifest.files.push({ path: "payload/surprise.txt", bytes: 1, sha256: "0".repeat(64) });
  await assert.rejects(() => createStaticPublicationPlan(fixture), /outside the closed site manifest/u);
  const unsafe = await staticArtifact({ unsafeAsset: true });
  await assert.rejects(() => createStaticPublicationPlan(unsafe), /cache class is unsafe/u);
});

async function staticArtifact({ unsafeAsset = false } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "eacl-static-publication-"));
  const source = path.join(temporary, "source");
  const output = path.join(temporary, "artifact");
  await mkdir(path.join(source, "assets"), { recursive: true });
  await mkdir(path.join(source, "datascript", "assets"), { recursive: true });
  const values = new Map([
    ["assets/app-deadbeef.js", Buffer.from("main")],
    ["datascript/assets/datascript-worker-" + "a".repeat(64) + ".js", Buffer.from("worker")],
    ["datascript/index.html", Buffer.from("<title>DataScript</title>")],
    ["index.html", Buffer.from("<title>EACL</title>")]
  ]);
  for (const [relative, bytes] of values) await writeFile(path.join(source, relative), bytes);
  const files = [...values].map(([relative, bytes]) => ({
    path: relative,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    cacheClass: relative.endsWith("index.html") ? "no-cache" : unsafeAsset && relative === "assets/app-deadbeef.js" ? "revalidate" : "immutable"
  }));
  const site = {
    schema: "eacl-demo.static-site.v1",
    result: "assembled",
    uploadRoot: "dist/static-site",
    entries: { main: "index.html", datascript: "datascript/index.html", datascriptWorker: "datascript/assets/datascript-worker-" + "a".repeat(64) + ".js" },
    sourceBuilds: ["explorer-main", "datascript-entry", "datascript-worker"],
    files
  };
  await writeFile(path.join(source, "site-manifest.json"), `${JSON.stringify(site, null, 2)}\n`);
  const artifactManifest = await createOrdinaryArtifact({ target: "static", demoSha, eaclSha, source, output });
  return { artifactDirectory: output, artifactManifest };
}

function fakeStorage(events) {
  return {
    assertFoundation: async () => events.push("foundation"),
    currentVersion: async (key) => `old:${key}`,
    putImmutable: async ({ key }) => events.push(`immutable:${key}`),
    putVersioned: async ({ key }) => {
      events.push(`versioned:${key}`);
      return `new:${key}`;
    },
    putStatus: async () => {
      events.push("status");
      return "new:registry/static.json";
    },
    restoreVersion: async (key, version) => events.push(`restore:${key}:${version}`),
    invalidate: async (paths) => events.push(`invalidate:${paths.join(",")}`),
    verifyStatus: async () => events.push("verify-status"),
    verifyRollback: async () => events.push("verify-rollback")
  };
}
