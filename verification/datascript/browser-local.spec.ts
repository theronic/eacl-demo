import { expect, test } from "@playwright/test";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createBenchmarkEvidenceIndex } from "../../packages/explorer-state/src/benchmark-publication.mjs";
import { createProfilePublication } from "../../packages/explorer-state/src/profile-publication.mjs";

const readJson = (url: string) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [baseRegistry, profileDefinitions, artifact] = await Promise.all([
  readJson("../../registry/profile-registry.v1.json"),
  readJson("../../packages/contracts/profiles.v1.json"),
  readJson("../../dist/datascript-worker/artifact.json")
]);
const demoSha = "a".repeat(40);
const dataManifestSha256 = "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a";

test("fixture initialization and authorization stay in the browser worker", async ({ page }, testInfo) => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const browserErrors: string[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(`${error.name}: ${error.message}`));
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = new Proxy(NativeWorker, {
      construct(Target, argumentsList) {
        const worker = Reflect.construct(Target, argumentsList) as Worker;
        (globalThis as typeof globalThis & { __eaclWorker?: Worker }).__eaclWorker = worker;
        return worker;
      }
    });
  });
  const publishedAt = new Date();
  const deployedAt = new Date(publishedAt.getTime() - 1_000).toISOString();
  const baseline = baseRegistry.profiles.find(({ id }: { id: string }) => id === "datascript-browser-memory");
  const definition = profileDefinitions.profiles.find(({ id }: { id: string }) => id === "datascript-browser-memory");
  const deployment = {
    demoSha,
    eaclSha: artifact.eaclCoreSha,
    artifact: { kind: "browser-worker", sha256: artifact.artifact.sha256, version: "browser-qualification" },
    deploymentId: "datascript:browser-qualification",
    dataManifestSha256,
    deployedAt
  };
  const publication = await createProfilePublication({
    profile: {
      ...structuredClone(baseline), state: "enabled", reason: null, deployment,
      lastOutcome: { outcome: "succeeded", attemptedDemoSha: demoSha, attemptedEaclSha: artifact.eaclCoreSha, artifactSha256: artifact.artifact.sha256, at: deployedAt, message: "The browser worker is enabled only inside this qualification fixture." }
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

  await page.goto(process.env.EACL_DATASCRIPT_URL ?? "http://127.0.0.1:4174/datascript/");
  await expect(page.getByText(/SolidJS/iu)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Backend & Storage" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "DataScript", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Browser memory", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Read Basis" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Verified profile facts" })).toHaveCount(0);
  await expect(page.locator(".metadata-list")).toHaveCount(0);
  expect(requests.some(({ url }) => url.endsWith(`/registry/profiles/datascript-browser-memory.json`))).toBe(true);
  expect(requests.some(({ url }) => url.endsWith(`/datascript/assets/datascript-worker-${artifact.artifact.sha256}.js`))).toBe(true);

  const defaults = await page.evaluate(async () => {
    const worker = (globalThis as typeof globalThis & { __eaclWorker?: Worker }).__eaclWorker;
    if (!worker) throw new Error("The verified DataScript worker was not captured.");
    let sequence = 0;
    const request = (operation: string, input: Record<string, unknown>) => new Promise<any>((resolve, reject) => {
      const requestId = `browser-defaults-${++sequence}`;
      const timeout = setTimeout(() => {
        worker.removeEventListener("message", onMessage);
        reject(new Error(`Timed out waiting for ${operation}.`));
      }, 10_000);
      const onMessage = (event: MessageEvent) => {
        if (event.data?.requestId !== requestId || !["response", "protocol-error"].includes(event.data?.type)) return;
        clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        if (event.data.type === "protocol-error") reject(new Error(`${operation}: ${event.data.error?.code}`));
        else resolve(event.data.response);
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({
        type: "request",
        contractVersion: "explorer.v1",
        profileId: "datascript-browser-memory",
        requestId,
        clientEpoch: 1,
        operation,
        input
      });
    });
    return {
      object: await request("get-object", { type: "account", id: "account-0" }),
      subjects: await request("list-subjects", {}),
      count: await request("count-objects", { kind: "objects" }),
      schema: await request("get-schema", {}),
      resources: await request("lookup-resources", {
        subjectType: "user", subjectId: "user-1", resourceType: "account",
        permission: "admin", pageSize: 20, cache: true, populateCache: true,
        consistency: "current"
      }),
      viewResources: await request("lookup-resources", {
        subjectType: "user", subjectId: "user-1", resourceType: "account",
        permission: "view", pageSize: 20, cache: true, populateCache: true,
        consistency: "current"
      }),
      resourceCount: await request("count-resources", {
        subjectType: "user", subjectId: "user-1", resourceType: "account",
        permission: "admin", ceiling: 1_000, cache: true, populateCache: true,
        consistency: "current"
      }),
      subjectsWithPermission: await request("lookup-subjects", {
        resourceType: "account", resourceId: "account-0", subjectType: "user",
        permission: "admin", pageSize: 20, cache: true, populateCache: true,
        consistency: "current"
      }),
      unsupportedConsistency: await request("authorize", {
        subjectType: "user", subjectId: "user-1", resourceType: "account",
        resourceId: "account-0", permission: "admin", consistency: "exact"
      }),
    };
  });
  expect(defaults.object).toMatchObject({ ok: true, data: { object: { type: "account", id: "account-0" } } });
  expect(defaults.subjects).toMatchObject({ ok: true, data: { pageInfo: { pageSize: 25, hasNextPage: true } } });
  expect(defaults.subjects.data.items).toHaveLength(25);
  expect(defaults.count).toMatchObject({ ok: true, data: { kind: "objects", value: 1_000, exact: false, ceiling: 1_000 } });
  expect(defaults.schema).toMatchObject({ ok: true });
  expect(defaults.resources).toMatchObject({
    ok: true,
    meta: { operation: "lookup-resources", cacheStatus: expect.stringMatching(/^(?:hit|miss)$/u) },
  });
  expect(defaults.resources.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "account", id: "account-0" }),
  ]));
  expect(defaults.resources.meta.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(defaults.viewResources.data.pageInfo.endCursor).toBeNull();
  expect(defaults.resourceCount).toMatchObject({
    ok: true,
    meta: { operation: "count-resources" },
    data: { kind: "objects", exact: true, ceiling: 1_000 }
  });
  expect(defaults.subjectsWithPermission).toMatchObject({
    ok: true,
    meta: { operation: "lookup-subjects" },
  });
  expect(defaults.subjectsWithPermission.data.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "user", id: "user-1" }),
  ]));
  expect(defaults.unsupportedConsistency).toMatchObject({
    ok: false,
    error: { code: "unsupported-consistency" },
    meta: { operation: "authorize", elapsedMs: expect.any(Number) },
  });

  requests.length = 0;
  await expect(page.getByRole("heading", { name: "Subjects & permissions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resources" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Detail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Schema" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cache", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "User 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Accounts" }).click();
  await expect(page.locator(".resource-button").first()).toBeVisible();
  await page.locator(".resource-button").first().click();
  await expect(page.getByRole("heading", { name: "Can active subject?" })).toBeVisible();
  await expect(page.locator(".permission-decision__status--allowed").first()).toBeVisible();
  await expect(page.locator(".cache-timing").first()).toBeVisible();
  await expect(page.locator(".cache-timing__status").first()).toHaveText(/^(?:hit|miss)$/u);

  const panelTops = await page.locator(".panel-grid > .panel-host").evaluateAll((panels) =>
    panels.map((panel) => Math.round(panel.getBoundingClientRect().top)),
  );
  expect(panelTops).toHaveLength(3);
  if (testInfo.project.name.startsWith("desktop")) {
    expect(new Set(panelTops).size).toBe(1);
  } else {
    expect(panelTops[0]).toBeLessThan(panelTops[1]);
    expect(panelTops[1]).toBeLessThan(panelTops[2]);
  }

  expect(requests).toEqual([]);
  expect(browserErrors).toEqual([]);
});
