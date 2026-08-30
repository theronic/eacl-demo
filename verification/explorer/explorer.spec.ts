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
  await page.goto("/?backend=datahike&storage=s3&platform=lambda-1024");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("EACL Explorer");
  await expect(page.locator(".app-subtitle")).toHaveText(
    "🦅 EACL: Enterprise Access ControL is a ReBAC Authorization library inspired by SpiceDB, built in Clojure and backed by Datomic Pro, Datahike or DataScript.",
  );
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

test("DataScript navigates to its separate browser entry", async ({ page }) => {
  await Promise.all([
    page.waitForURL(/\/datascript\//u),
    page.getByRole("radio", { name: "DataScript", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(/\/datascript\//u);
});

test("the landing page defaults to the first, zero-Lambda DataScript option", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/datascript\/\?backend=datascript&storage=browser-memory&platform=browser/u);
  const backends = page.locator('input[name="explorer-backend"]');
  await expect(backends.first()).toHaveValue("datascript");
  await expect(page.getByRole("radio", { name: "DataScript", exact: true })).toBeChecked();
});

test("a coherent Datomic EC2 version drift remains usable and shows registry/service detail", async ({ page }) => {
  const deployedAt = new Date().toISOString();
  const identity = {
    profileId: "datomic-dynamodb",
    demoSha: "a".repeat(40),
    eaclSha: "b".repeat(40),
    artifactSha256: "c".repeat(64),
    deploymentId: "datomic-dynamodb:browser-test-1",
    dataManifestSha256: "d".repeat(64),
  };
  const profile = {
    id: identity.profileId,
    backend: "datomic",
    storage: "dynamodb",
    state: "enabled" as const,
    reason: null,
    route: "/",
    deployment: {
      demoSha: identity.demoSha,
      eaclSha: identity.eaclSha,
      artifact: { kind: "lambda-version" as const, sha256: identity.artifactSha256, version: "1" },
      deploymentId: identity.deploymentId,
      dataManifestSha256: identity.dataManifestSha256,
      deployedAt,
    },
    lastOutcome: {
      outcome: "succeeded" as const,
      attemptedDemoSha: identity.demoSha,
      attemptedEaclSha: identity.eaclSha,
      artifactSha256: identity.artifactSha256,
      at: deployedAt,
      message: "The browser-test candidate passed its qualification gate.",
    },
  };
  const publication = await createProfilePublication({
    profile,
    definition: { id: profile.id, backend: profile.backend, storage: profile.storage },
    publishedAt: deployedAt,
    gate: { kind: "merge-smoke", evidenceId: `sha256:${"e".repeat(64)}` },
  });
  const basis = {
    behavior: "fixed-environment",
    id: "datomic:eacl-demo:test",
    capturedAt: deployedAt,
    fixedForEnvironment: true,
  };
  const serviceIdentity = {
    ...identity,
    demoSha: "f".repeat(40),
    eaclSha: "9".repeat(40),
    artifactSha256: "8".repeat(64),
    deploymentId: "datomic-dynamodb:browser-test-old",
  };
  const descriptor = {
    contract: { name: "explorer.v1", routeMajor: 1, revision: 4, minimumClientRevision: 1 },
    identity: serviceIdentity,
    profile: { backend: profile.backend, storage: profile.storage },
    runtime: { execution: "ec2", name: "java25", architecture: "arm64", snapStart: "not-applicable" },
    capabilities: {
      operations: ["health", "bootstrap", "list-subjects", "get-object", "list-relationships", "reverse-relationships", "check-permission", "lookup-resources", "lookup-subjects", "count-resources", "get-schema", "get-cache-info", "count-objects"],
      consistencyModes: ["minimize", "exact", "historical-date"],
      snapshotBehavior: "fixed-environment",
      cacheBehavior: "environment-local",
      mutationLocality: "none",
      limitations: ["read-only"],
    },
    limits: [{ name: "page-size", value: 100 }, { name: "count-ceiling", value: 1_000_000 }],
    dataset: {
      fixtureId: "eacl-demo-fixture-v1",
      logicalResourceCount: 10_000,
      serverCount: 10_000,
      manifestSha256: identity.dataManifestSha256,
    },
    basis,
  };
  let healthRequests = 0;
  const apiInputs: Array<{ operation: string; input: Record<string, unknown> }> = [];

  await page.route("**/registry/profiles/datomic-dynamodb.json", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(publication),
  }));
  await page.route("https://datomic.demo.eacl.dev/**", async (route) => {
    const operation = new URL(route.request().url()).pathname.slice(1);
    const requestId = route.request().headers()["x-eacl-request-id"];
    const input = route.request().method() === "POST"
      ? route.request().postDataJSON() as Record<string, unknown>
      : {};
    apiInputs.push({ operation, input });
    if (operation === "health") healthRequests += 1;
    const pageInfo = { hasNextPage: false, endCursor: null, pageSize: input.pageSize ?? 20 };
    const object = { type: input.resourceType ?? input.type ?? "server", id: input.resourceId ?? input.id ?? "server-1", displayName: "Server one", attributes: [] };
    const data: Record<string, unknown> = {
      health: { status: "ready", ready: true, identity: serviceIdentity, basis },
      bootstrap: descriptor,
      "get-schema": { sha256: "d".repeat(64), types: [{ name: "server", relations: [{ name: "owner", subjectTypes: ["user"] }], permissions: [{ name: "admin", expression: "owner" }, { name: "view", expression: "owner" }] }] },
      "list-subjects": { items: [{ type: "user", id: "user-1", displayName: "User one", attributes: [] }], pageInfo },
      "get-object": { object },
      "list-relationships": { items: [], pageInfo },
      "reverse-relationships": { items: [object], pageInfo },
      "check-permission": { allowed: true },
      "lookup-resources": { items: [object], pageInfo },
      "lookup-subjects": { items: [{ type: "user", id: "user-1", displayName: "User one", attributes: [] }], pageInfo },
      "count-resources": { kind: "objects", value: 1, exact: true, ceiling: input.ceiling ?? 1_000 },
      "get-cache-info": { provider: { behavior: "environment-local", entries: 1 }, operations: {}, capturedAt: deployedAt },
      "count-objects": { kind: input.kind ?? "resources", value: 1, exact: true, ceiling: input.ceiling ?? 1_000 },
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        meta: { requestId, revision: basis.id, elapsedMs: 1 },
        data: data[operation],
      }),
    });
  });

  await page.goto("/?backend=datomic&storage=dynamodb&platform=ec2");
  const warning = page.locator(".deployment-warning");
  await expect(warning).toContainText("Datomic service version warning");
  await expect(warning).toContainText("out-of-date EACL version");
  await expect(warning).toContainText(identity.eaclSha);
  await expect(warning).toContainText(serviceIdentity.eaclSha);
  await expect(page.getByText("Datomic startup failed")).toHaveCount(0);
  await expect(page.getByText(/Connecting to Datomic EC2/iu)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Consistency Semantics" })).toBeVisible();
  await page.getByRole("button", { name: "Consistency Semantics" }).click();
  await page.getByRole("radio", { name: "at-exact-snapshot", exact: true }).check();
  const exactDate = page.getByLabel("at-exact-snapshot date");
  await expect(exactDate).toBeEnabled();
  await exactDate.fill("2026-08-24T10:00");
  await expect(exactDate).toHaveValue("2026-08-24T10:00");
  await page.getByRole("button", { name: "Query", exact: true }).click();
  const expectedExactDate = await page.evaluate(
    () => new Date("2026-08-24T10:00:00").toISOString(),
  );
  await expect(page.getByLabel("Arbitrary EACL permission check")).toBeVisible();
  await expect.poll(() => apiInputs
    .filter(({ operation }) => operation === "check-permission")
    .map(({ input }) => input)).toContainEqual(expect.objectContaining({
      consistency: "historical-date",
      atExactSnapshotAt: expectedExactDate,
    }));
  expect(healthRequests).toBeGreaterThan(0);
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
    eaclSha: "990a58162a0a03c365db46cf166c5966ab70950a",
    artifactSha256: "b".repeat(64),
    deploymentId: "datahike-s3:browser-test-7",
    dataManifestSha256: "c".repeat(64)
  };
  const profile = {
    id: identity.profileId, backend: "datahike", storage: "s3", state: "enabled", reason: null,
    route: "/",
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
  let healthCaptures = 0;
  const descriptor = {
    contract: { name: "explorer.v1", routeMajor: 1, revision: 4, minimumClientRevision: 1 }, identity,
    profile: { backend: "datahike", storage: "s3" },
    runtime: { execution: "lambda", name: "java25", architecture: "arm64", snapStart: "enabled" },
    capabilities: {
      operations: ["health", "bootstrap", "list-subjects", "get-object", "list-relationships", "reverse-relationships", "check-permission", "lookup-resources", "lookup-subjects", "count-resources", "get-schema", "get-cache-info", "count-objects"],
      consistencyModes: ["minimize", "at-least"], snapshotBehavior: "request-snapshot", cacheBehavior: "environment-local", mutationLocality: "none", limitations: ["read-only"]
    },
    limits: [{ name: "page-size", value: 100 }, { name: "count-ceiling", value: 1_000_000 }],
    dataset: { fixtureId: "eacl-demo-fixture-v1", logicalResourceCount: 1_000_000, serverCount: 1_000_000, manifestSha256: identity.dataManifestSha256 }, basis
  };
  const apiRequests: Array<{
    operation: string;
    requestId: string | null;
    origin: string;
    payloadHash: string | null;
    input: Record<string, unknown>;
  }> = [];

  await page.route("**/registry/profiles/*.json", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/datahike-s3.json")) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(publication) });
    else {
      const id = url.pathname.split("/").at(-1)!.replace(/\.json$/u, "");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(baselinePublications.get(id)) });
    }
  });
  await page.route("https://nkpogjjpx5wyb4imujlrefedqu0qpqwu.lambda-url.us-east-1.on.aws/**", async (route) => {
    const request = route.request();
    const operation = new URL(request.url()).pathname.split("/").at(-1)!;
    const requestId = request.headers()["x-eacl-request-id"] ?? null;
    const payloadHash = request.headers()["x-amz-content-sha256"] ?? null;
    const input = request.method() === "POST"
      ? request.postDataJSON() as Record<string, unknown>
      : {};
    apiRequests.push({ operation, requestId, origin: new URL(request.url()).origin, payloadHash, input });
    const lookupPageTwo = operation === "lookup-resources" && Boolean(input.cursor);
    const pageInfo = operation === "lookup-resources"
      ? {
          hasNextPage: !lookupPageTwo,
          endCursor: lookupPageTwo ? null : "resources-page-2",
          pageSize: input.pageSize ?? 1,
        }
      : { hasNextPage: false, endCursor: null, pageSize: input.pageSize ?? 1 };
    const objectId = lookupPageTwo ? "server-2" : "server-1";
    const object = { type: input.type ?? input.resourceType ?? "server", id: input.id ?? input.resourceId ?? objectId, displayName: lookupPageTwo ? "Server two" : "Server one", attributes: [] };
    const healthBasis = operation === "health"
      ? { ...basis, capturedAt: new Date(new Date(deployedAt).getTime() + healthCaptures++ * 1_000).toISOString() }
      : basis;
    const data: Record<string, unknown> = {
      health: { status: "ready", ready: true, identity, basis: healthBasis },
      bootstrap: descriptor,
      "list-subjects": { items: [{ type: "user", id: "user-1", displayName: "User one", attributes: [] }], pageInfo },
      "get-object": { object },
      "list-relationships": { items: [{ resourceType: input.resourceType, resourceId: input.resourceId, relation: input.relation ?? "owner", subjectType: "user", subjectId: "user-1", subjectRelation: null }], pageInfo },
      "reverse-relationships": { items: [object], pageInfo },
      "check-permission": { allowed: true },
      "lookup-resources": { items: [{ type: input.resourceType, id: objectId, displayName: lookupPageTwo ? "Server two" : "Server one", attributes: [] }], pageInfo },
      "lookup-subjects": { items: [{ type: input.subjectType, id: "user-1", displayName: "User one", attributes: [] }], pageInfo },
      "count-resources": { kind: "objects", value: 1, exact: true, ceiling: input.ceiling },
      "get-schema": { sha256: "d".repeat(64), types: [{ name: "server", relations: [{ name: "owner", subjectTypes: ["user"] }], permissions: [{ name: "view", expression: "owner" }] }] },
      "get-cache-info": {
        provider: {
          "exact-hits": 9,
          misses: 2,
          tiers: { answer: { entries: 4, weight: 12, "max-weight": 1_000 } },
        },
        operations: {
          "lookup-resources": {
            count: 3,
            totalMs: 7.5,
            maxMs: 4.0,
            averageMs: 2.5,
            responseBytes: 900,
            cacheStatus: { hit: 2, miss: 1 },
          },
        },
        capturedAt: deployedAt,
      },
      "count-objects": { kind: input.kind, value: input.ceiling, exact: false, ceiling: input.ceiling }
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        meta: {
          requestId,
          revision: basis.id,
          elapsedMs: 1.25,
          cacheStatus: input.cache === false ? "disabled" : "hit",
        },
        data: data[operation],
      }),
    });
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Backend & Storage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Consistency Semantics" })).toBeVisible();
  await page.getByRole("button", { name: "Consistency Semantics" }).click();
  await page.getByRole("radio", { name: "at-least-as-fresh", exact: true }).check();
  await expect(page.getByRole("radio", { name: "Seconds ago", exact: true })).toBeChecked();
  const secondsAgo = page.getByLabel("at-least seconds ago");
  await expect(secondsAgo).toHaveValue("60");
  await expect(page.getByText(/“Now” is the current selected snapshot date/iu)).toBeVisible();
  await expect.poll(() => apiRequests.filter(({ input }) => input.consistency === "at-least").length).toBeGreaterThan(0);
  const initialRelativeRequest = apiRequests.filter(({ input }) => input.consistency === "at-least").at(-1)!.input;
  expect(initialRelativeRequest.atLeastAsFreshBasisCapturedAt).toBe(basis.capturedAt);
  expect(initialRelativeRequest.atLeastAsFreshAs).toBe(
    new Date(new Date(basis.capturedAt).getTime() - 60_000).toISOString(),
  );
  await page.getByRole("radio", { name: "Absolute datetime", exact: true }).check();
  const atLeastDate = page.getByLabel("at-least-as-fresh-as date");
  await expect(atLeastDate).toBeEnabled();
  await expect(atLeastDate).not.toHaveValue("");
  await expect(page.getByText(/refreshing Datahike for every query may issue S3 GETs/iu)).toBeVisible();
  const initialFreshness = await atLeastDate.inputValue();
  await page.getByRole("button", { name: "Refresh Snapshot" }).click();
  await expect(atLeastDate).not.toHaveValue(initialFreshness);
  const refreshedBasisCapturedAt = await page.getByLabel("Current selected basis").locator("time").getAttribute("datetime");
  await expect.poll(() => apiRequests.filter(({ input }) =>
    input.consistency === "at-least"
    && input.atLeastAsFreshBasisCapturedAt === refreshedBasisCapturedAt
    && input.atLeastAsFreshAs === refreshedBasisCapturedAt
  ).length).toBeGreaterThan(0);
  await expect(page.getByText("Consistency Semantics:", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/EACL v8 \+/iu)).toHaveCount(0);
  await expect(page.getByText("Spice Schema", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Subjects", exact: true })).toBeVisible();
  await expect(page.getByText("Active subject", { exact: true })).toHaveCount(0);
  await expect(page.locator(".subjects-panel").getByText("Permission", { exact: true })).toHaveCount(0);
  await expect(page.locator(".resources-panel").getByText("Permission", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "open source" })).toHaveAttribute("href", "https://github.com/theronic/eacl");
  await expect(page.getByRole("link", { name: "Petrus Theron" })).toHaveAttribute("href", "https://petrustheron.com/");
  const eaclVersion = page.locator(".app-footer__version");
  await expect(eaclVersion).toContainText(`EACL library Git SHA: ${identity.eaclSha}`);
  await expect(eaclVersion.getByRole("link")).toHaveAttribute(
    "href",
    `https://github.com/theronic/eacl/commit/${identity.eaclSha}`,
  );
  await expect(page.getByText(/independent profile status records/u)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Verified profile facts" })).toHaveCount(0);
  await expect(page.locator(".profile-status, .metadata-list")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "User 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Schema/u })).toBeVisible();
  const cacheButton = page.getByRole("button", { name: "Cache", exact: true });
  expect(apiRequests.filter(({ operation }) => operation === "get-cache-info")).toHaveLength(0);
  await cacheButton.click();
  await expect.poll(() => apiRequests.filter(({ operation }) => operation === "get-cache-info").length).toBe(1);
  await expect(page.locator(".cache-metrics__code")).toContainText('"exact-hits": 9');
  await expect(page.locator(".cache-metrics__code")).toContainText('"lookup-resources"');
  await cacheButton.click();
  await cacheButton.click();
  await page.waitForTimeout(100);
  expect(apiRequests.filter(({ operation }) => operation === "get-cache-info")).toHaveLength(1);
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
  const canFooter = page.getByLabel("Arbitrary EACL permission check");
  await expect(canFooter).toBeVisible();
  await expect(canFooter.getByLabel("can? subject type")).toHaveValue("user");
  await expect(canFooter.getByLabel("can? subject ID")).toHaveValue("user-1");
  await expect(canFooter.getByLabel("can? resource type")).toHaveValue("server");
  await expect(canFooter.getByLabel("can? resource ID")).toHaveValue("server-1");
  await expect(canFooter.getByLabel("can? permission")).toHaveValue("view");
  await expect(canFooter).toContainText("=> true");
  const canRequestsBefore = apiRequests.filter(({ operation }) => operation === "check-permission").length;
  await canFooter.getByRole("button", { name: "Query" }).click();
  await expect.poll(() => apiRequests.filter(({ operation }) => operation === "check-permission").length)
    .toBeGreaterThan(canRequestsBefore);
  const atLeastRequests = apiRequests.filter(({ input }) => input.consistency === "at-least");
  expect(atLeastRequests.length).toBeGreaterThan(0);
  expect(atLeastRequests.every(({ input }) =>
    input.atLeastAsFreshBasisId === basis.id
    && typeof input.atLeastAsFreshAs === "string"
    && typeof input.atLeastAsFreshBasisCapturedAt === "string"
    && new Date(String(input.atLeastAsFreshAs)).getTime()
      <= new Date(String(input.atLeastAsFreshBasisCapturedAt)).getTime()
  )).toBe(true);
  const serverGroup = page.locator('[id="resource-type:server-content"]');
  await serverGroup.getByRole("button", { name: "Next" }).click();
  await expect(serverGroup.getByText("Page 2", { exact: true })).toBeVisible();
  const cacheEnabled = page.getByRole("switch", { name: /Cache Enabled/iu });
  const cacheWasEnabled = await cacheEnabled.isChecked();
  await cacheEnabled.click();
  await expect(serverGroup.getByText("Page 2", { exact: true })).toBeVisible();
  await expect.poll(() => {
    const latest = apiRequests.filter(({ operation }) => operation === "lookup-resources").at(-1);
    return { cursor: latest?.input.cursor, cache: latest?.input.cache };
  }).toEqual({ cursor: "resources-page-2", cache: !cacheWasEnabled });
  expect(apiRequests.map(({ operation }) => operation)).toEqual(expect.arrayContaining(["health", "bootstrap", "list-subjects", "get-schema", "lookup-resources", "count-resources", "check-permission", "lookup-subjects"]));
  expect(apiRequests.every(({ requestId }) => /^browser-|^[0-9]+-[0-9]+$/u.test(requestId ?? ""))).toBe(true);
  expect(apiRequests.every(({ origin }) => origin === "https://nkpogjjpx5wyb4imujlrefedqu0qpqwu.lambda-url.us-east-1.on.aws")).toBe(true);
  expect(apiRequests.every(({ payloadHash }) => payloadHash === null)).toBe(true);
});
