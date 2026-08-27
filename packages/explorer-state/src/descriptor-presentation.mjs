const OPERATION_PRESENTATION = Object.freeze({
  health: notice("health", "Health", "Report readiness and immutable serving identity."),
  bootstrap: notice("bootstrap", "Profile facts", "Negotiate the contract, capabilities, limits, dataset, and basis."),
  "list-subjects": notice("list-subjects", "Subjects", "Browse known subjects in bounded pages."),
  "get-object": notice("get-object", "Objects", "Open one normalized object by canonical type and identifier."),
  "list-relationships": notice("list-relationships", "Relationships", "Expand outbound relationships in bounded cursor pages."),
  "reverse-relationships": notice("reverse-relationships", "Reverse lookup", "Find normalized objects related to a selected subject."),
  authorize: notice("authorize", "Authorization", "Evaluate one subject, resource, and permission with a bounded explanation path."),
  "get-schema": notice("get-schema", "Schema", "Inspect the read-only normalized authorization schema."),
  "get-cache-info": notice("get-cache-info", "Cache", "Inspect the advertised cache scope and request result without mutating it."),
  "count-objects": notice("count-objects", "Bounded counts", "Count only up to an explicit ceiling and distinguish exact from truncated results.")
});

const CONSISTENCY_PRESENTATION = Object.freeze({
  current: notice("current", "Current", "Use the profile's current published or lifecycle-owned database value."),
  minimize: notice("minimize", "Minimize latency", "Use the lowest-latency consistency path this profile advertises."),
  authoritative: notice("authoritative", "Authoritative", "Wait for the profile's qualified authoritative read boundary."),
  "at-least": notice("at-least", "At least as fresh", "Require a basis that is no older than the supplied qualified marker."),
  exact: notice("exact", "Exact snapshot", "Read only the exact qualified snapshot identified by a scoped token."),
  "historical-date": notice("historical-date", "Historical date", "Select a qualified retained snapshot at or before a date.")
});

const SNAPSHOT_PRESENTATION = Object.freeze({
  "fixed-environment": notice("fixed-environment", "Fixed for this environment", "One database value is captured during initialization and remains fixed until the serving environment is replaced."),
  "request-snapshot": notice("request-snapshot", "Snapshot per request", "Each admitted operation owns a bounded immutable request snapshot."),
  "page-lifecycle": notice("page-lifecycle", "Browser page lifecycle", "The database, cursors, and cache belong to the current browser page."),
  "rebuild-lifecycle": notice("rebuild-lifecycle", "Rebuilt environment", "The immutable dataset is rebuilt and verified before each serving lifecycle becomes ready.")
});

const CACHE_PRESENTATION = Object.freeze({
  none: notice("none", "No authorization cache", "The profile advertises no reusable authorization cache."),
  "request-local": notice("request-local", "Request-local cache", "Cached values exist only inside one admitted operation."),
  "environment-local": notice("environment-local", "Environment-local cache", "Cached values may be reused only within the current isolated serving environment."),
  "browser-page-local": notice("browser-page-local", "Browser-page cache", "Cached values remain inside the current browser page and are discarded with it."),
  "shared-read-through": notice("shared-read-through", "Shared read-through cache", "The profile may reuse qualified read-through entries under its advertised identity and invalidation rules.")
});

const MUTATION_PRESENTATION = Object.freeze({
  none: notice("none", "No data mutation", "Neither public requests nor initialization mutate the dataset."),
  "private-seed-workflow": notice("private-seed-workflow", "Private publication workflow", "Dataset creation and publication happen only in a separate privileged workflow; the public explorer is read-only."),
  "initialization-before-ready": notice("initialization-before-ready", "Initialization before readiness", "The environment creates and verifies its private fixture before public read operations become ready."),
  "browser-initialization": notice("browser-initialization", "Browser-local initialization", "Fixture initialization affects only the current browser page and never a shared server dataset.")
});

const LIMITATION_PRESENTATION = Object.freeze({
  "read-only": notice("read-only", "Read-only public profile", "Public explorer operations cannot seed, transact, edit schema, evict shared cache, migrate, or administer storage."),
  "fixed-current-snapshot": notice("fixed-current-snapshot", "Fixed current snapshot", "The current database value is fixed for this serving environment and does not advance during requests."),
  "no-synchronization": notice("no-synchronization", "No synchronization", "Requests cannot wait for a newer backend basis or trigger synchronization."),
  "no-history-api": notice("no-history-api", "No public history selection", "Retained storage history is not exposed by this read-only profile."),
  ephemeral: notice("ephemeral", "Ephemeral dataset", "The serving dataset belongs to an isolated runtime lifecycle and can be rebuilt after replacement."),
  "browser-local": notice("browser-local", "Browser-local execution", "Authorization inputs, fixture data, and results remain in the browser page."),
  "no-durability": notice("no-durability", "No durability claim", "This profile does not promise durable application data across runtime replacement."),
  "datomic-like-not-datomic-pro": notice("datomic-like-not-datomic-pro", "Bundled in-memory Datomic-like conformance store", "The in-memory store demonstrates the accepted semantics but is not Datomic Pro and makes no Datomic service claim."),
  "no-datalog-api": notice("no-datalog-api", "No Datalog API", "This conformance store implements the bounded EACL access paths only; it does not expose or claim a general Datalog query API."),
  "no-distribution": notice("no-distribution", "Not distributed", "Each Lambda environment owns an isolated in-memory rebuild; there is no replicated or distributed database service."),
  "not-production-database": notice("not-production-database", "Not a production database", "This store exists only to demonstrate EACL semantics and is not supported as an application database."),
  "unequal-dataset-scale": notice("unequal-dataset-scale", "Smaller fixture", "This profile uses the canonical ten-thousand-resource prefix and must not be compared as if it served the million-resource dataset."),
  "no-snapstart": notice("no-snapstart", "SnapStart is not used", "Startup relies on the profile runtime; no SnapStart support or performance claim is made."),
  "eventual-storage-read": notice("eventual-storage-read", "Storage visibility limits", "Fresh storage publication may be eventually visible; only qualified snapshot semantics are advertised."),
  "lifecycle-rebuild": notice("lifecycle-rebuild", "Lifecycle rebuild", "Environment or page replacement discards owned database, cursor, and cache state and rebuilds from the accepted fixture."),
  "unsupported-consistency": notice("unsupported-consistency", "Some consistency modes are unavailable", "Only the modes listed for this profile are executable; other requests fail instead of silently weakening consistency.")
});

export function projectDescriptorPresentation(descriptor) {
  if (!descriptor?.identity || !descriptor.profile || !descriptor.runtime || !descriptor.capabilities || !descriptor.dataset || !descriptor.basis) throw new Error("descriptor presentation facts are incomplete");
  const capabilities = descriptor.capabilities;
  const operations = projectTerms(capabilities.operations, OPERATION_PRESENTATION, "operation");
  const consistencyModes = projectTerms(capabilities.consistencyModes, CONSISTENCY_PRESENTATION, "consistency mode");
  const snapshot = projectTerm(capabilities.snapshotBehavior, SNAPSHOT_PRESENTATION, "snapshot behavior");
  const cache = projectTerm(capabilities.cacheBehavior, CACHE_PRESENTATION, "cache behavior");
  const mutation = projectTerm(capabilities.mutationLocality, MUTATION_PRESENTATION, "mutation locality");
  const limitations = projectTerms(capabilities.limitations, LIMITATION_PRESENTATION, "limitation");
  const supported = new Set(capabilities.operations);

  return Object.freeze({
    identity: Object.freeze({ profileId: descriptor.identity.profileId, backend: descriptor.profile.backend, storage: descriptor.profile.storage }),
    runtime: Object.freeze({
      label: `${descriptor.runtime.name} · ${descriptor.runtime.architecture} · ${descriptor.runtime.execution}`,
      snapStart: descriptor.runtime.snapStart,
      description: descriptor.runtime.snapStart === "enabled" ? "SnapStart enabled" : descriptor.runtime.snapStart === "disabled" ? "SnapStart disabled" : "SnapStart not applicable"
    }),
    operations,
    controls: Object.freeze({
      subjects: supported.has("list-subjects"),
      objects: supported.has("get-object") && supported.has("count-objects"),
      relationships: supported.has("list-relationships"),
      reverseRelationships: supported.has("reverse-relationships"),
      authorization: supported.has("authorize"),
      schema: supported.has("get-schema"),
      cache: supported.has("get-cache-info"),
      consistency: consistencyModes.length > 1
    }),
    consistency: Object.freeze({ defaultMode: consistencyModes[0].id, modes: consistencyModes }),
    snapshot,
    cache,
    mutation,
    limitations,
    limits: Object.freeze(normalizeLimits(descriptor.limits)),
    dataset: Object.freeze({ fixtureId: descriptor.dataset.fixtureId, logicalResourceCount: descriptor.dataset.logicalResourceCount, manifestSha256: descriptor.dataset.manifestSha256 }),
    deployment: Object.freeze({ ...descriptor.identity }),
    basis: Object.freeze({ ...descriptor.basis })
  });
}

function projectTerms(terms, dictionary, kind) {
  if (!Array.isArray(terms)) throw new Error(`descriptor ${kind} list is missing`);
  return Object.freeze(terms.map((term) => projectTerm(term, dictionary, kind)));
}

function projectTerm(term, dictionary, kind) {
  const projected = dictionary[term];
  if (!projected) throw new Error(`unknown descriptor ${kind}`);
  return projected;
}

function normalizeLimits(limits) {
  if (Array.isArray(limits)) return Object.fromEntries(limits.map(({ name, value }) => [name, value]));
  if (limits && typeof limits === "object") return { ...limits };
  throw new Error("descriptor limits are missing");
}

function notice(id, label, description) {
  return Object.freeze({ id, label, description });
}
