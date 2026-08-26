import { expect, test } from "@playwright/test";

test("the main server-profile entry does not load DataScript assets", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(process.env.EACL_MAIN_URL ?? "http://127.0.0.1:4175/");
  await expect(page.getByRole("heading", { name: /EACL Explorer/u })).toBeVisible();

  const loadedResources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
  for (const url of [...requests, ...loadedResources]) {
    expect(url).not.toMatch(/\/datascript\//u);
    expect(url).not.toMatch(/datascript-worker|EaclKernel\.browser/iu);
  }
});
