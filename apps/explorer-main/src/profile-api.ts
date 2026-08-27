import clientRequestSchema from "../../../schemas/explorer-client-request.v1.schema.json";
import errorCodesSchema from "../../../schemas/error-codes.v1.schema.json";
import explorerSchema from "../../../schemas/explorer.v1.schema.json";
import responseSchema from "../../../schemas/explorer-response.v1.schema.json";
import { createRuntimeBoundaryValidator } from "../../../packages/contracts/src/runtime-validation.mjs";
import { createServerProfileTransport } from "../../../packages/explorer-state/src/http-transport.mjs";
import { ApiError, type ApiDispatcher } from "./api";
import type {
  ApiMeta,
  ApiSuccess,
  Bootstrap,
  CacheSnapshot,
  ConsistencyMode,
  EaclObject,
  KnownSubjectPage,
  ObjectPage,
  PermissionDecision,
  ReaderHealth,
  RelationshipPage,
  ResourceCount,
  SchemaInfo,
} from "./types";

export interface ExplorerProfile {
  id: string;
  backend: string;
  storage: string;
  state: "enabled";
  reason: null;
  route: string;
  deployment: {
    demoSha: string;
    eaclSha: string;
    artifact: {
      kind: "static" | "lambda-version";
      sha256: string;
      version: string;
    };
    deploymentId: string;
    dataManifestSha256: string;
    deployedAt: string;
  };
}

interface ProfileDescriptor {
  identity: ExplorerProfile["deployment"] & { profileId: string; artifactSha256: string };
  profile: { backend: string; storage: string };
  capabilities: {
    operations: string[];
    consistencyModes: string[];
    snapshotBehavior: string;
    cacheBehavior: string;
    limitations: string[];
  };
  dataset: { logicalResourceCount: number; serverCount: number };
  basis: { id: string; capturedAt: string; behavior: string; fixedForEnvironment: boolean };
}

interface WireEnvelope<T> {
  data?: T;
  error?: { code: string; message: string };
  meta: {
    requestId: string;
    revision: string;
    elapsedMs?: number;
    cacheStatus?: ApiMeta["cacheStatus"];
  };
}

export interface ExplorerTransport {
  bootstrap: (options?: { signal?: AbortSignal | null }) => Promise<unknown>;
  request: (
    operation: string,
    input?: Record<string, unknown>,
    options?: { signal?: AbortSignal | null },
  ) => Promise<unknown>;
  release: () => Promise<unknown>;
}

interface WireObject {
  type: string;
  id: string;
}

interface WirePage<T> {
  items: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null; pageSize: number };
}

interface WireSchema {
  sha256: string;
  types: Array<{
    name: string;
    relations: Array<{ name: string; subjectTypes: string[] }>;
    permissions: Array<{ name: string; expression: string }>;
  }>;
}

const schemas = { clientRequestSchema, errorCodesSchema, explorerSchema, responseSchema };
const validateRequest = createRuntimeBoundaryValidator(
  schemas,
  "https://demo.eacl.dev/schemas/explorer-client-request.v1.schema.json",
  "serverClientRequest",
);
const validateResponse = createRuntimeBoundaryValidator(
  schemas,
  "https://demo.eacl.dev/schemas/explorer-response.v1.schema.json",
  "serverResponse",
);

export function createProfileApi(
  profile: ExplorerProfile,
  options: { transport?: ExplorerTransport } = {},
): {
  dispatcher: ApiDispatcher;
  release: () => Promise<void>;
} {
  const transport = options.transport ?? createServerProfileTransport({
    profile,
    baseUrl: window.location.href,
    validateRequest,
    validateResponse,
  });
  let descriptor: ProfileDescriptor | undefined;
  let schema: SchemaInfo | undefined;
  const subjectCursors = new Map<string, Map<number, string | null>>();

  const wire = async <T>(
    operation: string,
    input: Record<string, unknown>,
    signal?: AbortSignal | null,
  ): Promise<WireEnvelope<T>> => {
    const result = (await transport.request(operation, input, { signal })) as WireEnvelope<T>;
    if (result.error || result.data === undefined) {
      throw new ApiError(400, {
        error: {
          code: result.error?.code ?? "unexpected-api-response",
          message: result.error?.message ?? "The profile request failed.",
        },
      });
    }
    return result;
  };

  const loadDescriptor = async (
    signal?: AbortSignal | null,
    refresh = false,
  ): Promise<ProfileDescriptor> => {
    if (!descriptor || refresh) {
      descriptor = (await transport.bootstrap({ signal })) as ProfileDescriptor;
      schema = undefined;
      subjectCursors.clear();
    }
    return descriptor;
  };

  const loadSchema = async (signal?: AbortSignal | null): Promise<SchemaInfo> => {
    if (schema) return schema;
    const active = await loadDescriptor(signal);
    const result = await wire<WireSchema>("get-schema", {
      consistency: preferredConsistency(active, "minimize-latency"),
    }, signal);
    schema = presentSchema(result.data!);
    return schema;
  };

  const envelope = <T>(
    data: T,
    requestId: string,
    basis: ProfileDescriptor["basis"] | null | undefined,
    elapsedMs?: number,
    cacheStatus?: ApiMeta["cacheStatus"],
  ): ApiSuccess<T> => ({
    data,
    meta: presentMeta(profile, requestId, basis, elapsedMs, cacheStatus),
  });
  const wireEnvelope = <T, U>(data: T, result: WireEnvelope<U>): ApiSuccess<T> =>
    ({
      data,
      meta: {
        revision: result.meta.revision,
        requestId: result.meta.requestId,
        ...(result.meta.elapsedMs === undefined ? {} : { elapsedMs: result.meta.elapsedMs }),
        ...(result.meta.cacheStatus === undefined ? {} : { cacheStatus: result.meta.cacheStatus }),
      },
    });

  const dispatcher: ApiDispatcher = async <T>(
    path: string,
    options: RequestInit = {},
  ): Promise<ApiSuccess<T>> => {
    const signal = options.signal;
    const url = new URL(path, window.location.origin);
    const body = parseBody(options.body);

    if (url.pathname === "/api/health") {
      const active = await loadDescriptor(signal);
      return envelope({ status: "ready", datahike: {
        revision: active.basis.id,
        storeBackend: profile.storage,
        freshness: active.capabilities.snapshotBehavior,
      }} as ReaderHealth, "bootstrap-health", active.basis) as ApiSuccess<T>;
    }

    if (url.pathname === "/api/bootstrap" || url.pathname === "/api/snapshot/refresh") {
      const active = await loadDescriptor(signal, url.pathname.endsWith("refresh"));
      const activeSchema = await loadSchema(signal);
      return envelope(presentBootstrap(active, activeSchema), "bootstrap", active.basis) as ApiSuccess<T>;
    }

    const active = await loadDescriptor(signal);
    const consistency = preferredConsistency(active, consistencyMode(body.consistency));

    if (url.pathname === "/api/schema") {
      const activeSchema = await loadSchema(signal);
      return envelope(activeSchema, "schema", active.basis) as ApiSuccess<T>;
    }

    if (url.pathname === "/api/cache") {
      const result = await wire<Record<string, unknown>>("get-cache-info", {}, signal);
      const snapshot: CacheSnapshot = {
        provider: result.data!,
        operations: {},
        capturedAt: new Date().toISOString(),
      };
      return wireEnvelope(snapshot, result) as ApiSuccess<T>;
    }

    if (url.pathname === "/api/subjects") {
      const offset = positiveInteger(url.searchParams.get("offset"), 0);
      const limit = positiveInteger(url.searchParams.get("limit"), 20);
      const cursors = subjectCursors.get(String(limit)) ?? new Map<number, string | null>([[0, null]]);
      subjectCursors.set(String(limit), cursors);
      let cursor = cursors.get(offset);
      if (cursor === undefined) {
        throw new ApiError(400, { error: { code: "invalid-cursor", message: "Return to the first subjects page." } });
      }
      const result = await wire<WirePage<WireObject>>("list-subjects", {
        pageSize: limit,
        ...(cursor ? { cursor } : {}),
      }, signal);
      const nextOffset = offset + result.data!.items.length;
      if (result.data!.pageInfo.hasNextPage && result.data!.pageInfo.endCursor) {
        cursors.set(nextOffset, result.data!.pageInfo.endCursor);
      }
      const page: KnownSubjectPage = {
        data: result.data!.items.map(object),
        pageInfo: {
          hasNextPage: result.data!.pageInfo.hasNextPage,
          hasPreviousPage: offset > 0,
          offset,
          nextOffset: result.data!.pageInfo.hasNextPage ? nextOffset : null,
        },
      };
      return wireEnvelope(page, result) as ApiSuccess<T>;
    }

    if (url.pathname === "/api/eacl/lookup-resources") {
      const result = await wire<WirePage<WireObject>>("lookup-resources", {
        subjectType: nestedIdentifier(body, "subject", "type"),
        subjectId: nestedIdentifier(body, "subject", "id"),
        resourceType: identifier(body.resourceType),
        permission: identifier(body.permission),
        pageSize: number(body.pageSize, 20),
        cache: body.cache !== false,
        populateCache: body.populateCache !== false,
        ...(body.after ? { cursor: identifier(body.after) } : {}),
        consistency,
      }, signal);
      return wireEnvelope(objectPage(result.data!), result) as ApiSuccess<T>;
    }

    if (url.pathname === "/api/eacl/count-resources") {
      const result = await wire<{ value: number; exact: boolean; ceiling: number }>("count-resources", {
        subjectType: nestedIdentifier(body, "subject", "type"),
        subjectId: nestedIdentifier(body, "subject", "id"),
        resourceType: identifier(body.resourceType),
        permission: identifier(body.permission),
        ceiling: number(body.countLimit, 1_000),
        cache: body.cache !== false,
        populateCache: body.populateCache !== false,
        consistency,
      }, signal);
      const count: ResourceCount = {
        count: result.data!.value,
        limit: result.data!.ceiling,
        truncated: !result.data!.exact,
      };
      return wireEnvelope(count, result) as ApiSuccess<T>;
    }

    if (url.pathname === "/api/eacl/lookup-subjects") {
      const result = await wire<WirePage<WireObject>>("lookup-subjects", {
        resourceType: nestedIdentifier(body, "resource", "type"),
        resourceId: nestedIdentifier(body, "resource", "id"),
        subjectType: identifier(body.subjectType),
        permission: identifier(body.permission),
        pageSize: number(body.pageSize, 20),
        cache: body.cache !== false,
        populateCache: body.populateCache !== false,
        ...(body.after ? { cursor: identifier(body.after) } : {}),
        consistency,
      }, signal);
      return wireEnvelope(objectPage(result.data!), result) as ApiSuccess<T>;
    }

    if (url.pathname === "/api/eacl/check-permission") {
      const result = await wire<{ allowed: boolean }>("authorize", {
        subjectType: nestedIdentifier(body, "subject", "type"),
        subjectId: nestedIdentifier(body, "subject", "id"),
        resourceType: nestedIdentifier(body, "resource", "type"),
        resourceId: nestedIdentifier(body, "resource", "id"),
        permission: identifier(body.permission),
        cache: body.cache !== false,
        populateCache: body.populateCache !== false,
        consistency,
      }, signal);
      return {
        data: { allowed: result.data!.allowed } as PermissionDecision,
        meta: {
          revision: result.meta.revision,
          requestId: result.meta.requestId,
          ...(result.meta.elapsedMs === undefined ? {} : { elapsedMs: result.meta.elapsedMs }),
          ...(result.meta.cacheStatus === undefined ? {} : { cacheStatus: result.meta.cacheStatus }),
        },
      } as ApiSuccess<T>;
    }

    if (url.pathname === "/api/eacl/read-relationships") {
      const result = await wire<WirePage<WireObject>>("reverse-relationships", {
        subjectType: nestedIdentifier(body, "subject", "type"),
        subjectId: nestedIdentifier(body, "subject", "id"),
        relation: identifier(body.relation),
        pageSize: number(body.pageSize, 20),
        cache: body.cache !== false,
        populateCache: body.populateCache !== false,
        ...(body.after ? { cursor: identifier(body.after) } : {}),
        consistency,
      }, signal);
      const resourceType = identifier(body.resourceType);
      const parent = object(body.subject as WireObject);
      const candidates = result.data!.items.filter((item) => item.type === resourceType);
      const items: RelationshipPage["items"] = [];
      for (const item of candidates) {
        let allowed = true;
        if (body.authorizationSubject && body.permission) {
          const decision = await wire<{ allowed: boolean }>("authorize", {
            subjectType: nestedIdentifier(body, "authorizationSubject", "type"),
            subjectId: nestedIdentifier(body, "authorizationSubject", "id"),
            resourceType: item.type,
            resourceId: item.id,
            permission: identifier(body.permission),
            cache: body.cache !== false,
            populateCache: body.populateCache !== false,
            consistency,
          }, signal);
          allowed = decision.data!.allowed;
        }
        if (allowed) {
          items.push({
            subject: parent,
            relation: identifier(body.relation),
            resource: object(item),
          });
        }
      }
      const page: RelationshipPage = {
        items,
        pageInfo: {
          hasNextPage: result.data!.pageInfo.hasNextPage,
          hasPreviousPage: Boolean(body.after),
          endCursor: result.data!.pageInfo.endCursor,
        },
      };
      return wireEnvelope(page, result) as ApiSuccess<T>;
    }

    throw new ApiError(404, { error: { code: "route-not-found", message: "The Explorer operation is not available." } });
  };

  return {
    dispatcher,
    release: async () => {
      await transport.release();
    },
  };
}

function presentBootstrap(descriptor: ProfileDescriptor, schema: SchemaInfo): Bootstrap {
  const supported = [...new Set(descriptor.capabilities.consistencyModes
    .map(presentConsistency)
    .filter((mode): mode is ConsistencyMode => mode !== null))];
  const defaultMode = supported[0] ?? "minimize-latency";
  return {
    status: "ready",
    seed: {
      status: "ready",
      serversAdded: 0,
      serversCompleted: 0,
      serversTarget: 0,
      totalServers: descriptor.dataset.serverCount,
    },
    totals: { servers: descriptor.dataset.serverCount },
    schema,
    quickSubjects: [
      { id: "super-user", label: "Super user" },
      { id: "user-1", label: "User 1" },
      { id: "user-2", label: "User 2" },
    ],
    pageSizeOptions: [10, 20, 50, 100, 250, 500, 1000],
    defaultPageSize: 20,
    consistency: {
      default: defaultMode,
      supported,
      fullyConsistent: false,
      fullyConsistentReason: "This public Explorer uses the read bases advertised by the selected profile.",
      atExactSnapshotDateSelection: descriptor.capabilities.consistencyModes.includes("historical-date"),
      atExactSnapshotDateSelectionReason: "Historical date selection is not advertised by this profile.",
    },
    capabilities: { schemaWrite: false, seedWrite: false, cacheEvict: false },
  };
}

function presentSchema(schema: WireSchema): SchemaInfo {
  const resourceTypes = schema.types
    .filter((type) => type.permissions.length > 0)
    .map((type) => type.name)
    .sort();
  const permissionsByType = Object.fromEntries(schema.types.map((type) => [
    type.name,
    type.permissions.map((permission) => permission.name).sort(),
  ]));
  const childPaths: SchemaInfo["childPaths"] = {};
  for (const type of schema.types) {
    for (const relation of type.relations) {
      for (const subjectType of relation.subjectTypes) {
        (childPaths[subjectType] ??= []).push({ resourceType: type.name, relation: relation.name });
      }
    }
  }
  for (const paths of Object.values(childPaths)) {
    paths.sort((left, right) => `${left.resourceType}:${left.relation}`.localeCompare(`${right.resourceType}:${right.relation}`));
  }
  const source = schema.types.map((type) => [
    `definition ${type.name} {`,
    ...type.relations.map((relation) => `  relation ${relation.name}: ${relation.subjectTypes.join(" | ")}`),
    ...(type.relations.length && type.permissions.length ? [""] : []),
    ...type.permissions.map((permission) => `  permission ${permission.name} = ${permission.expression}`),
    "}",
  ].join("\n")).join("\n\n");
  return {
    source,
    resourceTypes,
    permissionsByType,
    childPaths,
    nodes: schema.types.map((type) => ({ id: type.name, permissions: permissionsByType[type.name] ?? [] })),
    links: schema.types.flatMap((type) => type.relations.flatMap((relation) =>
      relation.subjectTypes.map((subjectType) => ({ source: type.name, target: subjectType, label: relation.name })))),
    resourceCount: schema.types.length,
    relationCount: schema.types.reduce((total, type) => total + type.relations.length, 0),
    permissionCount: schema.types.reduce((total, type) => total + type.permissions.length, 0),
    presets: [{ id: schema.sha256, label: "Published", schema: source }],
  };
}

function presentMeta(
  profile: ExplorerProfile,
  requestId: string,
  basis: ProfileDescriptor["basis"] | null | undefined,
  elapsedMs?: number,
  cacheStatus?: ApiMeta["cacheStatus"],
): ApiMeta {
  const active = basis ?? {
    id: profile.deployment.deploymentId,
    capturedAt: profile.deployment.deployedAt,
    behavior: "fixed-environment",
    fixedForEnvironment: true,
  };
  return {
    revision: active.id,
    requestId,
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    ...(cacheStatus === undefined ? {} : { cacheStatus }),
    basis: {
      id: active.id,
      backend: profile.backend,
      sourceId: active.id,
      revision: numericRevision(active.id),
      exactLocator: active.fixedForEnvironment ? active.id : null,
      kind: active.behavior,
      capturedAt: active.capturedAt,
      sourceLifecycle: active.behavior,
    },
  };
}

function presentConsistency(value: string): ConsistencyMode | null {
  if (value === "current") return "minimize-latency";
  if (value === "minimize") return "minimize-latency";
  if (value === "at-least") return "at-least-as-fresh";
  if (value === "exact") return "at-exact-snapshot";
  return null;
}

function consistencyMode(value: unknown): ConsistencyMode {
  if (value && typeof value === "object" && "mode" in value) {
    return identifier((value as { mode: unknown }).mode) as ConsistencyMode;
  }
  return "minimize-latency";
}

function preferredConsistency(descriptor: ProfileDescriptor, mode: ConsistencyMode): string {
  const requested = mode === "minimize-latency"
    ? "minimize"
    : mode === "at-least-as-fresh"
      ? "at-least"
      : mode === "at-exact-snapshot"
        ? "exact"
        : "current";
  return descriptor.capabilities.consistencyModes.includes(requested)
    ? requested
    : descriptor.capabilities.consistencyModes.includes("current")
      ? "current"
      : descriptor.capabilities.consistencyModes[0];
}

function object(value: WireObject): EaclObject {
  return { type: value.type, id: value.id };
}

function objectPage(page: WirePage<WireObject>): ObjectPage {
  return {
    items: page.items.map(object),
    pageInfo: {
      hasNextPage: page.pageInfo.hasNextPage,
      hasPreviousPage: false,
      endCursor: page.pageInfo.endCursor,
    },
  };
}

function parseBody(value: BodyInit | null | undefined): Record<string, unknown> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") throw new TypeError("Explorer request body must be JSON.");
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Explorer request body must be an object.");
  return parsed as Record<string, unknown>;
}

function nestedIdentifier(value: Record<string, unknown>, key: string, child: string): string {
  const nested = value[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) throw new TypeError(`Missing ${key}.`);
  return identifier((nested as Record<string, unknown>)[child]);
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !value) throw new TypeError("Explorer identifier is missing.");
  return value;
}

function number(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function positiveInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function numericRevision(value: string): number {
  const match = /(\d+)(?!.*\d)/u.exec(value);
  return match ? Number(match[1]) : 0;
}
