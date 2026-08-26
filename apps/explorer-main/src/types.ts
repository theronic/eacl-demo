export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export type CacheStatus = "hit" | "miss" | "disabled";
export type Theme = "light" | "dark";
export type ConsistencyMode =
  | "current"
  | "minimize-latency"
  | "at-least-as-fresh"
  | "at-exact-snapshot";

export interface ConsistencyRequest {
  mode: ConsistencyMode;
  atLeastAsFreshAs?: string;
}

export interface BasisInfo {
  id: string;
  backend: string;
  sourceId: unknown;
  branch?: string | null;
  sourceLifecycle: unknown;
  revision: number;
  exactLocator?: string | null;
  kind: string;
  capturedAt: string;
}

export interface ApiMeta {
  revision: string;
  requestId: string;
  basis?: BasisInfo;
  elapsedMs?: number;
  cacheStatus?: CacheStatus;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiFailure {
  error: ApiErrorPayload;
  meta?: Partial<ApiMeta>;
}

export interface EaclObject {
  type: string;
  id: string;
}

export interface PageInfo {
  startCursor?: string | null;
  endCursor?: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  offset?: number;
  nextOffset?: number | null;
  total?: number;
}

export interface ObjectPage {
  items: EaclObject[];
  pageInfo: PageInfo;
}

export interface KnownSubjectPage {
  data: EaclObject[];
  pageInfo: PageInfo;
}

export interface ResourceCount {
  count: number;
  limit: number;
  truncated: boolean;
}

export interface Relationship {
  subject: EaclObject;
  relation: string;
  resource: EaclObject;
}

export interface RelationshipPage {
  items: Relationship[];
  pageInfo: PageInfo;
}

export interface PermissionDecision {
  allowed: boolean;
}

export interface SchemaPreset {
  id: string;
  label: string;
  schema: string;
}

export interface SchemaNode {
  id: string;
  permissions: string[];
}

export interface SchemaLink {
  source: string;
  target: string;
  label: string;
}

export interface ChildPath {
  resourceType: string;
  relation: string;
}

export interface SchemaInfo {
  source: string;
  resourceTypes: string[];
  permissionsByType: Record<string, string[]>;
  childPaths: Record<string, ChildPath[]>;
  nodes: SchemaNode[];
  links: SchemaLink[];
  resourceCount: number;
  relationCount: number;
  permissionCount: number;
  presets: SchemaPreset[];
}

export interface SeedProgress {
  status: "ready" | "seeding" | "error";
  serversAdded: number;
  serversCompleted: number;
  serversTarget: number;
  totalServers: number;
  elapsedMs?: number;
  label?: string | null;
  error?: string | null;
}

export interface Bootstrap {
  status: "ready" | "seeding";
  seed: SeedProgress;
  totals: Record<string, number>;
  schema: SchemaInfo;
  quickSubjects: Array<{ id: string; label: string }>;
  pageSizeOptions: PageSize[];
  defaultPageSize: PageSize;
  consistency: {
    default: ConsistencyMode;
    supported: ConsistencyMode[];
    fullyConsistent: boolean;
    fullyConsistentReason: string;
    atExactSnapshotDateSelection: boolean;
    atExactSnapshotDateSelectionReason: string;
  };
  capabilities: {
    schemaWrite: boolean;
    seedWrite: boolean;
    cacheEvict: boolean;
  };
}

export interface ReaderHealth {
  status: "ready";
  datahike: {
    revision: string;
    storeBackend: string;
    freshness: string;
  };
}

export interface CacheSnapshot {
  provider: Record<string, unknown>;
  operations: Record<string, unknown>;
  capturedAt: string;
}

export interface AppPreferences {
  subjectId: string;
  permission: string;
  pageSize: PageSize;
  cacheEnabled: boolean;
  populateCache: boolean;
  theme: Theme;
  expanded: string[];
}
