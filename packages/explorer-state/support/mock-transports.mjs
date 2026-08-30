const OPERATIONS = Object.freeze(["health", "bootstrap", "list-subjects", "get-object", "list-relationships", "reverse-relationships", "check-permission", "get-schema", "get-cache-info", "count-objects"]);
const SHA = Object.freeze({ demo: "a".repeat(40), eacl: "a91815ae0a4d32fc32db4e671e4d101834688332", artifact: "b".repeat(64), data: "c".repeat(64), schema: "d".repeat(64) });

/** UI qualification fixtures only. They never appear in the public registry. */
export const mockCapabilityScenarios = Object.freeze([
  scenario("datahike-s3", "datahike", "s3", oneMillion(), lambda("java25", "arm64", "enabled"), {
    consistencyModes: ["minimize", "at-least", "exact"], snapshotBehavior: "request-snapshot", cacheBehavior: "shared-read-through", mutationLocality: "private-seed-workflow", limitations: ["read-only", "eventual-storage-read"]
  }),
  scenario("datahike-dynamodb", "datahike", "dynamodb", oneMillion(), lambda("java25", "arm64", "enabled"), {
    consistencyModes: ["minimize", "at-least", "exact"], snapshotBehavior: "request-snapshot", cacheBehavior: "shared-read-through", mutationLocality: "private-seed-workflow", limitations: ["read-only"]
  }),
  scenario("datomic-dynamodb", "datomic", "dynamodb", oneMillion(), lambda("java25", "x86_64", "enabled"), {
    consistencyModes: ["minimize", "authoritative", "at-least", "exact"], snapshotBehavior: "fixed-environment", cacheBehavior: "environment-local", mutationLocality: "private-seed-workflow", limitations: ["read-only", "fixed-current-snapshot", "no-synchronization"]
  }),
  scenario("datalevin-memory", "datalevin", "embedded", tenThousand(), lambda("java25", "arm64", "enabled"), {
    consistencyModes: ["minimize"], snapshotBehavior: "rebuild-lifecycle", cacheBehavior: "environment-local", mutationLocality: "initialization-before-ready", limitations: ["read-only", "ephemeral", "no-durability", "lifecycle-rebuild", "unequal-dataset-scale"]
  }),
  scenario("jank-memory", "jank", "memory", tenThousand(), lambda("provided.al2023", "x86_64", "disabled"), {
    consistencyModes: ["minimize"], snapshotBehavior: "rebuild-lifecycle", cacheBehavior: "environment-local", mutationLocality: "initialization-before-ready", limitations: ["read-only", "ephemeral", "no-durability", "datomic-like-not-datomic-pro", "no-datalog-api", "no-distribution", "not-production-database", "unequal-dataset-scale", "no-snapstart", "lifecycle-rebuild"]
  }),
  scenario("datascript-browser-memory", "datascript", "browser-memory", tenThousand(), { execution: "browser", name: "clojurescript", architecture: "javascript", snapStart: "not-applicable" }, {
    consistencyModes: ["minimize"], snapshotBehavior: "page-lifecycle", cacheBehavior: "browser-page-local", mutationLocality: "browser-initialization", limitations: ["browser-local", "ephemeral", "no-durability", "unequal-dataset-scale", "unsupported-consistency"]
  })
]);

export function createMockTransportEnvironment(scenarioValue, options = {}) {
  const found = typeof scenarioValue === "string" ? mockCapabilityScenarios.find(({ profile }) => profile.id === scenarioValue) : scenarioValue;
  if (!found) throw new Error("unknown mock capability scenario");
  const selected = structuredClone(found);
  const calls = [];
  const releases = [];
  const cancellations = [];
  const profile = enabledProfile(selected);
  const transportFactory = () => {
    let released = false;
    return {
      async bootstrap({ signal } = {}) {
        await delay(options.bootstrapDelayMs ?? 0, signal);
        calls.push({ operation: "bootstrap", input: {} });
        if (options.bootstrapFailure) throw options.bootstrapFailure;
        return structuredClone(selected.descriptor);
      },
      async request(operation, input = {}, { signal, requestId } = {}) {
        if (!selected.descriptor.capabilities.operations.includes(operation)) throw typed("unsupported-capability", "This operation is unavailable.", false);
        await delay(options.delays?.[operation] ?? options.delayMs ?? 0, signal);
        calls.push({ operation, input: structuredClone(input), requestId });
        const configuredFailure = options.failures?.[operation];
        if (configuredFailure) {
          const failure = typeof configuredFailure === "function" ? configuredFailure(input) : structuredClone(configuredFailure);
          if (failure) return failure;
        }
        const configuredResponse = options.responses?.[operation];
        const data = configuredResponse ? (typeof configuredResponse === "function" ? configuredResponse(input, calls.filter((call) => call.operation === operation).length) : structuredClone(configuredResponse)) : responseData(selected, operation, input);
        return { data, meta: responseMeta(selected, requestId ?? `mock-${calls.length}`) };
      },
      cancel(requestId) { cancellations.push(requestId); },
      async release() { if (!released) { released = true; releases.push(selected.profile.id); } }
    };
  };
  return { scenario: selected, profile, transportFactory, calls, releases, cancellations };
}

function scenario(id, backend, storage, dataset, runtime, capabilityOverrides) {
  const basis = { behavior: capabilityOverrides.snapshotBehavior, id: `${id}-basis-1`, capturedAt: "2026-08-25T12:00:00Z", fixedForEnvironment: capabilityOverrides.snapshotBehavior === "fixed-environment" };
  const deployment = { demoSha: SHA.demo, eaclSha: SHA.eacl, artifactSha256: SHA.artifact, deploymentId: `${id}-mock-deployment`, dataManifestSha256: dataset.manifestSha256 };
  return Object.freeze({
    profile: Object.freeze({ id, backend, storage }),
    descriptor: Object.freeze({
      contract: { name: "explorer.v1", routeMajor: 1, revision: 1, minimumClientRevision: 0 },
      identity: { profileId: id, ...deployment },
      profile: { backend, storage }, runtime,
      capabilities: { operations: [...OPERATIONS], ...capabilityOverrides },
      limits: { pageSize: 1000, countCeiling: 1_000_000, deadlineMs: 10_000 },
      dataset,
      basis
    })
  });
}

function enabledProfile(selected) {
  const descriptor = selected.descriptor;
  return {
    ...selected.profile,
    state: "enabled",
    reason: null,
    route: descriptor.profile.backend === "datascript" ? "/datascript/" : "/",
    deployment: {
      demoSha: descriptor.identity.demoSha,
      eaclSha: descriptor.identity.eaclSha,
      artifact: { kind: descriptor.profile.backend === "datascript" ? "static" : "lambda-version", sha256: descriptor.identity.artifactSha256, version: "mock" },
      deploymentId: descriptor.identity.deploymentId,
      dataManifestSha256: descriptor.identity.dataManifestSha256,
      deployedAt: "2026-08-25T12:00:00Z"
    }
  };
}

function responseData(selected, operation, input) {
  const subject = { type: "user", id: input.subjectId ?? "user-1", displayName: "Example user", attributes: [] };
  const object = { type: input.resourceType ?? input.type ?? "server", id: input.resourceId ?? input.id ?? "server-1", displayName: "Example server", attributes: [{ name: "fixture", value: selected.descriptor.dataset.fixtureId }] };
  const pageInfo = { hasNextPage: false, endCursor: null, pageSize: Math.min(input.pageSize ?? 20, 1000) };
  const responses = {
    health: { status: "ready", ready: true, basis: selected.descriptor.basis },
    bootstrap: selected.descriptor,
    "list-subjects": { items: [subject], pageInfo },
    "get-object": { object },
    "list-relationships": { items: [{ resourceType: object.type, resourceId: object.id, relation: input.relation ?? "owner", subjectType: subject.type, subjectId: subject.id, subjectRelation: null }], pageInfo },
    "reverse-relationships": { items: [object], pageInfo },
    "check-permission": { allowed: true },
    "get-schema": { sha256: SHA.schema, types: [{ name: "server", relations: [{ name: "owner", subjectTypes: ["user"] }], permissions: [{ name: "view", expression: "owner" }] }] },
    "get-cache-info": {
      provider: { "exact-hits": 0, "exact-entries": 0 },
      operations: {},
      capturedAt: selected.descriptor.basis.capturedAt,
    },
    "count-objects": { kind: "objects", value: Math.min(input.ceiling ?? selected.descriptor.dataset.logicalResourceCount, selected.descriptor.dataset.logicalResourceCount), exact: (input.ceiling ?? 1_000_000) >= selected.descriptor.dataset.logicalResourceCount, ceiling: input.ceiling ?? 1_000_000 }
  };
  return structuredClone(responses[operation]);
}

function responseMeta(selected, requestId) {
  const descriptor = selected.descriptor;
  return {
    revision: descriptor.basis.id,
    requestId
  };
}

function oneMillion() { return { fixtureId: "canonical-v1-1000000", logicalResourceCount: 1_000_000, serverCount: 998_417, manifestSha256: SHA.data }; }
function tenThousand() { return { fixtureId: "canonical-v1-10000", logicalResourceCount: 10_000, serverCount: 9_922, manifestSha256: SHA.data }; }
function lambda(name, architecture, snapStart) { return { execution: "lambda", name, architecture, snapStart }; }

function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (milliseconds === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (callback) => { signal?.removeEventListener("abort", abort); callback(); };
    const timer = setTimeout(() => finish(resolve), milliseconds);
    const abort = () => { clearTimeout(timer); finish(() => reject(abortError())); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function abortError() { const error = new Error("aborted"); error.name = "AbortError"; return error; }
function typed(code, publicMessage, retryable) { const error = new Error(code); error.code = code; error.publicMessage = publicMessage; error.retryable = retryable; return error; }

export const mockLogicalOperations = OPERATIONS;
