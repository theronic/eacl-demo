import {
  PAGE_SIZE_OPTIONS,
  type AppPreferences,
  type PageSize,
  type Theme,
} from "./types";

const STORAGE_KEY = "eacl-datahike-demo.preferences.v2";
const LEGACY_STORAGE_KEY = "eacl-datahike-demo.preferences.v1";

export const DEFAULT_PREFERENCES: AppPreferences = {
  subjectId: "user-1",
  permission: "view",
  pageSize: 20,
  cacheEnabled: true,
  populateCache: true,
  theme: "light",
  expanded: [],
};

function pageSize(value: unknown): PageSize {
  return PAGE_SIZE_OPTIONS.includes(value as PageSize)
    ? (value as PageSize)
    : DEFAULT_PREFERENCES.pageSize;
}

function theme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

export function readPreferences(storage?: Storage): AppPreferences {
  try {
    const activeStorage = storage ?? globalThis.localStorage;
    const current = activeStorage.getItem(STORAGE_KEY);
    const legacy = current === null ? activeStorage.getItem(LEGACY_STORAGE_KEY) : null;
    const raw = current ?? legacy;
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const value = JSON.parse(raw) as Partial<AppPreferences>;
    // v1 persisted the old default on every visit, so returning viewers cannot
    // be distinguished from viewers who explicitly chose it. Migrate that one
    // value to the safer v2 default while retaining all other preferences. A
    // subsequent explicit super-user selection is stored in v2 and preserved.
    const migratedLegacyDefault = legacy !== null && value.subjectId === "super-user";
    return {
      subjectId:
        !migratedLegacyDefault &&
        typeof value.subjectId === "string" && value.subjectId
          ? value.subjectId
          : DEFAULT_PREFERENCES.subjectId,
      permission:
        typeof value.permission === "string" && value.permission
          ? value.permission
          : DEFAULT_PREFERENCES.permission,
      pageSize: pageSize(value.pageSize),
      cacheEnabled:
        typeof value.cacheEnabled === "boolean"
          ? value.cacheEnabled
          : DEFAULT_PREFERENCES.cacheEnabled,
      populateCache:
        typeof value.populateCache === "boolean"
          ? value.populateCache
          : DEFAULT_PREFERENCES.populateCache,
      theme: theme(value.theme),
      expanded: Array.isArray(value.expanded)
        ? value.expanded.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writePreferences(
  preferences: AppPreferences,
  storage?: Storage,
): void {
  try {
    const activeStorage = storage ?? globalThis.localStorage;
    activeStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage is an optional enhancement; reactive application state remains live.
  }
}
