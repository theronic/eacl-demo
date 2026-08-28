import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createUrlStateController } from "./src/url-controller.mjs";
import { selectBackend } from "./src/selection.mjs";

const catalog = JSON.parse(await readFile(new URL("../contracts/backend-storage.v1.json", import.meta.url), "utf8"));

test("direct links normalize malformed, duplicate, unknown, and incompatible fields", () => {
  const browser = fakeBrowser("/?storage=s3&backend=datomic&backend=datahike&unknown=x&subject=%00bad");
  const states = [];
  const controller = createUrlStateController({ catalog, ...browser, onState: (state, issues) => states.push({ state, issues }) });
  assert.deepEqual(states[0].state, { backend: "datomic", storage: "dynamodb", platform: "lambda-1024" });
  assert.deepEqual(states[0].issues.map(({ code }) => code).sort(), ["duplicate-field", "invalid-storage", "invalid-value", "unknown-field"].sort());
  assert.equal(browser.location.search, "?backend=datomic&storage=dynamodb&platform=lambda-1024");
  assert.equal(browser.history.replacements, 1);
  controller.close();
});

test("backend replacement chooses compatible storage in one history entry", () => {
  const browser = fakeBrowser("/?backend=datahike&storage=s3&subject=user%3Aalice");
  const controller = createUrlStateController({ catalog, ...browser });
  const nextSelection = selectBackend(catalog, controller.getState(), "jank");
  controller.navigate({ ...controller.getState(), ...nextSelection });
  assert.equal(browser.location.search, "?backend=jank&storage=memory&platform=lambda-1024&subject=user%3Aalice");
  assert.equal(browser.history.entries.length, 2);
  controller.close();
});

test("browser back and forward restore canonical backend/storage state", () => {
  const browser = fakeBrowser("/?backend=datahike&storage=s3");
  const seen = [];
  const controller = createUrlStateController({ catalog, ...browser, onState: (state) => seen.push(`${state.backend}/${state.storage}`) });
  controller.navigate({ backend: "datahike", storage: "dynamodb" });
  controller.navigate({ backend: "datomic", storage: "dynamodb" });
  browser.history.back();
  browser.history.back();
  browser.history.forward();
  assert.deepEqual(seen, ["datahike/s3", "datahike/dynamodb", "datomic/dynamodb", "datahike/dynamodb", "datahike/s3", "datahike/dynamodb"]);
  controller.close();
});

test("oversized direct links normalize to the lowest-cost DataScript default", () => {
  const browser = fakeBrowser(`/?backend=jank&storage=memory&subject=${"a".repeat(2100)}`);
  const controller = createUrlStateController({ catalog, ...browser });
  assert.deepEqual(controller.getState(), { backend: "datascript", storage: "browser-memory", platform: "browser" });
  assert.equal(browser.location.search, "?backend=datascript&storage=browser-memory&platform=browser");
  controller.close();
});

function fakeBrowser(initialUrl) {
  const initial = new URL(initialUrl, "https://demo.eacl.dev");
  const location = { pathname: initial.pathname, search: initial.search, hash: initial.hash };
  const listeners = new Map();
  const entries = [`${location.pathname}${location.search}${location.hash}`];
  let index = 0;
  const apply = (url) => {
    const parsed = new URL(url, "https://demo.eacl.dev");
    location.pathname = parsed.pathname;
    location.search = parsed.search;
    location.hash = parsed.hash;
  };
  const eventTarget = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); }
  };
  const history = {
    entries,
    replacements: 0,
    pushState(_state, _title, url) { entries.splice(++index); entries[index] = url; apply(url); },
    replaceState(_state, _title, url) { entries[index] = url; history.replacements += 1; apply(url); },
    back() { if (index > 0) { apply(entries[--index]); listeners.get("popstate")?.(); } },
    forward() { if (index < entries.length - 1) { apply(entries[++index]); listeners.get("popstate")?.(); } }
  };
  return { history, location, eventTarget };
}
