import { expect, test } from "@playwright/test";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createProfilePublication } from "../../packages/explorer-state/src/profile-publication.mjs";

const readJson = (url: string) => readFile(new URL(url, import.meta.url), "utf8").then(JSON.parse);
const [baseRegistry, profileDefinitions, artifact] = await Promise.all([
  readJson("../../registry/profile-registry.v1.json"),
  readJson("../../packages/contracts/profiles.v1.json"),
  readJson("../../dist/datascript-worker/artifact.json")
]);
const demoSha = "a".repeat(40);
const dataManifestSha256 = "b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a";

test("fixture initialization and authorization stay in the browser worker", async ({ page }) => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
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
  await page.route("**/registry/profiles/datascript-browser-memory.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(publication) }));

  await page.goto(process.env.EACL_DATASCRIPT_URL ?? "http://127.0.0.1:4174/datascript/");
  await expect(page.getByRole("heading", { name: "Read basis" })).toBeVisible({ timeout: 60_000 });
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
      schema: await request("get-schema", {})
    };
  });
  expect(defaults.object).toMatchObject({ ok: true, data: { object: { type: "account", id: "account-0" } } });
  expect(defaults.subjects).toMatchObject({ ok: true, data: { pageInfo: { pageSize: 25, hasNextPage: true } } });
  expect(defaults.subjects.data.items).toHaveLength(25);
  expect(defaults.count).toMatchObject({ ok: true, data: { kind: "objects", value: 1_000, exact: false, ceiling: 1_000 } });
  expect(defaults.schema).toMatchObject({ ok: true });

  requests.length = 0;
  await expect(page.getByRole("heading", { name: "Subjects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Schema" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cache" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Subjects", exact: true }).locator(".object-list")).toBeVisible();
  await page.getByLabel("Resource type").fill("account");
  await page.getByLabel("Resource ID").fill("account-0");
  await page.getByRole("button", { name: "Open object" }).click();
  await expect(page.getByRole("heading", { name: "account-0" })).toBeVisible();
  await page.getByRole("textbox", { name: "Relation", exact: true }).fill("owner");
  await page.getByRole("button", { name: "Load outbound" }).click();
  await expect(page.locator(".relationship-list")).toContainText("user/user-1");
  await expect(page.getByRole("navigation", { name: "Outbound relationships pagination" })).toBeVisible();
  await page.getByRole("textbox", { name: "Subject type", exact: true }).fill("user");
  await page.getByRole("textbox", { name: "Subject ID", exact: true }).fill("user-1");
  await page.getByRole("button", { name: "Load reverse" }).click();
  await expect(page.getByRole("region", { name: "Relationships", exact: true }).locator(".object-list")).toContainText("account-0");
  await expect(page.getByRole("navigation", { name: "Reverse relationships pagination" })).toBeVisible();
  await page.getByRole("textbox", { name: "Permission", exact: true }).fill("admin");
  await page.getByRole("button", { name: "Check permission" }).click();
  await expect(page.getByRole("heading", { name: "admin: Allowed" })).toBeVisible();
  await page.getByRole("textbox", { name: "Subject ID", exact: true }).fill("user-2");
  await page.getByRole("button", { name: "Check permission" }).click();
  await expect(page.getByRole("heading", { name: "admin: Denied" })).toBeVisible();

  expect(requests).toEqual([]);
});
