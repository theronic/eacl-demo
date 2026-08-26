import assert from "node:assert/strict";
import test from "node:test";

import { createThemeController, defaultUiPreferences, readUiPreferences, uiPreferencesStorageKey, writeUiPreferences } from "./src/ui-preferences.mjs";

test("preferences persist one bounded product-neutral record", () => {
  const storage = memoryStorage();
  const written = writeUiPreferences({ ...defaultUiPreferences, theme: "dark", pageSize: 100, expanded: ["schema", "schema"] }, storage);
  assert.equal(storage.entries.size, 1);
  assert.equal(storage.entries.has(uiPreferencesStorageKey), true);
  assert.deepEqual(written.expanded, ["schema"]);
  assert.deepEqual(readUiPreferences(storage), written);
  storage.setItem(uiPreferencesStorageKey, JSON.stringify({ ...written, pageSize: 1000 }));
  assert.deepEqual(readUiPreferences(storage), defaultUiPreferences);
});

test("theme controller handles system changes and explicit light/dark overrides", () => {
  const storage = memoryStorage();
  const root = fakeRoot();
  const media = fakeMedia(false);
  const changes = [];
  const controller = createThemeController({ root, storage, media, onChange: (change) => changes.push(change) });
  assert.equal(root.attributes.get("data-theme"), "light");
  media.change(true);
  assert.equal(root.attributes.get("data-theme"), "dark");
  controller.setTheme("light");
  media.change(true);
  assert.equal(root.attributes.get("data-theme"), "light");
  controller.setTheme("dark");
  assert.equal(root.style.colorScheme, "dark");
  controller.close();
  assert.equal(changes.length >= 4, true);
});

function memoryStorage() {
  const entries = new Map();
  return { entries, getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}
function fakeRoot() { const attributes = new Map(); return { attributes, style: {}, setAttribute: (name, value) => attributes.set(name, value) }; }
function fakeMedia(initial) {
  let listener = null;
  return { matches: initial, addEventListener: (_name, callback) => { listener = callback; }, removeEventListener: () => { listener = null; }, change(value) { this.matches = value; listener?.(); } };
}
