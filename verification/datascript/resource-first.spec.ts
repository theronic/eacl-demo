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
  const servers = page.locator(".group-card").filter({
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
  // Center the target above the floating checker before measuring a user click.
  await servers
    .getByRole("button", { name: "Next", exact: true })
    .evaluate((element) => element.scrollIntoView({ block: "center" }));
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
    "Denied",
  );
  await page
    .getByRole("combobox", { name: "can? subject ID", exact: true })
    .fill("");
  await expect(
    page.locator(".can-permission-footer__decision"),
  ).not.toContainText("Denied");
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

test("startup and ready states share the header and nested tree indentation", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/registry/profiles/*.json", async (route) => {
    await held;
    await route.fallback();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-title")).toHaveText("🦅 EACL Explorer");
  const subtitle = await page.locator(".app-subtitle").textContent();
  expect(subtitle).toContain("is a situated");
  const font = await page
    .locator(".app-shell")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).not.toMatch(/Space Grotesk|IBM Plex/i);
  release();
  await expect(
    page.getByRole("button", { name: "Seed Data", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".app-subtitle")).toHaveText(subtitle!);
  expect(
    await page
      .locator(".app-shell")
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toBe(font);
  const node = page
    .locator(".resource-node")
    .filter({
      has: page.getByRole("button", {
        name: "server type account-0-server-0",
        exact: true,
      }),
    })
    .first();
  await node
    .locator(":scope > .resource-node__row > .resource-node__toggle")
    .click();
  const child = node.locator(":scope > .resource-node__children");
  await expect(child).toBeVisible();
  const parentBox = await node.boundingBox();
  const childBox = await child.boundingBox();
  expect(childBox!.x - parentBox!.x).toBeGreaterThanOrEqual(22);
});

test("sibling disclosures do not issue unrelated EACL queries", async ({
  page,
}) => {
  await page
    .getByRole("button", {
      name: "server type account-0-server-0",
      exact: true,
    })
    .click();
  await expect(page.locator(".reverse-result")).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    w.__queryCalls = [];
    const runtime = w.EaclDataScriptRuntime;
    const original = runtime.request;
    runtime.request = function (
      operation: string,
      input: unknown,
      ...rest: unknown[]
    ) {
      w.__queryCalls.push({ operation, input });
      return original.call(this, operation, input, ...rest);
    };
  });
  await page
    .getByRole("button", { name: "Expand account-0-server-0", exact: true })
    .click();
  await page
    .locator(
      '.resource-tree > .resource-node > .resource-node__row > button[aria-label="Expand account-0-server-1"]',
    )
    .click();
  await page
    .getByRole("button", { name: "Collapse account-0-server-1", exact: true })
    .click();
  // Allow scheduled resource effects to settle; no network or cache call is expected.
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as any).__queryCalls)).toEqual([]);
  const relation = page
    .locator(".relationship-group")
    .filter({ hasText: "via :parent" })
    .first();
  await relation.locator("button[aria-expanded]").first().click();
  await expect(relation.locator(".cache-timing")).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__queryCalls);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.map((call: any) => call.operation)).toContain(
    "reverse-relationships",
  );
  expect(
    calls.every((call: any) =>
      ["reverse-relationships"].includes(call.operation),
    ),
  ).toBe(true);
  await page.evaluate(() => {
    (window as any).__queryCalls = [];
  });
  await page
    .locator(
      '.resource-tree > .resource-node > .resource-node__row > button[aria-label="Expand account-0-server-1"]',
    )
    .click();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => (window as any).__queryCalls)).toEqual([]);
});

test("approved disclosure, stable type rows, checker labels and explicit tree refresh", async ({page}) => {
  const servers = page.locator('.group-card').filter({has:page.getByRole('button',{name:'server type Servers',exact:true})});
  await expect(servers.locator('.resource-button')).toHaveCount(20);
  const heading=servers.locator('.group-card__header');
  const height=await heading.evaluate(e=>e.getBoundingClientRect().height);
  await servers.getByRole('button',{name:'server type Servers',exact:true}).click();
  expect(await heading.evaluate(e=>e.getBoundingClientRect().height)).toBe(height);
  // The right-hand padding belongs to the type row, not just its text label.
  await heading.click({position:{x:(await heading.boundingBox())!.width-3,y:3}});
  await expect(servers.locator('.resource-button')).toHaveCount(20);
  expect(await heading.evaluate(e=>e.getBoundingClientRect().height)).toBe(height);
  await expect(servers.locator('.group-card__caret svg rect')).toHaveAttribute('rx','3');
  await page.getByRole('button',{name:'Expand account-0-server-0',exact:true}).click();
  const relation=servers.locator('.relationship-group').filter({hasText:'via :parent'}).first();
  await relation.locator('button[aria-expanded]').first().click();
  await expect(relation.locator('.cache-timing')).toBeVisible();
  await page.evaluate(()=>{const w=window as any;w.__refreshCalls=[];const r=w.EaclDataScriptRuntime;const original=r.request;r.request=function(operation:string,input:any,...rest:any[]){w.__refreshCalls.push({operation,input});return original.call(r,operation,input,...rest)}});
  await page.getByRole('button',{name:'Re-query',exact:true}).click();
  await expect.poll(async()=>page.evaluate(()=>(window as any).__refreshCalls.filter((c:any)=>c.operation==='lookup-resources').map((c:any)=>c.input.resourceType))).toEqual(expect.arrayContaining(['account','server']));
  await expect.poll(async()=>page.evaluate(()=>(window as any).__refreshCalls.map((c:any)=>c.operation))).toEqual(expect.arrayContaining(['count-resources','reverse-relationships']));
  const footer=page.locator('.can-permission-footer');
  if(await footer.getByRole('button',{name:'Toggle Check Permission'}).getAttribute('aria-expanded')==='false') await footer.getByRole('button',{name:'Toggle Check Permission'}).click();
  await expect(footer.locator('label').filter({hasText:'Subject ID'})).toBeVisible();
  await expect(footer.locator('label').filter({hasText:'Resource ID'})).toBeVisible();
  await expect(footer.locator('.can-permission-footer__decision')).toContainText('Allowed');
  const decision=await footer.locator('.can-permission-footer__decision').boundingBox();
  const header=await footer.locator('.checker-header').boundingBox();
  expect(decision!.x+decision!.width).toBeCloseTo(header!.x+header!.width,0);
});

test("platform accounts use one authorized relationship read per page, without per-account checks", async ({page}) => {
  await page.getByRole('button',{name:'View As user-1',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Super user',exact:true}).click();
  await page.getByRole('combobox',{name:'Page size',exact:true}).selectOption('5');
  await page.getByRole('button',{name:'platform type Platforms',exact:true}).click();
  await page.getByRole('button',{name:'Expand platform',exact:true}).click();
  const accounts=page.locator('.relationship-group').filter({hasText:'Accounts via :platform'}).first();
  await page.waitForTimeout(250);
  await page.evaluate(()=>{const w=window as any;w.__branchCalls=[];const r=w.EaclDataScriptRuntime;const original=r.request;r.request=function(operation:string,input:any,...rest:any[]){w.__branchCalls.push({operation,input});return original.call(r,operation,input,...rest)}});
  await accounts.locator('button[aria-expanded]').first().click();
  await expect(accounts.locator('.resource-button')).toHaveCount(5);
  const calls=await page.evaluate(()=>(window as any).__branchCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({operation:'reverse-relationships',input:{authorizationSubjectId:'super-user',resourceType:'account',subjectType:'platform',subjectId:'platform',relation:'platform'}});
  const firstIds=await accounts.locator('.resource-caption__id').allTextContents();
  await page.evaluate(()=>(window as any).__branchCalls=[]);
  await accounts.getByRole('button',{name:'Next',exact:true}).click();
  await expect.poll(async()=>accounts.locator('.resource-caption__id').allTextContents()).not.toEqual(firstIds);
  const nextCalls=await page.evaluate(()=>(window as any).__branchCalls);
  expect(nextCalls).toHaveLength(1);
  expect(nextCalls[0].operation).toBe('reverse-relationships');
  expect(nextCalls[0].input.cursor).toBeTruthy();
});
