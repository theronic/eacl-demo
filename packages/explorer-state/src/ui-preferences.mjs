const STORAGE_KEY = "eacl-demo.preferences.v1";
const THEMES = new Set(["system", "light", "dark"]);
const CONSISTENCY = new Set(["minimize", "authoritative", "at-least", "exact", "historical-date"]);
export const defaultUiPreferences = Object.freeze({ version: 1, theme: "system", pageSize: 20, cacheEnabled: true, consistencyMode: "minimize", expanded: [] });

export function readUiPreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultUiPreferences);
    const value = JSON.parse(raw);
    if (!value || value.version !== 1) return structuredClone(defaultUiPreferences);
    return validateUiPreferences({ ...defaultUiPreferences, ...value });
  } catch {
    return structuredClone(defaultUiPreferences);
  }
}

export function writeUiPreferences(preferences, storage = globalThis.localStorage) {
  const value = validateUiPreferences({ ...preferences, version: 1 });
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Local storage is an optional enhancement. */ }
  return value;
}

export function createThemeController({
  root = globalThis.document?.documentElement,
  storage = globalThis.localStorage,
  media = globalThis.matchMedia?.("(prefers-color-scheme: dark)"),
  onChange = () => {}
} = {}) {
  let preferences = readUiPreferences(storage);
  let closed = false;

  const effectiveTheme = () => preferences.theme === "system" ? (media?.matches ? "dark" : "light") : preferences.theme;
  const apply = () => {
    if (closed) return;
    const effective = effectiveTheme();
    root?.setAttribute?.("data-theme", effective);
    if (root?.style) root.style.colorScheme = effective;
    onChange({ preference: preferences.theme, effective });
  };
  const onMediaChange = () => { if (preferences.theme === "system") apply(); };
  media?.addEventListener?.("change", onMediaChange);
  apply();

  return {
    setTheme(theme) {
      preferences = writeUiPreferences({ ...preferences, theme }, storage);
      apply();
      return { preference: preferences.theme, effective: effectiveTheme() };
    },
    getTheme: () => ({ preference: preferences.theme, effective: effectiveTheme() }),
    close() {
      if (closed) return;
      closed = true;
      media?.removeEventListener?.("change", onMediaChange);
    }
  };
}

export function validateUiPreferences(value) {
  if (!value || value.version !== 1 || !THEMES.has(value.theme)) throw new TypeError("invalid UI preference version or theme");
  if (!Number.isSafeInteger(value.pageSize) || value.pageSize < 1 || value.pageSize > 1000) throw new TypeError("invalid UI page size");
  if (typeof value.cacheEnabled !== "boolean" || !CONSISTENCY.has(value.consistencyMode)) throw new TypeError("invalid UI cache or consistency preference");
  if (!Array.isArray(value.expanded) || value.expanded.some((item) => typeof item !== "string" || item.length > 64)) throw new TypeError("invalid expanded UI preferences");
  return { version: 1, theme: value.theme, pageSize: value.pageSize, cacheEnabled: value.cacheEnabled, consistencyMode: value.consistencyMode, expanded: [...new Set(value.expanded)].slice(0, 32) };
}

export const uiPreferencesStorageKey = STORAGE_KEY;
