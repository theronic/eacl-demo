import { test, expect } from "@playwright/test";
import { installPublications } from "./fixture";
test.beforeEach(async ({ page }) => {
  await installPublications(page);
  await page.goto("http://127.0.0.1:4174/");
  await expect(
    page.getByRole("button", { name: "Seed Data", exact: true }),
  ).toBeEnabled();
});
test("resource-first selection, counts, cache, typed picker and pagination", async ({
  page,
}) => {
  await expect(
    page.getByRole("spinbutton", { name: "Additional resources" }),
  ).toHaveValue("10000");
  await expect(page.locator(".navbar-count").nth(1)).toContainText("38,613");
  const servers = page
    .locator(".group-card")
    .filter({
      has: page.getByRole("button", {
        name: "server type Servers",
        exact: true,
      }),
    });
  await expect(servers.locator(".resource-button")).toHaveCount(20);
  await page
    .getByRole("button", {
      name: "server type account-0-server-0",
      exact: true,
    })
    .click();
  await expect(page.locator(".detail-header__id")).toHaveText(
    "account-0-server-0",
  );
  const reverseNext = page
    .locator(".permission-subjects")
    .getByRole("button", { name: "Next", exact: true });
  await expect(reverseNext).toBeEnabled();
  await reverseNext.scrollIntoViewIfNeeded();
  const before = await reverseNext.boundingBox();
  await reverseNext.click();
  await expect(page.locator(".reverse-result")).toContainText("6–6");
  const after = await reverseNext.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.y).toBeCloseTo(before!.y, 0);
  await page.getByRole("radio", { name: "admin", exact: true }).first().check();
  await page
    .getByRole("checkbox", { name: "Read Cache", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Populate Cache", exact: true })
    .uncheck();
  await expect(page.locator(".detail-header__id")).toHaveText(
    "account-0-server-0",
  );
  await page.getByRole("radio", { name: "view", exact: true }).first().check();
  await expect(servers.locator(".group-card__range")).toHaveText("1–20");
  await servers
    .getByRole("button", { name: "Next", exact: true })
    .scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => scrollY);
  await servers.getByRole("button", { name: "Next", exact: true }).click();
  await expect(servers.locator(".group-card__range")).toHaveText("21–40");
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(scrollBefore, 0);
  await servers.getByRole("button", { name: "Prev", exact: true }).click();
  await expect(servers.locator(".group-card__range")).toHaveText("1–20");
  await page
    .getByRole("combobox", { name: "Page size", exact: true })
    .selectOption("25");
  await expect(servers.locator(".resource-button")).toHaveCount(25);
  await page
    .getByRole("button", { name: "View As user-1", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Subject Type", exact: true })
    .selectOption("account");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "account type account-0", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View As account-0", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".group-card__range").first()).toHaveText("0–0");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("checker inputs retain independence and clear stale results", async ({
  page,
}) => {
  const toggle = page.locator(".checker-heading");
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  await page
    .getByRole("combobox", { name: "can? subject ID", exact: true })
    .fill("user-2");
  await expect(page.locator(".can-permission-footer__decision")).toContainText(
    "false",
  );
  await page
    .getByRole("combobox", { name: "can? subject ID", exact: true })
    .fill("");
  await expect(
    page.locator(".can-permission-footer__decision"),
  ).not.toContainText("false");
  await expect(
    page.getByRole("button", { name: "Check Permission", exact: true }),
  ).toBeDisabled();
  await toggle.click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("connected light and dark layouts remain accessible", async ({
  page,
}, testInfo) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: `target/verification/design-${testInfo.project.name}-${theme}.png`,
      fullPage: true,
    });
  }
});
