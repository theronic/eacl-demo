import { expect, test, type Page } from "@playwright/test";
import { installPublications, artifact } from "./fixture";
import { mkdir, writeFile } from "node:fs/promises";
const addedResource = { type: "server", id: "local-server-999" };

const base = "http://127.0.0.1:4174/";
async function request(page: Page, operation: string, input: Record<string, unknown> = {}) {
  return page.evaluate(({ operation, input }) => (window as any).EaclDataScriptRuntime.request(operation, input, crypto.randomUUID()), { operation, input });
}
async function ready(page: Page) {
  await expect(page.getByRole("button", { name: "Seed Data", exact: true })).toBeEnabled({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => { await installPublications(page); });

test("root restores once, seeds additively, invalidates cursors, and refreshes the explorer", async ({ page }) => {
  const documents: string[] = [];
  const requests: string[] = [];
  page.on("request", r => { requests.push(r.url()); if (r.isNavigationRequest()) documents.push(r.url()); });
  await page.goto(base);
  await ready(page);
  expect(new URL(page.url()).pathname).toBe("/");
  expect(documents).toHaveLength(1);
  const before = (await request(page, "bootstrap")).data;
  expect(before.dataset.logicalResourceCount).toBe(10000);
  const cursor = (await request(page, "list-subjects", { pageSize: 1 })).data.pageInfo.endCursor;
  for (const [count, total] of [[1000,11000], [500,11500]]) {
    await page.getByRole("spinbutton", { name: "Additional resources" }).fill(String(count));
    await page.getByRole("button", { name: "Seed Data", exact: true }).click();
    await expect(page.locator(".navbar-count").first()).toContainText(total.toLocaleString("en-US"), { timeout: 30_000 });
    await ready(page);
  }
  const after = (await request(page, "bootstrap")).data;
  expect(after.identity).toEqual(before.identity);
  expect(after.dataset.logicalResourceCount).toBe(11500);
  expect(after.localSeed.modified).toBe(true);
  expect(after.basis.id).not.toBe(before.basis.id);
  expect((await request(page, "list-subjects", { pageSize: 1, cursor })).error.code).toBe("cursor-invalid");
  expect((await request(page, "count-objects", { kind: "objects", ceiling: 100000 })).data.value).toBe(11500);
  await expect(page.locator(".navbar-count").first()).toContainText("11,500");
  expect((await request(page, "get-object", addedResource)).data.object).toMatchObject(addedResource);
  expect((await request(page, "check-permission", {
    subjectType: "user", subjectId: "super-user", resourceType: addedResource.type,
    resourceId: addedResource.id, permission: "admin",
  })).data.allowed).toBe(true);
  for (const count of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect((await request(page, "seed-start", { resourceCount: count })).error.code).toBe("validation-error");
  expect((await request(page, "bootstrap")).data.dataset.logicalResourceCount).toBe(11500);
  expect(requests.filter(url => url.includes(`/datascript/assets/datascript-runtime-${artifact.artifact.sha256}.js`))).toHaveLength(1);
  expect(requests.filter(url => /lambda-url|\/api\//.test(url))).toEqual([]);
});

test("legacy links and history switch within the document, resetting released data", async ({ page }) => {
  let documents = 0;
  page.on("request", r => { if (r.isNavigationRequest()) documents++; });
  await page.goto(`${base}datascript/?backend=datascript&storage=browser-memory&platform=browser&permission=view`);
  await ready(page);
  expect(new URL(page.url()).pathname).toBe("/");
  expect(new URL(page.url()).searchParams.get("permission")).toBe("view");
  await page.getByRole("radio", { name: "Datahike", exact: true }).check();
  await expect(page.getByRole("button", { name: "Seed Data", exact: true })).toHaveCount(0);
  await page.goBack();
  await ready(page);
  expect((await request(page, "bootstrap")).data.dataset.logicalResourceCount).toBe(10000);
  await page.goForward();
  await expect(page.getByRole("radio", { name: "Datahike", exact: true })).toBeChecked();
  expect(documents).toBe(1);
});

test("a failed download retries and switching during a delayed download ignores completion", async ({ page }) => {
  let attempts = 0;
  await page.route("**/datascript/assets/*.js", async route => {
    if (++attempts === 1) await route.abort(); else await route.continue();
  });
  await page.goto(base);
  await expect(page.getByText("DataScript startup failed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await ready(page);
  expect(attempts).toBe(2);
});

test("switching while the runtime downloads leaves no abandoned initialized session", async ({ page }) => {
  let resume!: () => void;
  const held = new Promise<void>(resolve => { resume = resolve; });
  await page.route("**/datascript/assets/*.js", async route => { await held; await route.continue(); });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Loading DataScript/).first()).toBeVisible();
  await page.getByRole("radio", { name: "Datahike", exact: true }).check();
  resume();
  await page.waitForFunction(() => Boolean((window as any).EaclDataScriptRuntime));
  await expect(page.getByRole("radio", { name: "Datahike", exact: true })).toBeChecked();
  const uninitialized = await page.evaluate(async () => {
    try { await (window as any).EaclDataScriptRuntime.request("bootstrap", {}, "abandoned"); return false; } catch { return true; }
  });
  expect(uninitialized).toBe(true);
  await page.getByRole("radio", { name: "DataScript", exact: true }).check();
  await ready(page);
});

test("partial batch failure resumes only remaining additions; overlapping jobs are rejected", async ({ page }) => {
  await page.goto(base);
  await ready(page);
  const result = await page.evaluate(async () => {
    const runtime = (window as any).EaclDataScriptRuntime;
    let sequence = 0;
    const call = (operation: string, input: object = {}) => runtime.request(operation, input, `failure-${++sequence}`);
    const initial = await call("seed-start", { resourceCount: 1500 });
    const overlapping = await call("seed-start", { resourceCount: 1 });
    // Fail the next client/key creation after at least one committed batch.
    let progress;
    do { await new Promise(r => setTimeout(r, 0)); progress = await call("seed-status"); } while (progress.data.resourcesCompleted === 0);
    const original = crypto.randomUUID;
    crypto.randomUUID = () => { throw new Error("Qualification entropy failure"); };
    let failure;
    try {
      do { await new Promise(r => setTimeout(r, 0)); failure = await call("seed-status"); } while (failure.data.status === "seeding");
    } finally { crypto.randomUUID = original; }
    const retry = await call("seed-retry");
    let final;
    do { await new Promise(r => setTimeout(r, 0)); final = await call("seed-status"); } while (final.data.status === "seeding");
    return { initial, overlapping, failure, retry, final, count: await call("count-objects", { kind: "objects", ceiling: 100000 }) };
  });
  expect(result.overlapping.error.code).toBe("validation-error");
  expect(result.failure.data.status).toBe("error");
  expect(result.failure.data.resourcesCompleted).toBeGreaterThan(0);
  expect(result.failure.data.resourcesCompleted).toBeLessThan(1500);
  expect(result.final.data.totalResources).toBe(11500);
  expect(result.count.data.value).toBe(11500);
});

test("seeding exceeds the former cap with event-loop yields and stops on release", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.on("console", message => { if (message.text().startsWith("SEED-MEASURE")) console.log(message.text()); });
  await page.goto(base);
  await ready(page);
  const measurement = await page.evaluate(async () => {
    const runtime = (window as any).EaclDataScriptRuntime;
    const call = (operation: string, input: object = {}) => runtime.request(operation, input, crypto.randomUUID());
    let ticks = 0, maxGap = 0, last = performance.now();
    const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now-last); last=now; ticks++; }, 16);
    const start = performance.now();
    await call("seed-start", { resourceCount: 100001 });
    let result, logged = 0;
    do {
      await new Promise(r => setTimeout(r, 50)); result = await call("seed-status");
      if (performance.now() - logged > 10000) { logged = performance.now(); console.log("SEED-MEASURE", result.data.totalResources, maxGap); }
    } while (result.data.status === "seeding");
    clearInterval(timer);
    return { elapsedMs: performance.now()-start, ticks, maxGap, result, count: await call("count-objects", { kind: "objects", ceiling: 1000000 }) };
  });
  expect(measurement.result.data.status).toBe("ready");
  expect(measurement.result.data.totalResources).toBe(110001);
  expect(measurement.count.data.value).toBe(110001);
  expect(measurement.ticks).toBeGreaterThan(10);
  expect(measurement.maxGap).toBeLessThan(500);
  const evidence = { artifactSha256: artifact.artifact.sha256, eaclCoreSha: artifact.eaclCoreSha, project: testInfo.project.name, measuredAt: new Date().toISOString(), ...measurement };
  await testInfo.attach("datascript-cap-responsiveness.json", { body: JSON.stringify(evidence), contentType: "application/json" });
  const directory = new URL("../../target/verification/datascript/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`cap-${testInfo.project.name}.json`, directory), JSON.stringify(evidence, null, 2) + "\n");
  await page.getByRole("radio", { name: "Datahike", exact: true }).check();
  await page.getByRole("radio", { name: "DataScript", exact: true }).check();
  await ready(page);
  await request(page, "seed-start", { resourceCount: 100001 });
  await page.getByRole("radio", { name: "Datahike", exact: true }).check();
  await page.getByRole("radio", { name: "DataScript", exact: true }).check();
  await ready(page);
  expect((await request(page, "bootstrap")).data.dataset.logicalResourceCount).toBe(10000);
});

test("old initialization and release cannot replace a new session; invalid identity is rejected", async ({ page }) => {
  await page.goto(base);
  await ready(page);
  const result = await page.evaluate(async () => {
    const runtime = (window as any).EaclDataScriptRuntime;
    const identity = (await runtime.request("bootstrap", {}, "identity")).data.identity;
    await runtime.initialize(identity, "old-session");
    const old = runtime.request("bootstrap", {}, "old-request", "old-session");
    runtime.release("old-session");
    await runtime.initialize(identity, "new-session");
    const staleRelease = runtime.release("old-session");
    const fresh = await runtime.request("bootstrap", {}, "fresh-request", "new-session");
    const stale = await old;
    let rejected = false;
    try { await runtime.initialize({ ...identity, eaclSha: "f".repeat(40) }, "invalid"); } catch { rejected = true; }
    const current = await runtime.request("bootstrap", {}, "current-request", "new-session");
    return { staleRelease, fresh, stale, rejected, current };
  });
  expect(result.staleRelease).toBe(false);
  expect(result.stale.error).toBeTruthy();
  expect(result.fresh.data.dataset.logicalResourceCount).toBe(10000);
  expect(result.current.data.basis.id).toBe(result.fresh.data.basis.id);
  expect(result.rejected).toBe(true);
});

test("the shared seed controls show partial failure and retry the remaining resources", async ({ page }) => {
  await page.goto(base);
  await ready(page);
  // Inject after the first commit and keep the fault active until a batch
  // fails; UI request IDs may also consume entropy between batch callbacks.
  await page.getByRole("spinbutton", { name: "Additional resources" }).fill("1500");
  await page.evaluate(() => {
    const runtime = (window as any).EaclDataScriptRuntime;
    const originalRequest = runtime.request;
    runtime.request = function (...args: any[]) {
      const result = originalRequest.apply(runtime, args);
      if (args[0] === "seed-start") {
        runtime.request = originalRequest;
        (window as any).__injectedFailure = (async () => {
          let progress;
          do {
            await new Promise(r => setTimeout(r, 0));
            progress = await originalRequest.call(runtime, "seed-status", {}, "injection-status");
          } while (progress.data.resourcesCompleted === 0);
          const original = crypto.randomUUID;
          crypto.randomUUID = () => { throw new Error("Injected batch failure"); };
          try {
            do {
              await new Promise(r => setTimeout(r, 0));
              progress = await originalRequest.call(runtime, "seed-status", {}, "injection-status");
            } while (progress.data.status === "seeding");
            return progress.data;
          } finally { crypto.randomUUID = original; }
        })();
      }
      return result;
    };
  });
  await page.getByRole("button", { name: "Seed Data", exact: true }).click();
  const failed = await page.evaluate(() => (window as any).__injectedFailure);
  await expect(page.getByText("Seeding failed", { exact: true })).toBeVisible();
  expect(failed.status).toBe("error");
  expect(failed.resourcesCompleted).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("11,500 resources", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect((await request(page, "count-objects", { kind: "objects", ceiling: 100000 })).data.value).toBe(11500);
});
