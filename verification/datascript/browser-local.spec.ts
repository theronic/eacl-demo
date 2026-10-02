import { expect, test } from "@playwright/test";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createBenchmarkEvidenceIndex } from "../../packages/explorer-state/src/benchmark-publication.mjs";
import { createBaseRegistry, createProfilePublication } from "../../packages/explorer-state/src/profile-publication.mjs";

const readJson = (url: string) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [profileDefinitions, artifact] = await Promise.all([
  readJson("../../packages/contracts/profiles.v1.json"),
  readJson("../../dist/datascript-runtime/artifact.json")
]);
const baseRegistry = createBaseRegistry(profileDefinitions);
const demoSha = "a".repeat(40);
const dataManifestSha256 = "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a";

test("fixture initialization and authorization stay in the direct browser runtime", async ({ page }, testInfo) => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const browserErrors: string[] = [];
  const browserWarnings: string[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
    if (message.type() === "warning") browserWarnings.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(`${error.name}: ${error.message}`));
  await page.addInitScript(() => {
    (globalThis as typeof globalThis & { __eaclWorkerCount?: number }).__eaclWorkerCount = 0;
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = new Proxy(NativeWorker, {
      construct() {
        (globalThis as typeof globalThis & { __eaclWorkerCount?: number }).__eaclWorkerCount! += 1;
        throw new Error("DataScript must not create a Web Worker.");
      },
    });
  });
  const publishedAt = new Date();
  const deployedAt = new Date(publishedAt.getTime() - 1_000).toISOString();
  const baseline = baseRegistry.profiles.find(({ id }: { id: string }) => id === "datascript-browser-memory");
  const definition = profileDefinitions.profiles.find(({ id }: { id: string }) => id === "datascript-browser-memory");
  const deployment = {
    demoSha,
    eaclSha: artifact.eaclCoreSha,
    artifact: { kind: "static", sha256: artifact.artifact.sha256, version: "browser-qualification" },
    deploymentId: "datascript:browser-qualification",
    dataManifestSha256,
    deployedAt
  };
  const publication = await createProfilePublication({
    profile: {
      ...structuredClone(baseline), state: "enabled", reason: null, deployment,
      lastOutcome: { outcome: "succeeded", attemptedDemoSha: demoSha, attemptedEaclSha: artifact.eaclCoreSha, artifactSha256: artifact.artifact.sha256, at: deployedAt, message: "The direct browser runtime is enabled only inside this qualification fixture." }
    },
    definition,
    publishedAt: publishedAt.toISOString(),
    gate: { kind: "initial-qualification", evidenceId: `sha256:${"f".repeat(64)}` }
  }, { cryptoImpl: webcrypto, now: publishedAt });
  const profilePublications = new Map(await Promise.all(baseRegistry.profiles.map(async (profile: { id: string }) => {
    if (profile.id === "datascript-browser-memory") return [profile.id, publication] as const;
    const profileDefinition = profileDefinitions.profiles.find(({ id }: { id: string }) => id === profile.id);
    const record = await createProfilePublication({
      profile,
      definition: profileDefinition,
      publishedAt: publishedAt.toISOString(),
      gate: { kind: "merge-smoke", evidenceId: `sha256:${"e".repeat(64)}` },
    }, { cryptoImpl: webcrypto, now: publishedAt });
    return [profile.id, record] as const;
  })));
  const benchmarkIndex = await createBenchmarkEvidenceIndex({
    evidenceRecords: [],
    publishedAt: publishedAt.toISOString(),
  }, { cryptoImpl: webcrypto });
  await page.route("**/registry/profiles/*.json", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!.replace(/\.json$/u, "");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profilePublications.get(id)) });
  });
  await page.route("**/registry/benchmark-evidence/index.v1.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(benchmarkIndex),
  }));
  // The analytics script logs a warning when the page is served from this
  // loopback origin (demo.eacl.dev logs none), and it would be the only one.
  // Stub that third-party URL: the warning check below then covers first-party
  // code and needs no external network.
  await page.route("https://scripts.simpleanalyticscdn.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: "",
  }));

  const startupStartedAt = Date.now();
  await page.goto(process.env.EACL_DATASCRIPT_URL ?? "http://127.0.0.1:4174/");
  await expect(page.getByText(/SolidJS/iu)).toHaveCount(0);
  const selector = page.getByRole("region", { name: "Backend, Storage and Execution" });
  await expect(selector).toBeVisible();
  await expect(selector.getByRole("radio", { name: "DataScript", exact: true })).toBeChecked();
  await expect(selector.getByRole("radio", { name: "Browser In-memory", exact: true })).toBeChecked();
  await expect(selector.getByRole("radio", { name: "Browser", exact: true })).toBeChecked();
  const consistencyDisclosure = page.getByRole("button", { name: "Consistency Mode", exact: true });
  await expect(consistencyDisclosure).toBeVisible({ timeout: 60_000 });
  if (await consistencyDisclosure.getAttribute("aria-expanded") !== "true") {
    await consistencyDisclosure.click();
  }
  // DataScript has no authority to synchronize with: the mode is disabled with
  // the generic reason, never a server profile's cost or synchronization note.
  await expect(page.getByRole("radio", { name: "fully-consistent Requires authoritative synchronization", exact: true })).toBeDisabled();
  await expect(page.getByText(/cost-controlled demo|authoritative-head synchronization/iu)).toHaveCount(0);
  const startupElapsedMs = Date.now() - startupStartedAt;
  await testInfo.attach("datascript-startup.json", {
    body: JSON.stringify({ startupElapsedMs }),
    contentType: "application/json",
  });
  expect(startupElapsedMs).toBeLessThan(10_000);
  await expect(page.getByRole("heading", { name: "Verified profile facts" })).toHaveCount(0);
  await expect(page.locator(".metadata-list")).toHaveCount(0);
  expect(requests.some(({ url }) => url.endsWith(`/registry/profiles/datascript-browser-memory.json`))).toBe(true);
  expect(requests.some(({ url }) => url.endsWith(`/datascript/assets/datascript-runtime-${artifact.artifact.sha256}.js`))).toBe(true);
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __eaclWorkerCount?: number }).__eaclWorkerCount)).toBe(0);
  const objectCount = page.locator(".navbar-count").first();
  await expect(objectCount).toBeVisible();
  await expect(objectCount.locator("strong")).toHaveText("10,000");
  await expect(objectCount.locator("span")).toHaveText("objects");

  const defaults = await page.evaluate(async () => {
    const runtime = (globalThis as typeof globalThis & { EaclDataScriptRuntime?: { request: (operation: string, input: Record<string, unknown>, requestId: string) => Promise<any> } }).EaclDataScriptRuntime;
    if (!runtime) throw new Error("The direct DataScript runtime was not loaded.");
    let sequence = 0;
    const request = (operation: string, input: Record<string, unknown>) =>
      runtime.request(operation, input, `browser-defaults-${++sequence}`);
    return {
      object: await request("get-object", { type: "account", id: "account-0" }),
      subjects: await request("list-subjects", {}),
      count: await request("count-objects", { kind: "objects" }),
      schema: await request("get-schema", {}),
      resources: await request("lookup-resources", {
        subjectType: "user", subjectId: "user-1", resourceType: "account",
        permission: "admin", pageSize: 20, cache: true, populateCache: true
      }),
      viewResources: await request("lookup-resources", {
        subjectType: "user", subjectId: "user-1", resourceType: "account",
        permission: "view", pageSize: 20, cache: true, populateCache: true
      }),
      resourceCount: await request("count-resources", {
        subjectType: "user", subjectId: "user-1", resourceType: "account",
        permission: "admin", ceiling: 1_000, cache: true, populateCache: true
      }),
      subjectsWithPermission: await request("lookup-subjects", {
        resourceType: "account", resourceId: "account-0", subjectType: "user",
        permission: "admin", pageSize: 20, cache: true, populateCache: true
      }),
      authorization: await request("check-permission", {
        subjectType: "user", subjectId: "user-1", resourceType: "account",
        resourceId: "account-0", permission: "admin"
      }),
      unsupportedConsistency: await request("check-permission", {
        subjectType: "user", subjectId: "user-1", resourceType: "account",
        resourceId: "account-0", permission: "admin", consistency: "exact"
      }),
      cache: await request("get-cache-info", {}),
    };
  });
  expect(Object.keys(defaults.object).sort()).toEqual(["data", "meta"]);
  expect(defaults.object).toMatchObject({ data: { object: { type: "account", id: "account-0" } } });
  expect(Object.keys(defaults.object.meta).sort()).toEqual(["elapsedMs", "requestId", "revision"]);
  expect(defaults.subjects).toMatchObject({ data: { pageInfo: { pageSize: 25, hasNextPage: true } } });
  expect(defaults.subjects.data.items).toHaveLength(25);
  expect(defaults.count).toMatchObject({ data: { kind: "objects", value: 1_000, exact: false, ceiling: 1_000 } });
  expect(Object.keys(defaults.schema).sort()).toEqual(["data", "meta"]);
  expect(defaults.resources).toMatchObject({
    meta: { cacheStatus: expect.stringMatching(/^(?:hit|miss)$/u) },
  });
  expect(defaults.resources.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "account", id: "account-0" }),
  ]));
  expect(defaults.resources.meta.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(defaults.viewResources.data.pageInfo.endCursor).toBeNull();
  expect(defaults.resourceCount).toMatchObject({
    data: { kind: "objects", exact: true, ceiling: 1_000 }
  });
  expect(defaults.subjectsWithPermission.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "user", id: "user-1" }),
  ]));
  expect(Object.keys(defaults.authorization).sort()).toEqual(["data", "meta"]);
  expect(defaults.authorization.data).toEqual({ allowed: true });
  expect(Object.keys(defaults.authorization.meta).sort()).toEqual([
    "cacheStatus", "elapsedMs", "requestId", "revision",
  ]);
  expect(defaults.unsupportedConsistency).toMatchObject({
    error: { code: "unsupported-consistency" },
  });
  expect(Object.keys(defaults.unsupportedConsistency).sort()).toEqual(["error", "meta"]);
  expect(Object.keys(defaults.unsupportedConsistency.error).sort()).toEqual(["code", "message"]);
  expect(Object.keys(defaults.unsupportedConsistency.meta).sort()).toEqual(["elapsedMs", "requestId", "revision"]);
  expect(defaults.cache.data.provider).toEqual(expect.objectContaining({
    "exact-hits": expect.any(Number),
    misses: expect.any(Number),
    subproblems: expect.any(Object),
  }));
  expect(defaults.cache.data.operations["lookup-resources"]).toEqual(expect.objectContaining({
    count: expect.any(Number),
    totalMs: expect.any(Number),
    maxMs: expect.any(Number),
    averageMs: expect.any(Number),
    responseBytes: expect.any(Number),
  }));
  expect(Date.parse(defaults.cache.data.capturedAt)).not.toBeNaN();

  requests.length = 0;
  // Subjects are chosen in the View As dialog, quick subjects first.
  await page.getByRole("button", { name: "View As user-1", exact: true }).click();
  const viewAs = page.getByRole("dialog");
  await expect(viewAs.getByRole("heading", { name: "View As", exact: true })).toBeVisible();
  await expect(viewAs.getByRole("button", { name: "User 1", exact: true })).toBeVisible();
  await viewAs.getByRole("button", { name: "Close View As", exact: true }).click();
  await expect(viewAs).toBeHidden();
  await expect(page.getByRole("button", { name: "Resources", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Permission Schema", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Schema Graph", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cache Diagnostics", exact: true })).toBeVisible();
  await expect(page.getByText("Click a resource to inspect it.", { exact: true })).toBeVisible();
  // Accounts start expanded, and user-1 administers account-0.
  await expect(page.getByRole("button", { name: "account type Accounts", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "account type account-0", exact: true }).click();
  await expect(page.locator(".detail-header__id")).toHaveText("account-0");
  await expect(page.getByRole("heading", { name: "Permissions", exact: true })).toBeVisible();
  const adminDecision = page.locator('.permission-decision[data-permission="admin"]');
  await expect(adminDecision.locator(".permission-decision__status--allowed")).toBeVisible();
  await expect(adminDecision.locator(".cache-timing")).toBeVisible();
  await expect(adminDecision.locator(".cache-timing__status")).toHaveText(/^(?:HIT|MISS)$/u);

  const panelTops = await page.locator(".panel-grid > .panel-host").evaluateAll((panels) =>
    panels.map((panel) => Math.round(panel.getBoundingClientRect().top)),
  );
  expect(panelTops).toHaveLength(2);
  if (testInfo.project.name.startsWith("desktop")) {
    expect(new Set(panelTops).size).toBe(1);
  } else {
    expect(panelTops[0]).toBeLessThan(panelTops[1]);
  }

  expect(requests).toEqual([]);
  expect(browserErrors).toEqual([]);
  expect(browserWarnings).toEqual([]);
});
