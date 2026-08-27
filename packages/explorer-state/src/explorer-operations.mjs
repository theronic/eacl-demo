const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const MAX_CURSOR_BYTES = 4096;
const MAX_PAGE_SIZE = 100;
const MAX_COUNT = 1_000_000;
const COUNT_STEPS = Object.freeze([1_000, 10_000, 100_000, 1_000_000]);

/**
 * Builds only closed explorer.v1 inputs and binds every cursor/count state to
 * the active controller epoch. No backend-specific operation appears here.
 */
export function createExplorerOperations({ controller, onState = () => {} }) {
  if (!controller || typeof controller.runPanel !== "function" || typeof controller.getState !== "function") throw new TypeError("explorer controller is required");
  let state = initialState(controller.getState().epoch);

  function publish(patch) {
    state = { ...state, ...patch };
    onState(structuredClone(state));
  }

  function synchronizeEpoch() {
    const epoch = controller.getState().epoch;
    if (state.epoch !== epoch) {
      state = initialState(epoch);
      onState(structuredClone(state));
    }
    return epoch;
  }

  async function listSubjects({ type = null, direction = "first" } = {}) {
    const base = type === null ? {} : { type: identifier(type, "subject type") };
    return runCursorPage({ key: `subjects:${type ?? "all"}`, panelId: "subjects", operation: "list-subjects", base, direction });
  }

  async function getObject({ type, id }) {
    synchronizeEpoch();
    const input = withConsistency({ type: identifier(type, "resource type"), id: identifier(id, "resource ID") });
    return controller.runPanel("object-detail", "get-object", input, { validate: (value) => validateObjectResult(value, input) });
  }

  async function countObjects({ kind = "objects", type = null, escalate = false } = {}) {
    synchronizeEpoch();
    if (!new Set(["subjects", "objects", "relationships"]).has(kind)) throw new TypeError("invalid count kind");
    const key = `${kind}:${type ?? "all"}`;
    const previous = state.counts[key] ?? null;
    if (escalate && previous?.exact) return { outcome: "complete", value: structuredClone(previous) };
    const descriptorCeiling = descriptorLimit("count-ceiling", "countCeiling", MAX_COUNT);
    const ceiling = escalate ? nextCountCeiling(previous?.ceiling ?? 0, descriptorCeiling) : Math.min(COUNT_STEPS[0], descriptorCeiling);
    const input = withConsistency({ kind, ...(type === null ? {} : { type: identifier(type, "resource type") }), ceiling });
    const result = await controller.runPanel(`count-${stableKey(key)}`, "count-objects", input, { validate: (value) => validateCount(value, kind, ceiling) });
    if (result.outcome !== "success") return result;
    publish({ counts: { ...state.counts, [key]: { ...result.value, ceiling } } });
    return result;
  }

  async function listRelationships({ resourceType, resourceId, relation = null, direction = "first" }) {
    const base = {
      resourceType: identifier(resourceType, "resource type"),
      resourceId: identifier(resourceId, "resource ID"),
      ...(relation === null ? {} : { relation: identifier(relation, "relation") })
    };
    const key = `relationships:${resourceType}:${resourceId}:${relation ?? "all"}`;
    return runCursorPage({ key, panelId: `relationships-${stableKey(key)}`, operation: "list-relationships", base: withConsistency(base), direction });
  }

  async function reverseRelationships({ subjectType, subjectId, relation = null, direction = "first" }) {
    const base = {
      subjectType: identifier(subjectType, "subject type"),
      subjectId: identifier(subjectId, "subject ID"),
      ...(relation === null ? {} : { relation: identifier(relation, "relation") })
    };
    const key = `reverse:${subjectType}:${subjectId}:${relation ?? "all"}`;
    return runCursorPage({ key, panelId: `reverse-${stableKey(key)}`, operation: "reverse-relationships", base: withConsistency(base), direction });
  }

  async function checkPermission({ subjectType, subjectId, resourceType, resourceId, permission }) {
    synchronizeEpoch();
    const input = withConsistency({
      subjectType: identifier(subjectType, "subject type"),
      subjectId: identifier(subjectId, "subject ID"),
      resourceType: identifier(resourceType, "resource type"),
      resourceId: identifier(resourceId, "resource ID"),
      permission: identifier(permission, "permission")
    });
    const panelId = `authorization-${stableKey(`${resourceType}:${resourceId}:${permission}`)}`;
    return controller.runPanel(panelId, "check-permission", input, { validate: (value) => validateDecision(value, input) });
  }

  async function getSchema() {
    synchronizeEpoch();
    return controller.runPanel("schema", "get-schema", withConsistency({}), { validate: validateSchema });
  }

  async function getCacheInfo() {
    synchronizeEpoch();
    return controller.runPanel("cache", "get-cache-info", {}, { validate: validateCache });
  }

  function reset() {
    state = initialState(controller.getState().epoch);
    onState(structuredClone(state));
  }

  function cancel(scope) {
    synchronizeEpoch();
    if (scope === "subjects") return controller.cancelPanel("subjects");
    const pager = state.pagers[scope];
    return pager ? controller.cancelPanel(pager.panelId) : controller.cancelPanel(scope);
  }

  function cancelCount({ kind = "objects", type = null } = {}) {
    synchronizeEpoch();
    if (!new Set(["subjects", "objects", "relationships"]).has(kind)) throw new TypeError("invalid count kind");
    const key = `${kind}:${type ?? "all"}`;
    return controller.cancelPanel(`count-${stableKey(key)}`);
  }

  return { listSubjects, getObject, countObjects, listRelationships, reverseRelationships, checkPermission, getSchema, getCacheInfo, cancel, cancelCount, reset, getState: () => structuredClone(state) };

  async function runCursorPage({ key, panelId, operation, base, direction }) {
    synchronizeEpoch();
    if (!new Set(["first", "next", "previous"]).has(direction)) throw new TypeError("invalid page direction");
    const current = state.pagers[key] ?? initialPager(panelId);
    if (!state.pagers[key]) publish({ pagers: { ...state.pagers, [key]: current } });
    let targetIndex = current.index;
    const cursors = [...current.cursors];
    if (direction === "first") targetIndex = 0;
    if (direction === "previous") targetIndex = Math.max(0, current.index - 1);
    if (direction === "next") {
      if (!current.pageInfo?.hasNextPage || !current.pageInfo.endCursor) return { outcome: "complete", value: current.value };
      targetIndex = current.index + 1;
      cursors[targetIndex] = boundedCursor(current.pageInfo.endCursor);
    }
    const cursor = cursors[targetIndex] ?? null;
    const input = { ...base, pageSize: pageSize(), ...(cursor === null ? {} : { cursor }) };
    const result = await controller.runPanel(panelId, operation, input, { validate: (value) => validatePage(value, input.pageSize) });
    if (result.outcome !== "success") return result;
    cursors.splice(targetIndex + 1);
    publish({ pagers: { ...state.pagers, [key]: { panelId, index: targetIndex, page: targetIndex + 1, cursors, pageInfo: result.value.pageInfo, value: result.value } } });
    return result;
  }

  function withConsistency(input) {
    const explorer = controller.getState();
    const mode = explorer.preferences.consistencyMode;
    if (!explorer.descriptor.capabilities.consistencyModes.includes(mode)) throw new Error("selected consistency is not advertised");
    return { ...input, consistency: mode };
  }

  function pageSize() {
    const preferred = controller.getState().preferences.pageSize;
    return Math.min(preferred, descriptorLimit("page-size", "pageSize", MAX_PAGE_SIZE), MAX_PAGE_SIZE);
  }

  function descriptorLimit(wireName, normalizedName, fallback) {
    const limits = controller.getState().descriptor?.limits;
    if (Array.isArray(limits)) return limits.find(({ name }) => name === wireName)?.value ?? fallback;
    return limits?.[normalizedName] ?? fallback;
  }
}

function validatePage(value, requestedPageSize) {
  if (!value || !Array.isArray(value.items) || !value.pageInfo || value.items.length > requestedPageSize || value.items.length > MAX_PAGE_SIZE) throw new Error("page response exceeds requested bounds");
  const pageInfo = value.pageInfo;
  if (typeof pageInfo.hasNextPage !== "boolean" || !Number.isSafeInteger(pageInfo.pageSize) || pageInfo.pageSize < 0 || pageInfo.pageSize > requestedPageSize) throw new Error("page metadata is invalid");
  if ((pageInfo.hasNextPage && (typeof pageInfo.endCursor !== "string" || pageInfo.endCursor.length === 0)) || (!pageInfo.hasNextPage && pageInfo.endCursor !== null)) throw new Error("page cursor state is invalid");
  if (typeof pageInfo.endCursor === "string") boundedCursor(pageInfo.endCursor);
  return value;
}

function validateCount(value, kind, ceiling) {
  if (!value || value.kind !== kind || !Number.isSafeInteger(value.value) || value.value < 0 || value.value > ceiling || typeof value.exact !== "boolean") throw new Error("bounded count response is invalid");
  if (!value.exact && (value.ceiling !== ceiling || value.value !== ceiling)) throw new Error("truncated count must equal its explicit ceiling");
  if (value.exact && value.ceiling !== null && value.ceiling !== ceiling) throw new Error("exact count ceiling metadata is invalid");
  return value;
}

function validateDecision(value, input) {
  for (const key of ["subjectType", "subjectId", "resourceType", "resourceId", "permission"]) if (value?.[key] !== input[key]) throw new Error("authorization response does not match request scope");
  if (typeof value.allowed !== "boolean" || !Array.isArray(value.path) || value.path.length > 64) throw new Error("authorization decision is invalid");
  return value;
}

function validateObjectResult(value, input) {
  const object = value?.object;
  if (!object || object.type !== input.type || object.id !== input.id || !Array.isArray(object.attributes) || object.attributes.length > 64) throw new Error("object response does not match request scope");
  return value;
}

function validateSchema(value) {
  if (!value || typeof value.sha256 !== "string" || !Array.isArray(value.types) || value.types.length < 1 || value.types.length > 128) throw new Error("schema response is invalid");
  return value;
}

function validateCache(value) {
  if (!value || typeof value.behavior !== "string" || typeof value.scope !== "string" || !Array.isArray(value.limitations) || value.limitations.length > 16) throw new Error("cache response is invalid");
  return value;
}

function identifier(value, name) {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > 256 || !IDENTIFIER.test(value)) throw new TypeError(`invalid ${name}`);
  return value;
}

function boundedCursor(cursor) {
  if (typeof cursor !== "string" || cursor.length === 0 || new TextEncoder().encode(cursor).length > MAX_CURSOR_BYTES) throw new Error("cursor exceeds client bounds");
  return cursor;
}

function nextCountCeiling(previous, maximum) {
  return COUNT_STEPS.find((step) => step > previous && step <= maximum) ?? maximum;
}

function stableKey(value) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value)) { hash ^= byte; hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function initialPager(panelId) { return { panelId, index: 0, page: 1, cursors: [null], pageInfo: null, value: null }; }
function initialState(epoch) { return { epoch, pagers: {}, counts: {} }; }
