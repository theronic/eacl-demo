import { successfulData, unsupportedResult } from "./runner.mjs";

const CONSISTENCY_MODES = ["current", "minimize", "authoritative", "at-least", "exact", "historical-date"];

export function commonQualificationCases(exemplars) {
  const decisions = exemplars.cases.filter(({ kind }) => kind === "decision");
  return [
    healthCase(),
    ...decisions.map(authorizationCase),
    relationshipCase(),
    reverseRelationshipCase(),
    paginationAndCursorCase(),
    cacheCase(decisions[0]),
    consistencyCase(decisions[0]),
    unsupportedConsistencyCase(decisions[0]),
    failureAndRedactionCase(),
    cleanupCase()
  ];
}

function healthCase() {
  return operationCase("health-ready", "contract", ["health"], async ({ transport, descriptor }) => {
    const health = successfulData(await transport.request("health", {}), "health");
    if (!health.ready || health.status !== "ready") throw new Error("profile health is not ready");
    if (health.identity.profileId !== descriptor.identity.profileId || health.basis?.id !== descriptor.basis.id) throw new Error("health identity or basis differs from bootstrap");
    return { status: health.status, basisId: health.basis.id };
  });
}

function authorizationCase(exemplar) {
  return operationCase(`authorization-${exemplar.id}`, "authorization", ["authorize"], async ({ transport }) => {
    const demand = exemplar.demand;
    const decision = successfulData(await transport.request("authorize", {
      subjectType: demand.subject.type,
      subjectId: demand.subject.id,
      resourceType: demand.resource.type,
      resourceId: demand.resource.id,
      permission: demand.permission,
      consistency: "current"
    }), "authorize");
    if (decision.allowed !== exemplar.expected.allowed) throw new Error(`authorization exemplar ${exemplar.id} disagrees`);
    return { allowed: decision.allowed };
  });
}

function relationshipCase() {
  return operationCase("relationship-filter-and-shape", "relationship", ["list-relationships"], async ({ transport }) => {
    const page = successfulData(await transport.request("list-relationships", { resourceType: "account", resourceId: "account-0", relation: "owner", pageSize: 25, consistency: "current" }), "list-relationships");
    assertPage(page, 25);
    if (page.items.some(({ relation, resourceType, resourceId }) => relation !== "owner" || resourceType !== "account" || resourceId !== "account-0")) throw new Error("relationship filter returned an out-of-scope item");
    return { items: page.items.length };
  });
}

function reverseRelationshipCase() {
  return operationCase("reverse-relationship-discovery", "relationship", ["reverse-relationships"], async ({ transport }) => {
    const page = successfulData(await transport.request("reverse-relationships", { subjectType: "user", subjectId: "user-1", relation: "owner", pageSize: 25, consistency: "current" }), "reverse-relationships");
    assertPage(page, 25);
    const keys = page.items.map(({ type, id }) => `${type}:${id}`);
    if (new Set(keys).size !== keys.length) throw new Error("reverse relationship discovery returned duplicates");
    return { items: page.items.length };
  });
}

function paginationAndCursorCase() {
  return operationCase("pagination-cursor-scope", "pagination-cursor", ["list-subjects"], async ({ transport }) => {
    const first = successfulData(await transport.request("list-subjects", { type: "user", pageSize: 1 }), "list-subjects");
    assertPage(first, 1);
    if (!first.pageInfo.hasNextPage) throw new Error("canonical user fixture did not expose a second bounded page");
    const second = successfulData(await transport.request("list-subjects", { type: "user", pageSize: 1, cursor: first.pageInfo.endCursor }), "list-subjects");
    assertPage(second, 1);
    const firstKeys = new Set(first.items.map(({ type, id }) => `${type}:${id}`));
    if (second.items.some(({ type, id }) => firstKeys.has(`${type}:${id}`))) throw new Error("cursor pagination returned a duplicate across pages");
    const tampered = mutateCursor(first.pageInfo.endCursor);
    await expectFailure(() => transport.request("list-subjects", { type: "user", pageSize: 1, cursor: tampered }), "invalid-cursor");
    return { firstItems: first.items.length, secondItems: second.items.length, tamperRejected: true };
  });
}

function cacheCase(exemplar) {
  return {
    ...operationCase("cache-semantic-equivalence", "cache", ["authorize", "get-cache-info"], async ({ transport, descriptor }) => {
      if (descriptor.capabilities.cacheBehavior === "none") return unsupportedResult("The profile descriptor advertises no cache.");
      const input = demandInput(exemplar.demand);
      const first = successfulData(await transport.request("authorize", input), "authorize");
      const second = successfulData(await transport.request("authorize", input), "authorize");
      if (first.allowed !== second.allowed) throw new Error("cached and uncached authorization semantics differ");
      const cache = successfulData(await transport.request("get-cache-info", {}), "get-cache-info");
      if (cache.behavior !== descriptor.capabilities.cacheBehavior) throw new Error("cache behavior differs from descriptor");
      return { behavior: cache.behavior, stableDecision: first.allowed };
    })
  };
}

function consistencyCase(exemplar) {
  return operationCase("advertised-consistency-modes", "consistency", ["authorize"], async ({ transport, descriptor }) => {
    const outcomes = [];
    for (const mode of descriptor.capabilities.consistencyModes) {
      const decision = successfulData(await transport.request("authorize", { ...demandInput(exemplar.demand), consistency: mode }), "authorize");
      if (decision.allowed !== exemplar.expected.allowed) throw new Error(`advertised consistency ${mode} changed semantics`);
      outcomes.push(mode);
    }
    return { modes: outcomes.join(",") };
  });
}

function unsupportedConsistencyCase(exemplar) {
  return operationCase("unsupported-consistency-rejection", "consistency-failure", ["authorize"], async ({ transport, descriptor }) => {
    const unsupported = CONSISTENCY_MODES.find((mode) => !descriptor.capabilities.consistencyModes.includes(mode));
    if (!unsupported) return unsupportedResult("The profile advertises every closed consistency mode.");
    await expectFailure(() => transport.request("authorize", { ...demandInput(exemplar.demand), consistency: unsupported }), "unsupported-consistency");
    return { rejectedMode: unsupported };
  });
}

function failureAndRedactionCase() {
  return operationCase("validation-failure-redaction", "failure-redaction", ["authorize"], async ({ transport }) => {
    // Assemble the probe at runtime so the repository-wide scanner can still
    // treat every literal credential-shaped URL as a release blocker.
    const secretLike = ["https", "://", "user", ":", "password", "@example.invalid/token", "?secret", "=value"].join("");
    const failure = await captureFailure(() => transport.request("authorize", { subjectType: "user", subjectId: secretLike }));
    if (failure.code !== "validation-error") throw new Error(`malformed authorization returned ${failure.code ?? "no stable code"}`);
    if (JSON.stringify(failure.public).includes(secretLike) || JSON.stringify(failure.public).includes("password")) throw new Error("validation failure reflected secret-like input");
    return { code: failure.code, reflectedInput: false };
  });
}

function cleanupCase() {
  return {
    id: "cancellation-cleanup",
    category: "cleanup",
    applies: () => ({ supported: true }),
    async run({ transport }) {
      if (typeof transport.probeCancellationCleanup !== "function") return unsupportedResult("This transport does not expose an initial-qualification cleanup probe.");
      const result = await transport.probeCancellationCleanup();
      if (result?.releasedExactlyOnce !== true || result?.lateReplySuppressed !== true) throw new Error("cancellation cleanup probe failed");
      return result;
    }
  };
}

function operationCase(id, category, requiredOperations, run) {
  return {
    id,
    category,
    applies(descriptor) {
      const missing = requiredOperations.filter((operation) => !descriptor.capabilities.operations.includes(operation));
      return missing.length === 0 ? { supported: true } : { supported: false, reason: `Descriptor omits: ${missing.join(", ")}.` };
    },
    run
  };
}

function demandInput(demand) {
  return { subjectType: demand.subject.type, subjectId: demand.subject.id, resourceType: demand.resource.type, resourceId: demand.resource.id, permission: demand.permission, consistency: "current" };
}

function assertPage(page, maximum) {
  if (!page || !Array.isArray(page.items) || page.items.length > maximum || !page.pageInfo || page.pageInfo.pageSize > maximum) throw new Error("bounded page shape is invalid");
  if (page.pageInfo.hasNextPage !== (typeof page.pageInfo.endCursor === "string" && page.pageInfo.endCursor.length > 0)) throw new Error("page cursor state is inconsistent");
}

function mutateCursor(cursor) {
  const last = cursor.at(-1);
  return `${cursor.slice(0, -1)}${last === "a" ? "b" : "a"}`;
}

async function expectFailure(fn, code) {
  const failure = await captureFailure(fn);
  if (failure.code !== code) throw new Error(`expected ${code}, received ${failure.code ?? "success"}`);
  return failure;
}

async function captureFailure(fn) {
  try {
    const response = await fn();
    if (response && "error" in response && !("data" in response)) return { code: response.error?.code, public: response };
    return { code: null, public: response };
  } catch (error) {
    return { code: error?.code, public: { code: error?.code, message: error?.message } };
  }
}
