import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SHA256 = /^[0-9a-f]{64}$/u;
const ENTRY_DOCUMENTS = Object.freeze(["datascript/index.html", "index.html"]);
const MAXIMUM_SMOKE_BYTES = 16 * 1024 * 1024;

export async function createStaticPublicationPlan({ artifactDirectory, artifactManifest }) {
  if (artifactManifest?.schema !== "eacl-demo.ordinary-artifact.v1" || artifactManifest.target !== "static") throw new Error("static publication requires the verified static ordinary artifact");
  const manifestPath = path.join(artifactDirectory, "payload", "site-manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const site = JSON.parse(manifestBytes.toString("utf8"));
  validateSiteManifest(site);
  const handoff = new Map(artifactManifest.files.map((file) => [file.path, file]));
  const expectedHandoffPaths = [...site.files.map(({ path: relative }) => `payload/${relative}`), "payload/site-manifest.json"].sort();
  if (JSON.stringify([...handoff.keys()].sort()) !== JSON.stringify(expectedHandoffPaths)) throw new Error("static handoff contains files outside the closed site manifest");
  for (const file of site.files) {
    const record = handoff.get(`payload/${file.path}`);
    if (!record || record.bytes !== file.bytes || record.sha256 !== file.sha256) throw new Error(`static site file differs from the ordinary handoff: ${file.path}`);
  }
  const siteRecord = handoff.get("payload/site-manifest.json");
  if (siteRecord.bytes !== manifestBytes.length || siteRecord.sha256 !== sha256(manifestBytes)) throw new Error("static site manifest differs from the ordinary handoff");

  const immutable = site.files.filter(({ cacheClass }) => cacheClass === "immutable").map((file) => upload(file, artifactDirectory, "append-only"));
  const entryDocuments = ENTRY_DOCUMENTS.map((entry) => upload(site.files.find(({ path: relative }) => relative === entry), artifactDirectory, "versioned-replace"));
  const siteManifest = {
    key: "site-manifest.json",
    source: manifestPath,
    bytes: manifestBytes.length,
    sha256: sha256(manifestBytes),
    cacheClass: "no-cache",
    cacheControl: cacheControl("no-cache"),
    publicationMode: "versioned-replace",
    contentType: "application/json; charset=utf-8"
  };
  return Object.freeze({
    schema: "eacl-demo.static-publication-plan.v1",
    target: "static",
    demoSha: artifactManifest.demoSha,
    eaclSha: artifactManifest.eaclSha,
    artifactSha256: artifactManifest.artifactSha256,
    immutable: Object.freeze(immutable),
    preSmoke: Object.freeze([Object.freeze(siteManifest), ...entryDocuments]),
    postSmokeStatusKey: "registry/static.json",
    invalidationPaths: Object.freeze(["/index.html", "/datascript/index.html", "/site-manifest.json"]),
    smokePaths: Object.freeze(["/index.html", "/datascript/index.html", "/site-manifest.json", ...immutable.map(({ key }) => `/${key}`)])
  });
}

export function createStaticStatus({ plan, deployedAt, runId, runAttempt, objectVersions, rollbackVersions }) {
  if (plan?.schema !== "eacl-demo.static-publication-plan.v1") throw new Error("static status requires a closed publication plan");
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(runAttempt) || runAttempt < 1) throw new Error("static deployment run identity is invalid");
  if (typeof deployedAt !== "string" || Number.isNaN(Date.parse(deployedAt))) throw new Error("static deployment timestamp is invalid");
  const expectedKeys = plan.preSmoke.map(({ key }) => key).sort();
  if (!objectVersions || JSON.stringify(Object.keys(objectVersions).sort()) !== JSON.stringify(expectedKeys)) throw new Error("static deployment object-version set is incomplete");
  const expectedRollbackKeys = [...expectedKeys, plan.postSmokeStatusKey].sort();
  if (!rollbackVersions || JSON.stringify(Object.keys(rollbackVersions).sort()) !== JSON.stringify(expectedRollbackKeys)) throw new Error("static rollback object-version set is incomplete");
  for (const [key, versionId] of Object.entries(objectVersions)) {
    if (typeof versionId !== "string" || versionId.length < 1 || versionId.length > 1024) throw new Error(`static deployment object version is invalid: ${key}`);
  }
  for (const [key, versionId] of Object.entries(rollbackVersions)) {
    if (typeof versionId !== "string" || versionId.length < 1 || versionId.length > 1024) throw new Error(`static rollback object version is invalid: ${key}`);
  }
  return Object.freeze({
    schema: "eacl-demo.static-deployment-status.v1",
    target: "static",
    outcome: "succeeded",
    demoSha: plan.demoSha,
    eaclSha: plan.eaclSha,
    artifactSha256: plan.artifactSha256,
    deploymentId: `github:${runId}:${runAttempt}:${plan.artifactSha256.slice(0, 16)}`,
    deployedAt,
    objectVersions: Object.freeze({ ...objectVersions }),
    rollback: Object.freeze({ objectVersions: Object.freeze({ ...rollbackVersions }) })
  });
}

export async function executeStaticPublication({ plan, deployedAt, runId, runAttempt, storage, smoke = smokeStaticPublication, smokeOptions = {} }) {
  if (plan?.schema !== "eacl-demo.static-publication-plan.v1") throw new Error("static execution requires a closed publication plan");
  for (const method of ["assertFoundation", "currentVersion", "putImmutable", "putVersioned", "putStatus", "restoreVersion", "invalidate"]) {
    if (typeof storage?.[method] !== "function") throw new Error(`static storage adapter is missing ${method}`);
  }
  await storage.assertFoundation();
  const priorVersions = {};
  for (const key of [...plan.preSmoke.map(({ key }) => key), plan.postSmokeStatusKey]) {
    const versionId = await storage.currentVersion(key);
    if (typeof versionId !== "string" || versionId.length < 1 || versionId.length > 1024) throw new Error(`static ordinary publication requires a rollbackable prior version: ${key}`);
    priorVersions[key] = versionId;
  }

  const changed = [];
  let statusAttempted = false;
  try {
    await Promise.all(plan.immutable.map((item) => storage.putImmutable(item)));
    const objectVersions = {};
    for (const item of plan.preSmoke) {
      changed.push(item.key);
      objectVersions[item.key] = await storage.putVersioned(item);
    }
    await storage.invalidate(plan.invalidationPaths);
    await smoke({ plan, ...smokeOptions });
    const status = createStaticStatus({ plan, deployedAt, runId, runAttempt, objectVersions, rollbackVersions: priorVersions });
    statusAttempted = true;
    const statusVersionId = await storage.putStatus(status);
    await storage.invalidate([`/${plan.postSmokeStatusKey}`]);
    if (typeof storage.verifyStatus === "function") await storage.verifyStatus(status);
    return Object.freeze({ status, statusVersionId });
  } catch (error) {
    const rollbackFailures = [];
    const keys = [...(statusAttempted ? [plan.postSmokeStatusKey] : []), ...changed.reverse()];
    for (const key of keys) {
      try {
        await storage.restoreVersion(key, priorVersions[key]);
      } catch (rollbackError) {
        rollbackFailures.push(new Error(`static rollback failed for ${key}`, { cause: rollbackError }));
      }
    }
    if (keys.length > 0) {
      try {
        await storage.invalidate([...new Set([...plan.invalidationPaths, `/${plan.postSmokeStatusKey}`])]);
      } catch (rollbackError) {
        rollbackFailures.push(new Error("static rollback invalidation failed", { cause: rollbackError }));
      }
      if (typeof storage.verifyRollback === "function") {
        try {
          await storage.verifyRollback(priorVersions);
        } catch (rollbackError) {
          rollbackFailures.push(new Error("static rollback verification failed", { cause: rollbackError }));
        }
      }
    }
    if (rollbackFailures.length > 0) throw new AggregateError([error, ...rollbackFailures], "static publication failed and exact rollback was incomplete");
    throw error;
  }
}

export async function smokeStaticPublication({ plan, origin, fetchImpl = globalThis.fetch, maximumBytes = MAXIMUM_SMOKE_BYTES }) {
  if (plan?.schema !== "eacl-demo.static-publication-plan.v1") throw new Error("static smoke requires a closed publication plan");
  const trusted = new URL(origin);
  if (trusted.protocol !== "https:" || trusted.pathname !== "/" || trusted.search || trusted.hash || trusted.username || trusted.password) throw new Error("static smoke origin must be an exact HTTPS origin");
  if (typeof fetchImpl !== "function") throw new Error("static smoke fetch implementation is unavailable");
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAXIMUM_SMOKE_BYTES) throw new Error("static smoke byte bound is invalid");
  const expectedBytes = [...plan.preSmoke, ...plan.immutable].reduce((sum, item) => sum + item.bytes, 0);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > maximumBytes) throw new Error("static smoke expected payload exceeds its byte bound");
  let observedBytes = 0;
  for (const item of [...plan.preSmoke, ...plan.immutable]) {
    const response = await fetchImpl(new URL(`/${item.key}`, trusted), { method: "GET", redirect: "error", cache: "no-store", credentials: "omit" });
    if (!response?.ok || response.status !== 200 || response.redirected === true) throw new Error(`static smoke request failed: ${item.key}`);
    const contentType = response.headers?.get?.("content-type") ?? "";
    const responseCacheControl = response.headers?.get?.("cache-control") ?? "";
    if (contentType.toLowerCase() !== item.contentType.toLowerCase()) throw new Error(`static smoke content type mismatch: ${item.key}`);
    if (responseCacheControl.toLowerCase() !== item.cacheControl.toLowerCase()) throw new Error(`static smoke cache policy mismatch: ${item.key}`);
    const bytes = await readBoundedBytes(response, Math.min(item.bytes, maximumBytes - observedBytes));
    observedBytes += bytes.length;
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error(`static smoke content mismatch: ${item.key}`);
  }
  return Object.freeze({ result: "pass", checked: plan.preSmoke.length + plan.immutable.length, bytes: observedBytes });
}

function validateSiteManifest(site) {
  exactKeys(site, ["schema", "result", "uploadRoot", "entries", "sourceBuilds", "files"], "static site manifest");
  if (site.schema !== "eacl-demo.static-site.v1" || site.result !== "assembled" || site.uploadRoot !== "dist/static-site") throw new Error("static site manifest identity is invalid");
  exactKeys(site.entries, ["main", "datascript", "datascriptRuntime"], "static site entries");
  if (site.entries.main !== "index.html" || site.entries.datascript !== "datascript/index.html" || !/^datascript\/assets\/datascript-runtime-[0-9a-f]{64}\.js$/u.test(site.entries.datascriptRuntime)) throw new Error("static site entries are invalid");
  if (JSON.stringify(site.sourceBuilds) !== JSON.stringify(["explorer-main", "datascript-entry", "datascript-runtime"])) throw new Error("static source build closure is invalid");
  if (!Array.isArray(site.files) || site.files.length < 3 || site.files.length > 20_000) throw new Error("static site file list is invalid");
  const paths = new Set();
  for (const file of site.files) {
    exactKeys(file, ["path", "bytes", "sha256", "cacheClass"], "static site file");
    if (!/^[A-Za-z0-9._/-]+$/u.test(file.path) || file.path.startsWith("/") || file.path.split("/").includes("..") || file.path.startsWith("registry/") || file.path.includes("/.vite/") || file.path.startsWith(".vite/")) throw new Error(`static site file path is unsafe: ${file.path}`);
    if (paths.has(file.path)) throw new Error(`static site file path is duplicated: ${file.path}`);
    paths.add(file.path);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 512 * 1024 * 1024 || !SHA256.test(file.sha256)) throw new Error(`static site file identity is invalid: ${file.path}`);
    const entry = ENTRY_DOCUMENTS.includes(file.path);
    if (entry ? file.cacheClass !== "no-cache" : file.cacheClass !== "immutable") throw new Error(`static site cache class is unsafe: ${file.path}`);
  }
  for (const entry of [...ENTRY_DOCUMENTS, site.entries.datascriptRuntime]) if (!paths.has(entry)) throw new Error(`static site entry is missing: ${entry}`);
  if (JSON.stringify([...paths]) !== JSON.stringify([...paths].sort())) throw new Error("static site files are not sorted");
}

function upload(file, artifactDirectory, publicationMode) {
  return Object.freeze({
    key: file.path,
    source: path.join(artifactDirectory, "payload", file.path),
    bytes: file.bytes,
    sha256: file.sha256,
    cacheClass: file.cacheClass,
    cacheControl: cacheControl(file.cacheClass),
    publicationMode,
    contentType: contentType(file.path)
  });
}

function cacheControl(cacheClass) {
  if (cacheClass === "immutable") return "public,max-age=31536000,immutable";
  if (cacheClass === "no-cache") return "no-cache,max-age=0,must-revalidate";
  throw new Error(`static cache class is unsupported: ${cacheClass}`);
}

export async function readBoundedBytes(response, maximumBytes) {
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && declared !== "") {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) throw new Error("static smoke response length exceeded its byte bound");
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) throw new Error("static smoke response exceeded its byte bound");
    return bytes;
  }
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel("static smoke response exceeded its byte bound");
        throw new Error("static smoke response exceeded its byte bound");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

function contentType(key) {
  if (key.endsWith(".html")) return "text/html; charset=utf-8";
  if (key.endsWith(".css")) return "text/css; charset=utf-8";
  if (key.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (key.endsWith(".json") || key.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`${label} has unknown or missing fields`);
}
