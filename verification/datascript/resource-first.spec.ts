import { test, expect } from "@playwright/test";
import { installPublications } from "./fixture";
test.beforeEach(async ({ page }) => {
  await installPublications(page);
  await page.goto(process.env.EACL_DATASCRIPT_URL?.trim() || "http://127.0.0.1:4174/");
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

test("platform accounts use one direct relationship read per page, without per-account checks", async ({page}) => {
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
  expect(calls[0]).toMatchObject({operation:'reverse-relationships',input:{resourceType:'account',subjectType:'platform',subjectId:'platform',relation:'platform'}});
  expect(calls[0].input).not.toHaveProperty('authorizationSubjectId');
  expect(calls[0].input).not.toHaveProperty('permission');
  const firstIds=await accounts.locator('.resource-caption__id').allTextContents();
  await page.evaluate(()=>(window as any).__branchCalls=[]);
  await accounts.getByRole('button',{name:'Next',exact:true}).click();
  await expect.poll(async()=>accounts.locator('.resource-caption__id').allTextContents()).not.toEqual(firstIds);
  const nextCalls=await page.evaluate(()=>(window as any).__branchCalls);
  expect(nextCalls).toHaveLength(1);
  expect(nextCalls[0].operation).toBe('reverse-relationships');
  expect(nextCalls[0].input.cursor).toBeTruthy();
  await page.evaluate(()=>(window as any).__branchCalls=[]);
  await page.getByRole('radio',{name:'admin',exact:true}).first().check();
  await expect.poll(async()=>page.evaluate(()=>(window as any).__branchCalls.some((call:any)=>call.operation==='lookup-resources'))).toBe(true);
  await page.waitForTimeout(250);
  expect(await page.evaluate(()=>(window as any).__branchCalls.filter((call:any)=>call.operation==='reverse-relationships'))).toEqual([]);
  await expect(accounts).toHaveCount(0); // Platforms has no admin permission.
});

test("changing permission retains an unchanged direct branch and its page", async ({page}) => {
  await page.getByRole('button',{name:'Expand account-0-server-0',exact:true}).click();
  const branch=page.locator('.relationship-group').filter({hasText:'via :parent'}).first();
  await branch.locator('button[aria-expanded]').first().click();
  await expect(branch.locator('.cache-timing')).toBeVisible();
  await page.evaluate(()=>{const w=window as any; w.__directCalls=[]; const r=w.EaclDataScriptRuntime; const original=r.request; r.request=function(operation:string,input:any,...rest:any[]){w.__directCalls.push({operation,input}); return original.call(r,operation,input,...rest)}});
  await page.getByRole('radio',{name:'admin',exact:true}).first().check();
  await expect.poll(async()=>page.evaluate(()=>(window as any).__directCalls.some((c:any)=>c.operation==='count-resources'))).toBe(true);
  await expect(branch.locator('.cache-timing')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__directCalls.filter((c:any)=>c.operation==='reverse-relationships'))).toEqual([]);
  await page.getByRole('button',{name:'server type account-0-server-0',exact:true}).click();
  await page.evaluate(()=>(window as any).__directCalls=[]);
  await page.getByRole('button',{name:'View As user-1',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Super user',exact:true}).click();
  await expect.poll(async()=>page.evaluate(()=>(window as any).__directCalls.some((c:any)=>c.operation==='count-resources'))).toBe(true);
  await expect(branch.locator('.cache-timing')).toBeVisible();
  await expect(page.locator('.detail-header__id')).toHaveText('account-0-server-0');
  expect(await page.evaluate(()=>(window as any).__directCalls.filter((c:any)=>c.operation==='reverse-relationships'))).toEqual([]);
});

test("schema graph routes separate connections and preserves schema visibility", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "Permission Schema", exact: true }).click();
  await expect(page.locator("#schema-editor")).toBeVisible();
  expect((await page.locator("#schema-editor").boundingBox())!.height).toBeGreaterThanOrEqual(480);
  await expect(page.locator(".schema-flow")).toHaveCount(0);
  await page.getByRole("button", { name: "Schema Graph", exact: true }).click();
  await expect(page.locator("#schema-editor")).toBeHidden();
  const canvas = page.locator(".schema-flow-canvas");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".schema-flow-card--type")).toHaveCount(6);
  await expect(page.locator(".schema-flow-card--relation")).toHaveCount(0);
  await expect(page.locator(".schema-flow-edge")).toHaveCount(13);
  await expect(page.locator(".schema-flow-operator text")).toHaveCount(13);
  // Check the actual rendered geometry of both nodes and edge labels.
  const intersections = await canvas.evaluate(element => {
    const cards = [...element.querySelectorAll(".schema-flow-card, .schema-flow-operator rect")].map(card => card.getBoundingClientRect());
    return cards.flatMap((a, i) => cards.slice(i + 1).filter(b =>
      Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
      Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1,
    ));
  });
  expect(intersections).toHaveLength(0);
  const obscuredConnections = await canvas.evaluate(element => {
    const cards = [...element.querySelectorAll(".schema-flow-card, .schema-flow-operator rect")].map(card => card.getBoundingClientRect());
    return [...element.querySelectorAll<SVGPathElement>(".schema-flow-edge")].flatMap(path => {
      const values = (path.getAttribute("d") ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const points = [];
      for (let i = 0; i < values.length; i += 2) points.push(new DOMPoint(values[i], values[i + 1]).matrixTransform(path.getScreenCTM()!));
      return points.slice(1).flatMap((b, i) => {
        const a = points[i];
        return cards.filter(rect => Math.min(a.x, b.x) < rect.right - 1 && Math.max(a.x, b.x) > rect.left + 1 && Math.min(a.y, b.y) < rect.bottom - 1 && Math.max(a.y, b.y) > rect.top + 1);
      });
    });
  });
  expect(obscuredConnections).toHaveLength(0);
  await page.getByRole("combobox", { name: "Graph resource type" }).selectOption("server");
  await expect(page.locator(".schema-flow-edge")).toHaveCount(5);
  await page.getByRole("button", { name: "Permissions", exact: true }).click();
  await expect(page.locator(".schema-flow-caption code")).toHaveText("view = admin + parent->view + account->view + team->view + vpc->view + shared_admin");
  await expect(page.locator(".schema-flow-card strong").filter({ hasText: /^account->view$/ })).toHaveCount(1);
  await page.getByRole("combobox", { name: "Graph permission" }).selectOption("admin");
  await expect(page.locator(".schema-flow-caption code")).toHaveText("admin = account->admin + shared_admin");
  await expect(page.locator(".schema-flow-edge")).toHaveCount(2);
  await expect(page.locator(".schema-flow-operator text")).toHaveText(["+ union", "+ union"]);
  const permissionRoot = await page.locator(".schema-flow-card strong").filter({ hasText: /^server\.admin$/ }).boundingBox();
  const term = await page.locator(".schema-flow-card strong").filter({ hasText: /^account->admin$/ }).boundingBox();
  expect(permissionRoot!.x).toBeLessThan(term!.x);
  await page.getByRole("combobox", { name: "Graph resource type" }).selectOption("user");
  await expect(page.locator(".schema-flow-caption")).toHaveText("This type defines no permissions.");
  await page.getByRole("combobox", { name: "Graph resource type" }).selectOption("account");
  await expect(page.locator(".schema-flow-caption code")).toHaveText("admin = owner + parent->admin + platform->super_admin");
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await page.getByRole("button", { name: "Permission Schema", exact: true }).click();
  await expect(page.locator("#schema-editor")).toBeVisible();
  await expect(page.locator(".schema-flow")).toBeHidden();
  await page.getByRole("button", { name: "Schema Graph", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Graph resource type" })).toHaveValue("account");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const results = await new AxeBuilder({ page }).include(".schema-flow").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  }
  expect(errors).toEqual([]);
});


test("permission operators preserve traversal, grouping and repeated terms", async () => {
  const { expressionTerms } = await import("../../apps/explorer-main/src/schema-expression");
  expect(expressionTerms("admin + parent->view + (owner - blocked)")).toEqual([
    { operator: "+", term: "admin" }, { operator: "+", term: "parent->view" },
    { operator: "+", term: "(owner - blocked)" },
  ]);
  expect(expressionTerms("member & active").map(item => item.operator)).toEqual(["&", "&"]);
  expect(expressionTerms("admin")).toEqual([{ operator: "=", term: "admin" }]);
  expect(expressionTerms("a + b - c & (d + e) + parent->view + a")).toEqual([
    { operator: "=", term: "a" }, { operator: "+", term: "b" },
    { operator: "-", term: "c" }, { operator: "&", term: "(d + e)" },
    { operator: "+", term: "parent->view" }, { operator: "+", term: "a" },
  ]);
});

test("view links restore tabs and browser history without resetting graph inputs", async ({ page }) => {
  await page.getByRole("button", { name: "Schema Graph", exact: true }).click();
  await expect(page).toHaveURL(/view=graph/);
  await page.getByRole("combobox", { name: "Graph resource type" }).selectOption("account");
  await page.getByRole("button", { name: "Permission Schema", exact: true }).click();
  await expect(page).toHaveURL(/view=schema/);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Schema Graph", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Graph resource type" })).toHaveValue("account");
  await page.goForward();
  await expect(page.locator("#schema-editor")).toBeVisible();
  await page.reload();
  await expect(page.locator("#schema-editor")).toBeVisible();
  await page.goto("http://127.0.0.1:4174/?backend=datascript&storage=browser-memory&platform=browser&view=graph");
  await expect(page.locator(".schema-flow-canvas")).toBeVisible();
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Schema Graph", exact: true }).click();
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await expect(page).toHaveURL(/view=resources/);
  await page.goto("http://127.0.0.1:4174/?backend=datascript&storage=browser-memory&platform=browser&view=invalid");
  await expect(page.getByRole("button", { name: "Resources", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("graph source inspection and node dragging preserve definitions and connections", async ({ page }) => {
  await page.getByRole("button", { name: "Schema Graph", exact: true }).click();
  await expect(page.locator(".schema-flow-canvas")).toHaveAttribute("aria-busy", "false");
  const account = page.locator(".schema-flow-card").filter({ hasText: /^typeaccount/ });
  await account.focus();
  await account.press("Enter");
  const details = page.getByRole("complementary", { name: "Source Definition" });
  await expect(details).toContainText("definition account {");
  await expect(details).toContainText("Line 1");
  await page.getByRole("button", { name: "Close source details" }).click();
  const owner = page.getByRole("button", { name: "Show source for owner", exact: true });
  await owner.focus();
  await owner.press("Enter");
  await expect(details).toContainText("relation owner: user");
  await expect(details).not.toContainText("definition account {");
  await page.getByRole("button", { name: "Close source details" }).click();
  const server = page.getByRole("button", { name: "Show source for server", exact: true });
  await server.scrollIntoViewIfNeeded();
  const before = (await server.boundingBox())!;
  const oldPaths = await page.locator(".schema-flow-edge").evaluateAll(paths => paths.map(path => path.getAttribute("d")));
  await page.mouse.move(before.x + 35, before.y + 25);
  await page.mouse.down();
  await page.mouse.move(before.x + 65, before.y - 25, { steps: 12 });
  await page.mouse.up();
  const after = (await server.boundingBox())!;
  expect(Math.abs(after.x - before.x - 30)).toBeLessThan(5);
  expect(Math.abs(after.y - before.y + 50)).toBeLessThan(5);
  await expect(details).toBeHidden();
  const newPaths = await page.locator(".schema-flow-edge").evaluateAll(paths => paths.map(path => path.getAttribute("d")));
  expect(newPaths).not.toEqual(oldPaths);
  const sharedTrunks = await page.locator('.solid-flow__edge[aria-label^="Edge from type:server to"] .schema-flow-edge').evaluateAll(paths => {
    const segments = paths.flatMap((path, edge) => {
      const points = [...(path.getAttribute("d") ?? "").matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
      return points.slice(1).flatMap((b, i) => points[i].x === b.x ? [{ edge, x: b.x, min: Math.min(points[i].y, b.y), max: Math.max(points[i].y, b.y) }] : []);
    });
    return segments.flatMap((a, i) => segments.slice(i + 1).filter(b => a.edge !== b.edge && Math.abs(a.x - b.x) < 1 && Math.min(a.max, b.max) - Math.max(a.min, b.min) > 1));
  });
  expect(sharedTrunks).toHaveLength(0);
  await server.click();
  await expect(details).toContainText("definition server {");
  await page.getByRole("button", { name: "Close source details" }).click();
  await expect(page.locator(".schema-flow-edge")).toHaveCount(13);
  const position = await server.locator("..").getAttribute("style");
  await page.getByRole("button", { name: "Permission Schema", exact: true }).click();
  await page.getByRole("button", { name: "Schema Graph", exact: true }).click();
  expect(await server.locator("..").getAttribute("style")).toBe(position);
});

test("source definitions open an optional focused graph with relation and permission radios", async ({ page }) => {
  await page.getByRole("button", { name: "Permission Schema", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show Schema Graph", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".schema-flow")).toHaveCount(0);
  const source = await page.locator("#schema-editor").textContent();
  await page.getByRole("button", { name: "Focus server definition", exact: true }).click();
  const graph = page.getByRole("complementary", { name: "Focused Schema Graph" });
  await expect(graph).toBeVisible();
  await expect(graph.locator(".schema-flow-edge")).toHaveCount(5);
  await expect(graph.getByRole("radio", { name: "Relations", exact: true })).toBeChecked();
  await graph.getByRole("radio", { name: "Permissions", exact: true }).check();
  await expect(graph.locator(".schema-flow-caption code")).toContainText("view = admin + parent->view");
  await page.getByRole("button", { name: "Focus account definition", exact: true }).click();
  await expect(graph.locator(".schema-flow-caption code")).toHaveText("view = admin + parent->admin");
  await page.getByRole("button", { name: "Hide Schema Graph", exact: true }).click();
  await expect(graph).toBeHidden();
  expect(await page.locator("#schema-editor").textContent()).toBe(source);
  await page.getByRole("button", { name: "Show Schema Graph", exact: true }).click();
  await expect(graph.getByRole("radio", { name: "Permissions", exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const results = await new AxeBuilder({ page }).include(".schema-source-workspace").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  }
});

test("individual declarations focus the side graph and graph clicks control wheel zoom", async ({ page }) => {
  await page.getByRole("button", { name: "Permission Schema", exact: true }).click();
  await page.getByRole("button", { name: "Focus server relation account", exact: true }).click();
  const graph = page.getByRole("complementary", { name: "Focused Schema Graph" });
  await expect(graph.locator(".schema-flow-edge")).toHaveCount(1);
  await expect(graph.locator(".schema-flow-operator text")).toHaveText("account");
  await page.getByRole("button", { name: "Focus server permission admin", exact: true }).click();
  await expect(graph.getByRole("radio", { name: "Permissions", exact: true })).toBeChecked();
  await expect(graph.locator(".schema-flow-caption code")).toHaveText("admin = account->admin + shared_admin");
  await graph.getByRole("radio", { name: "Relations", exact: true }).check();
  await page.getByRole("button", { name: "Focus server permission admin", exact: true }).click();
  await expect(graph.getByRole("radio", { name: "Permissions", exact: true })).toBeChecked();
  const canvas = graph.locator(".schema-flow-canvas");
  await expect(canvas).toHaveAttribute("data-wheel-zoom", "false");
  await graph.getByRole("button", { name: "Show source for server.admin", exact: true }).click();
  await expect(graph.getByRole("complementary", { name: "Source Definition" })).toBeVisible();
  const pane = graph.locator(".solid-flow__pane");
  await pane.click({ position: { x: 5, y: 5 } });
  await expect(graph.getByRole("complementary", { name: "Source Definition" })).toBeHidden();
  await expect(canvas).toHaveAttribute("data-wheel-zoom", "true");
  const viewport = graph.locator(".solid-flow__viewport");
  const before = await viewport.getAttribute("style");
  await page.mouse.wheel(0, -150);
  await expect(viewport).not.toHaveAttribute("style", before!);
  await page.getByRole("button", { name: "Permission Schema", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-wheel-zoom", "false");
});

test("switching focused definitions reconnects platform to user through super_admin", async ({ page }) => {
  await page.getByRole("button", { name: "Permission Schema", exact: true }).click();
  const graph = page.getByRole("complementary", { name: "Focused Schema Graph" });
  for (const type of ["server", "account", "platform"]) {
    await page.getByRole("button", { name: `Focus ${type} definition`, exact: true }).click();
    await expect(graph.locator(".schema-flow-canvas")).toHaveAttribute("aria-busy", "false");
  }
  await expect(graph.locator(".schema-flow-edge")).toHaveCount(1);
  await expect(graph.locator(".solid-flow__edge")).toHaveAttribute("aria-label", "Edge from type:platform to type:user");
  await expect(graph.locator(".schema-flow-operator text")).toHaveText("super_admin");
  await expect.poll(() => graph.evaluate(element => {
    const path = element.querySelector<SVGPathElement>(".schema-flow-edge")!;
    const coords = (path.getAttribute("d") ?? "").match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const start = new DOMPoint(coords[0], coords[1]).matrixTransform(path.getScreenCTM()!);
    const end = new DOMPoint(coords.at(-2)!, coords.at(-1)!).matrixTransform(path.getScreenCTM()!);
    const source = element.querySelector('[data-id="type:platform"] .schema-flow-card')!.getBoundingClientRect();
    const target = element.querySelector('[data-id="type:user"] .schema-flow-card')!.getBoundingClientRect();
    return Math.abs(start.x - source.right) < 4 && Math.abs(end.x - target.left) < 4 && end.y >= target.top && end.y <= target.bottom;
  })).toBe(true);
  await graph.getByRole("radio", { name: "Permissions", exact: true }).check();
  await expect(graph.locator(".schema-flow-caption code")).toHaveText("view = super_admin");
  await graph.getByRole("radio", { name: "Relations", exact: true }).check();
  await expect(graph.locator(".solid-flow__edge")).toHaveAttribute("aria-label", "Edge from type:platform to type:user");
});

test("edge endpoints meet their handles after focus changes, dragging and zooming", async ({ page }) => {
  await page.getByRole("button", { name: "Schema Graph", exact: true }).click();
  const graph = page.locator(".schema-flow");
  const checkEndpoints = async () => {
    await expect.poll(() => graph.evaluate(root => {
      const handles = [...root.querySelectorAll("[data-handleid]")];
      const errors = [...root.querySelectorAll(".solid-flow__edge")].flatMap(edge => {
        const path = edge.querySelector<SVGPathElement>(".schema-flow-edge")!;
        const points = (path.getAttribute("d") ?? "").match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        return ["out", "in"].map((suffix, i) => {
          const handle = handles.find(handle => handle.getAttribute("data-handleid") === `${edge.getAttribute("data-id")}:${suffix}`);
          if (!handle) return Infinity;
          const bounds = handle.getBoundingClientRect();
          const point = new DOMPoint(i ? points.at(-2)! : points[0], i ? points.at(-1)! : points[1]).matrixTransform(path.getScreenCTM()!);
          return Math.hypot(point.x - bounds.x - bounds.width / 2, point.y - bounds.y - bounds.height / 2);
        });
      });
      return errors.length ? Math.max(...errors) : Infinity;
    })).toBeLessThan(1);
  };
  for (const type of ["server", "account", "platform", "server"]) {
    await graph.getByRole("combobox", { name: "Graph resource type" }).selectOption(type);
    await expect(graph.locator(".schema-flow-canvas")).toHaveAttribute("aria-busy", "false");
    await checkEndpoints();
  }
  await graph.getByRole("button", { name: "Fit Graph", exact: true }).click();
  for (const [type, dx, dy] of [["server", 15, -20], ["account", -15, 20]] as const) {
    const node = graph.locator(`.schema-flow-card[aria-label="Show source for ${type}"]`);
    await node.scrollIntoViewIfNeeded();
    const bounds = (await node.boundingBox())!;
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 });
    await page.mouse.up();
    await checkEndpoints();
  }
  await graph.locator(".solid-flow__pane").click({ position: { x: 5, y: 5 } });
  await page.mouse.wheel(0, -100);
  await checkEndpoints();
});
