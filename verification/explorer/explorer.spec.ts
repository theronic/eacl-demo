import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createBenchmarkEvidenceIndex } from "../../packages/explorer-state/src/benchmark-publication.mjs";
import { createProfilePublication } from "../../packages/explorer-state/src/profile-publication.mjs";

let browserErrors: string[] = [];
let baselinePublications: Map<string, unknown>;
let emptyBenchmarkIndex: unknown;

test.beforeAll(async () => {
  const publishedAt = new Date().toISOString();
  const [baseRegistry, profileDefinitions] = await Promise.all([
    readFile(new URL("../../registry/profile-registry.v1.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../../packages/contracts/profiles.v1.json", import.meta.url), "utf8").then(JSON.parse)
  ]);
  baselinePublications = new Map(await Promise.all(baseRegistry.profiles.map(async (profile) => {
    const definition = profileDefinitions.profiles.find(({ id }) => id === profile.id)!;
    const publication = await createProfilePublication({ profile, definition, publishedAt, gate: { kind: "merge-smoke", evidenceId: `sha256:${"8".repeat(64)}` } });
    return [profile.id, publication] as const;
  })));
  emptyBenchmarkIndex = await createBenchmarkEvidenceIndex({ evidenceRecords: [], publishedAt });
});

test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.name));
  await page.route("**/registry/profiles/*.json", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!.replace(/\.json$/u, "");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(baselinePublications.get(id)) });
  });
  await page.route("**/registry/benchmark-evidence/index.v1.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyBenchmarkIndex) }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("EACL Explorer");
  await expect(page.getByText(/SolidJS/iu)).toHaveCount(0);
});

test.afterEach(async () => {
  expect(browserErrors, "browser console/page errors").toEqual([]);
});

test("two-step selection, canonical normalization, and keyboard focus remain usable", async ({ page }) => {
  const backend = page.getByRole("radio", { name: "Datomic", exact: true });
  const storage = page.getByRole("radio", { name: "DynamoDB", exact: true });
  await expect(page.getByRole("radio", { name: "Datahike", exact: true })).toBeChecked();
  await backend.check();
  await expect(storage).toBeChecked();
  await expect(page).toHaveURL(/backend=datomic&storage=dynamodb/u);
  await expect(page.locator(".profile-status, .metadata-list")).toHaveCount(0);

  await expect(backend).toBeFocused();
});

test("DataScript remains a separate browser entry", async ({ page }) => {
  const originalUrl = page.url();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("radio", { name: "DataScript", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/datascript\//u);
  await expect(page).toHaveURL(originalUrl);
  await expect(page.getByRole("radio", { name: "Datahike", exact: true })).toBeChecked();
  await popup.close();
});

test("WCAG 2.2 AA automated scan and responsive viewport checks pass", async ({ page }) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1);
});

test("manual theme preference persists and reduced motion disables continuous animation", async ({ page }) => {
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.getByRole("button", { name: "Light theme" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const animation = await page.evaluate(() => {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    document.body.append(spinner);
    const style = getComputedStyle(spinner);
    return { duration: style.animationDuration, iterations: style.animationIterationCount };
  });
  expect(Number.parseFloat(animation.duration)).toBeLessThanOrEqual(0.001);
  expect(animation.iterations).toBe("1");
});

test("an enabled publication opens the schema-validated server explorer over the exact profile route", async ({ page }, testInfo) => {
  const now = new Date();
  const deployedAt = new Date(now.getTime() - 1_000).toISOString();
  const identity = {
    profileId: "datahike-s3",
    demoSha: "a".repeat(40),
    eaclSha: "8dc3b16498788dd822b68e1c4fe25b37a8e8879f",
    artifactSha256: "b".repeat(64),
    deploymentId: "datahike-s3:browser-test-7",
    dataManifestSha256: "c".repeat(64)
  };
  const profile = {
    id: identity.profileId, backend: "datahike", storage: "s3", state: "enabled", reason: null,
    route: "/api/v1/datahike-s3",
    deployment: {
      demoSha: identity.demoSha, eaclSha: identity.eaclSha,
      artifact: { kind: "lambda-version", sha256: identity.artifactSha256, version: "7" },
      deploymentId: identity.deploymentId, dataManifestSha256: identity.dataManifestSha256, deployedAt
    },
    lastOutcome: { outcome: "succeeded", attemptedDemoSha: identity.demoSha, attemptedEaclSha: identity.eaclSha, artifactSha256: identity.artifactSha256, at: deployedAt, message: "The exact browser-test candidate passed its qualification gate." }
  };
  const publication = await createProfilePublication({
    profile,
    definition: { id: profile.id, backend: profile.backend, storage: profile.storage },
    publishedAt: now.toISOString(),
    gate: { kind: "merge-smoke", evidenceId: `sha256:${"9".repeat(64)}` }
  });
  const basis = { behavior: "request-snapshot", id: "datahike:test-basis-7", capturedAt: deployedAt, fixedForEnvironment: false };
  const descriptor = {
    contract: { name: "explorer.v1", routeMajor: 1, revision: 2, minimumClientRevision: 1 }, identity,
    profile: { backend: "datahike", storage: "s3" },
    runtime: { execution: "lambda", name: "java25", architecture: "arm64", snapStart: "enabled" },
    capabilities: {
      operations: ["health", "bootstrap", "list-subjects", "get-object", "list-relationships", "reverse-relationships", "authorize", "lookup-resources", "lookup-subjects", "count-resources", "get-schema", "get-cache-info", "count-objects"],
      consistencyModes: ["current", "minimize"], snapshotBehavior: "request-snapshot", cacheBehavior: "environment-local", mutationLocality: "none", limitations: ["read-only"]
    },
    limits: [{ name: "page-size", value: 100 }, { name: "count-ceiling", value: 1_000_000 }],
    dataset: { fixtureId: "eacl-demo-fixture-v1", logicalResourceCount: 1_000_000, manifestSha256: identity.dataManifestSha256 }, basis
  };
  const apiRequests: Array<{ operation: string; requestId: string | null; payloadHash: string | null }> = [];

  await page.route("**/registry/profiles/*.json", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/datahike-s3.json")) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(publication) });
    else {
      const id = url.pathname.split("/").at(-1)!.replace(/\.json$/u, "");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(baselinePublications.get(id)) });
    }
  });
  await page.route("**/api/v1/datahike-s3/*", async (route) => {
    const request = route.request();
    const operation = new URL(request.url()).pathname.split("/").at(-1)!;
    const requestId = request.headers()["x-eacl-request-id"] ?? null;
    const payloadHash = request.headers()["x-amz-content-sha256"] ?? null;
    apiRequests.push({ operation, requestId, payloadHash });
    const input = request.method() === "POST" ? request.postDataJSON() : {};
    const pageInfo = { hasNextPage: false, endCursor: null, pageSize: input.pageSize ?? 1 };
    const object = { type: input.type ?? input.resourceType ?? "server", id: input.id ?? input.resourceId ?? "server-1", displayName: "Server one", attributes: [] };
    const data: Record<string, unknown> = {
      health: { status: "ready", ready: true, identity, basis },
      bootstrap: descriptor,
      "list-subjects": { items: [{ type: "user", id: "user-1", displayName: "User one", attributes: [] }], pageInfo },
      "get-object": { object },
      "list-relationships": { items: [{ resourceType: input.resourceType, resourceId: input.resourceId, relation: input.relation ?? "owner", subjectType: "user", subjectId: "user-1", subjectRelation: null }], pageInfo },
      "reverse-relationships": { items: [object], pageInfo },
      authorize: { subjectType: input.subjectType, subjectId: input.subjectId, resourceType: input.resourceType, resourceId: input.resourceId, permission: input.permission, allowed: true, reasonCode: "granted", path: [{ kind: "direct", label: "fixture grant", allowed: true }] },
      "lookup-resources": { items: [{ type: input.resourceType, id: "server-1", displayName: "Server one", attributes: [] }], pageInfo },
      "lookup-subjects": { items: [{ type: input.subjectType, id: "user-1", displayName: "User one", attributes: [] }], pageInfo },
      "count-resources": { kind: "objects", value: 1, exact: true, ceiling: input.ceiling },
      "get-schema": { sha256: "d".repeat(64), types: [{ name: "server", relations: [{ name: "owner", subjectTypes: ["user"] }], permissions: [{ name: "view", expression: "owner" }] }] },
      "get-cache-info": { behavior: "environment-local", hit: null, scope: "datahike-s3", entries: null, limitations: [] },
      "count-objects": { kind: input.kind, value: input.ceiling, exact: false, ceiling: input.ceiling }
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        meta: {
          contractVersion: "explorer.v1",
          requestId,
          operation,
          identity,
          basis,
          elapsedMs: 1.25,
          cacheStatus: input.cache === false ? "disabled" : "hit",
        },
        data: data[operation],
      }),
    });
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Backend & Storage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Read Basis" })).toBeVisible();
  await expect(page.getByText(/independent profile status records/u)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Verified profile facts" })).toHaveCount(0);
  await expect(page.locator(".profile-status, .metadata-list")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "User 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Schema/u })).toBeVisible();
  await expect(page.getByLabel("Page size").locator("option")).toHaveText([
    "10", "20", "50", "100", "250", "500", "1,000",
  ]);
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
  await page.getByRole("button", { name: "Servers" }).click();
  await page.getByRole("button", { name: /Server 1/u }).click();
  await expect(page.locator(".permission-decision__status--allowed", { hasText: "Allowed" })).toBeVisible();
  await expect(page.locator(".cache-timing", { hasText: "1.25ms" }).first()).toBeVisible();
  await expect(page.locator(".cache-timing__status", { hasText: "hit" }).first()).toBeVisible();
  expect(apiRequests.map(({ operation }) => operation)).toEqual(expect.arrayContaining(["health", "bootstrap", "list-subjects", "get-schema", "lookup-resources", "count-resources", "authorize", "lookup-subjects"]));
  expect(apiRequests.every(({ requestId }) => /^browser-|^[0-9]+-[0-9]+$/u.test(requestId ?? ""))).toBe(true);
  expect(apiRequests.filter(({ operation }) => !["health", "bootstrap"].includes(operation)).every(({ payloadHash }) => /^[0-9a-f]{64}$/u.test(payloadHash ?? ""))).toBe(true);
});
