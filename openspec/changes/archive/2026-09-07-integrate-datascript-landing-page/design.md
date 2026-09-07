## Context

See `proposal.md` for motivation. `apps/explorer-main/src/App.tsx` redirects default visits and backend selections through `window.location`. The DataScript entry merely supplies a transport to the same Explorer. Static assembly currently injects a deferred classic script into a separately built DataScript HTML document. That script embeds a serialized canonical database and exposes `EaclDataScriptRuntime`.

The runtime owns a singleton lifecycle and auxiliary object, subject, and relationship collections. Its bootstrap reports fixed fixture counts. The shared profile API currently sets `seedWrite: false`, although the header already contains seed controls and the state layer polls seed progress. Existing route checks, deployment publication, deterministic assembly, and network isolation tests assume two entries. Earlier requirements remain in the unarchived consolidation change rather than main specs.

## Goals / Non-Goals

**Goals:** Maintain a real asynchronous payload boundary, preserve deployment/descriptor validation, reuse shared UI, and make session mutations coherent across the database and explorer indexes.

**Non-Goals:** New workers, remote mutation endpoints, browser persistence, arbitrary schema editing, core authorization-engine changes, or preserving added data after the DataScript session is released.

## Decisions

### One application with a conditional classic-script loader

Remove entry-specific redirect branches and use the existing URL controller for all backends. A small loader in the main application obtains a build-generated content-addressed runtime URL and dynamically inserts a same-origin script only for the selected, enabled DataScript profile. Use the compiled classic-script export rather than forcing the current advanced ClojureScript build into ESM. Dynamic import of an ESM adapter remains an implementation option, but the large runtime and fixture must stay outside eager imports and preload links.

Static assembly injects inert runtime asset metadata into the root HTML after the runtime digest is known. The loader memoizes the in-flight/successful load by artifact URL, checks the expected export, clears failed attempts for retry, and passes through the existing immutable identity handshake. Metadata is not an executable script reference. A mismatched publication must continue to fail the handshake.

Keep the existing hashed `datascript/assets/` runtime location to minimize delivery changes; a URL prefix does not require a separate application. Serve the same root HTML for legacy DataScript document paths and replace their address in history while preserving valid query intent. Stop building the separate SolidJS wrapper once assembly and delivery no longer depend on it. Retain the CLJS source location initially to avoid an unrelated namespace/build move.

### Separate downloaded code from active session ownership

Memoizing script loading must not memoize mutable runtime sessions. Give each activation a lifecycle generation; check it after asynchronous load, initialization, and seed boundaries. Release aborts pending work and clears connection-owned state. Replace the singleton's unguarded delayed initialization with generation-aware ownership so a late old initialization or release cannot overwrite a newer session.

Keep selectors usable during loading and error states. Returning to DataScript reuses downloaded code but restores a fresh canonical database. Retaining seeded sessions across backend changes was considered, but conflicts with the existing deterministic cleanup model and increases memory retention.

### Preserve snapshot startup; add bounded incremental seeding

Restore the existing serialized 10,000-resource database exactly once per activation. Here “entities” refers to logical resources; supporting subjects and relationships remain additional records. Use the fixture's record constructors and schema to create deterministic local additions: one new account for each group of 100 new servers. IDs use a local prefix and an ordinal carried across jobs. Each local account links to the existing platform and user-1 owner. This keeps endpoint fan-out bounded and supports arbitrary additive counts without replaying or duplicating existing records.

Use an additional-resource count, defaulting to 10,000, with an initial total-resource cap of 100,000 advertised by the local descriptor and displayed in the UI. This conservative browser cap is a product limit, not a performance claim. It can be tuned after browser qualification without changing additive semantics. Do not materialize the million-resource fixture or rebuild the entire database for each addition.

Run bounded batches on the main thread, yielding between commits. Each batch publishes database/index/count changes together, then advances progress and the next ordinal. Track the original job target and committed ordinal so retry resumes only its remaining work. Reject overlapping jobs. A switch invalidates the job before the next commit. Disable database-dependent interactions during mutation and refresh them at completion or failure; keep profile switching available.

### Adjustment from browser profiling

Extending the canonical prefix was measured and rejected during implementation: at 25,000 resources, a 500-resource batch blocked for about seven seconds. CPU profiling traced this to the pinned EACL qualified writer reading whole endpoint entities during publication; its large canonical account grows on every addition. Deterministic local account groups preserve the initial fixture, schema, EACL mutation APIs, and requested resource count while avoiding this growth. They intentionally do not claim to extend the canonical benchmark prefix. A 100-resource batch bounds scheduling work. This is demo data generation, not a change to Core authorization or server fixtures.

### Local seed contract and accurate dataset state

Extend the browser-local request/response boundary with seed start, status, and retry behavior, using the existing header/state API shape where appropriate. Keep these operations out of the server transport allowlist and server validators. Advertise local seeding capability only for DataScript. Replace Datahike-specific progress copy and distinguish resource counts from the existing server-count label.

After each commit, advance the local basis, invalidate cursors and stale UI requests, and invalidate/recreate authorization cache state through supported adapter behavior. Update all auxiliary lookup collections used by the runtime, not only the connection. On completion or partial failure, reload bootstrap/counts/tree/detail/cache state against the current basis.

Keep immutable deployment identity and the original manifest identity as provenance. Represent the session's changed dataset through current logical counts, basis, and an explicit locally modified indicator in the browser-local descriptor/UI. Do not claim an extended dataset has the pristine canonical content digest, and do not rewrite release publication hashes.

### Verify the conditional boundary rather than a route boundary

Replace assumptions that all main output files must exclude DataScript with checks on eager entry reachability and observed requests. Root server-profile visits must fetch no runtime or fixture. Root default visits must load it once, with no document redirect. Preserve zero-worker and zero-authorization-API assertions. Update descriptor route expectations, static manifests, artifact determinism, deployment smoke checks, and legacy routing together.

## Risks / Trade-offs

- Main-thread restore and batches can delay interaction → Preserve prebuilt restore, use bounded yielding batches, and measure responsiveness at the advertised cap.
- Late singleton work can corrupt a newer activation → Explicit generation checks and rapid-switch tests covering initialization, seeding, and release.
- Database and auxiliary indexes can diverge → Publish coherent batch state and verify lookup/count/permission results on added resources.
- New local mutation contracts could accidentally enable remote writes → Separate browser-local validators and tests proving server seed rejection.
- Old HTML and new publication identities can overlap during rollout → Upload immutable assets first, publish matched documents/status through the existing release workflow, and retain identity failure behavior.
- Consolidation artifacts contradict the new route model → Reconcile the affected DataScript, shell, delivery, and task text during implementation; preserve unrelated consolidation work.

## Migration Plan

1. Implement the conditional loader, session ownership, and local seeding behind the shared app; update runtime metadata and identity/route expectations together.
2. Assemble a single app with legacy document aliases; update build inventory, deployment scripts, qualification, and documentation.
3. Run focused unit/contract checks and production-build browser qualification for default startup, server isolation, switching, compatibility links, seeding, failure/retry, and stale-session behavior.
4. Prepare deployment through the existing static publication workflow: upload hashed assets first, then matching entry documents and DataScript publication metadata. Deployment itself is outside this planning task.
5. Roll back by restoring the previous coherent static documents and publication, retaining immutable assets so cached documents remain usable.
