# Explorer source inventory and reconciliation

This inventory fixes the source boundary for the consolidated SolidJS explorer. It is an implementation decision record, not permission to copy a legacy client wholesale. The canonical client uses the two-step profile selector, registry, descriptor handshake, and `explorer.v1` contract already owned by this repository.

## Captured inputs

The source identities and dirty manifests are recorded in `docs/provenance/source-state-2026-08-25.{json,md}`. Because several useful UI changes were uncommitted at capture time, the status-manifest identity is part of the evidence whenever the captured worktree rather than its commit is consulted.

| Client | Captured commit | Captured state | Qualification at capture |
| --- | --- | --- | --- |
| Datahike | `06d8141a0cfebbd3b423cd719f9f05eb94ca50aa` | status manifest `a8c0f25778d7a85362e3c988d5986279424eb0c7cd30fc5d8cb824d7b245096b` | client production build passed |
| Datalevin | `06d8141a0cfebbd3b423cd719f9f05eb94ca50aa` | status manifest `bc8bb07932a65d1551b3af1d9fb903fcdd75a4b0b4b1e3b4c2642194235ca7ee` | client build passed; copied server build failed |
| Datomic | `8774ef39bc3e7d63d6a1be0bb9630b786a3d0a2a` | status manifest `fbf7817c65f8608c81a6a868dcde02b7ba3ce6e8cff3fdb6bce13ebcc04e5494` | client and server tests passed |
| Jank | no commit (unborn repository) | status manifest `e215cf057b2bd82e496885a91b73dd0aad47831c41b52acd81bff324ee0397c2` | host-only build passed; no Lambda-compatible artifact |

The clients were inspected under each repository's `client/src`. Short file digests below are the first eight hexadecimal characters of SHA-256 and are comparison aids only; the captured-state records above are the provenance authority.

| Area | Datahike | Datalevin | Datomic | Jank | Reconciliation |
| --- | --- | --- | --- | --- | --- |
| `App.tsx` | `036ad874` | `42212e89` | `7619646a` | `2a102a84` | replace backend shells and seed banners with one registry/descriptor-driven shell |
| `api.ts` | `3e4e8a6b` | `603ae868` | `603ae868` | `7ed7a5a1` | replace old route/envelope clients with one validated transport interface |
| `format.ts` | `f0bfe6aa` | `f0bfe6aa` | `f0bfe6aa` | `276bf6b6` | extract bounded, locale-safe presentation helpers |
| `preferences.ts` | `edb03566` | `d7a91917` | `f1bdf52c` | `71de0bba` | replace product-specific keys and unsafe legacy page sizes with canonical portable/local state |
| `state.tsx` | `e186610c` | `b4217668` | `f6b0326d` | `a58cbb0c` | replace with backend-neutral state, epochs, aborts, and per-panel resources |
| `styles.css` | `341ac588` | `1ddbbc46` | `86cc2953` | `56c71ef1` | reconcile tokens, focus, reduced motion, and responsive rules into one stylesheet |
| `types.ts` | `01c6e92b` | `674def05` | `9c566b21` | `a757975b` | replace backend envelopes/types with generated or hand-maintained `explorer.v1` client types |
| `Common.tsx` | `d80701af` | `d80701af` | `d80701af` | `2f7f86ea` | extract accessible primitives after contract and focus review |
| `SchemaGraph.tsx` | `98709de6` | `98709de6` | `98709de6` | `cf0e348d` | extract presentation, add textual equivalent and motion-safe lifecycle |
| `ConsistencyPanel.tsx` | `fe8e9175` | absent | absent | absent | adapt only as a descriptor-driven optional component |

## Component decisions

| Legacy responsibility | Decision | Canonical behavior |
| --- | --- | --- |
| `Header` | adapt | Shared product identity, backend then storage selectors, deployment/data identity, page size, theme, and profile readiness. No backend repository links, seed form, or mutation status. |
| `SubjectsPanel` | adapt | Bounded cursor paging of known subjects, subject selection, and schema-supported permission selection. Reset its cursor when semantic inputs change. |
| `ResourceTree` | adapt | Bounded object listing and count escalation, object lookup, relationship expansion, cursor paging, cancellation, and stale-result suppression. Do not encode backend-native identifiers. |
| `DetailPanel` | adapt | Authorization decision, bounded explanation paths, reverse relationship lookup, and immutable object metadata. Each subpanel owns its own retry/error state. |
| `SchemaPanel` | adapt | Read-only schema text/structure and accessible graph. Remove editor, presets that imply writes, and write controls. |
| `SchemaGraph` | adapt | Preserve useful SVG layout, but provide a structured text/table alternative, deterministic cleanup, reduced-motion behavior, and no backend conditional. |
| `CachePanel` | adapt | Show descriptor limitations and read-only cache information only when advertised. Remove eviction and any persistent cache mutation. Client-side cache preference is merely a request hint when the descriptor supports it. |
| `ConsistencyPanel` | adapt | Render only modes advertised by the selected descriptor. Never infer modes from the backend name. Datomic fixed-current exposes `current`/`minimize` semantics only and never an exact/at-least control. |
| `Common` primitives | extract | Keep disclosure, pagination, badges, status, loading, error, spinner, and empty-state patterns after accessible-name, focus, and busy-state tests. |
| Startup/seed progress | retire | Public deployment data is immutable. Show transport bootstrap, cold start, restore, or worker initialization progress; never poll or invoke a seed route. |

The shared component set is therefore: application header; backend/storage selectors; profile status and limitation list; panel boundary; loading, error, retry, cancel, and empty states; cursor pagination; subject/permission selector; object browser; relationship tree; authorization details; schema text/graph; cache information; consistency selection; and immutable identity metadata.

## State and preference decisions

The common legacy state shape—subject, permission, selected object, page size, cache flag, theme, expanded sections, and abortable latest requests—is useful behavior, but its implementation is replaced. The canonical state is separated into these scopes:

- **Portable semantic URL state:** backend, storage, subject type/id, resource type/id, permission, relation, active view, bounded page size, cache preference, and supported consistency preference, using `packages/explorer-state/src/url-state.mjs`. Cursors, basis values, request IDs, epochs, cache contents/state, seed state, and page offsets are never portable.
- **Local presentation preferences:** theme, page size, expanded sections, and optional cache preference under one versioned `eacl-demo` key. Invalid or obsolete values fail closed to defaults. Page size defaults to 25 and is capped at the contract maximum of 100; legacy options 250, 500, and 1000 are rejected.
- **Profile session:** selected profile descriptor and negotiated identities, readiness, bootstrap/startup status, client epoch, and transport ownership. A backend/storage change increments the epoch, aborts all owned work, releases the prior transport, clears cursors/results, and begins a fresh identity handshake.
- **Semantic query state:** subject, permission, selected object, relation, view, and cache/consistency request preferences. Changing a semantic input invalidates only dependent results. Selection is preserved across refreshes when the same canonical object remains present, but never fabricates a backend-native selection.
- **Per-panel async state:** request ID, phase, last settled value, safe public error, retryability, active cursor chain, and cancellation owner. One panel's failure cannot replace or invalidate successfully settled sibling panels.

The four legacy storage keys are read only by an explicit one-time migration, if implemented. Cross-product fallback chains are not retained because they can transfer inappropriate state between profiles. `user-1`, `view`, light theme, cache enabled, and page size 20 were common legacy defaults; the new profile bootstrap supplies schema-valid semantic defaults, theme follows the saved/system preference, and page size follows the central default of 25.

## API and type reconciliation

The legacy clients call backend-specific paths including `/api/bootstrap`, `/api/subjects`, `/api/eacl/*`, `/api/schema`, `/api/cache`, `/api/cache/evict`, `/api/seed`, `/api/health`, and Datahike `/api/snapshot/refresh`. They use similar but non-identical envelopes and expose mutation fields such as `schemaWrite`, `seedWrite`, `cacheEvict`, and `mutationRevision`. Datahike additionally exposes basis/consistency/reader-health types, while Datalevin alone adds an optional `bounded` page flag.

None of those types or routes is canonical. Server profiles use `/api/v1/{profile-id}/{operation}` and the ten read-only operation names in `capability-vocabulary.v1`: `health`, `bootstrap`, `list-subjects`, `get-object`, `list-relationships`, `reverse-relationships`, `authorize`, `get-schema`, `get-cache-info`, and `count-objects`. DataScript uses the same operation names inside validated worker messages. All requests and responses are validated against the closed schemas before state is changed.

The canonical transport exposes capability-neutral `request`, `cancel`, and `dispose` behavior plus its immutable profile identity. Unsupported controls are absent or disabled with descriptor-supplied explanations; a transport must still reject an unsupported operation. Schema writes, seed/setup, transactions, snapshot refresh, cache eviction, store deletion, benchmarks, and administration have no public client method.

## Capability and backend reconciliation

- Availability, operation support, cache behavior, consistency modes, snapshot behavior, mutation locality, dataset identity, hard limits, and limitations come from the selected registry entry and descriptor.
- Backend names choose a profile; they never decide which panel, label, consistency option, or claim appears.
- Datahike's `minimize`, `at-least`, and `exact` UX may be shown only where the selected Datahike storage descriptor advertises and the runtime qualifies it.
- Datomic Lambda is a fixed current database value for the lifetime of an environment. It must not inherit Datahike snapshot-refresh controls or present `exact`, `at-least`, historical, authoritative, `d/sync`, or mutation behavior.
- Datalevin memory and Jank memory must present their actual ephemeral/lifecycle/durability limits. Jank is a Datomic-like conformance store, not Datomic Pro.
- DataScript is browser-local and uses a worker lifecycle; its initialization progress is not server seed progress.
- A disabled/unavailable profile remains selectable for truthful status display, but creates no public transport and runs no operation.

## Style and accessibility reconciliation

All four clients contain useful dark-theme variables, responsive breakpoints, `:focus-visible` treatments, busy states, live regions, and `prefers-reduced-motion` rules. These are extracted as behaviors, not copied as divergent stylesheets. The canonical stylesheet has shared semantic tokens, explicit light/dark color schemes, visible keyboard focus, layouts that reflow without horizontal page scrolling, touch-sized controls, and a reduced-motion override for spinners/transitions/graph animation.

Every async panel keeps its heading and controls mounted, marks only the affected region busy, announces concise status transitions through a bounded polite live region, and uses an alert for terminal errors. Retry/cancel returns focus to a durable control or panel heading. Pagination exposes accessible names and disables impossible actions. Disclosure state uses `aria-expanded` and stable `aria-controls`. The schema graph has a non-visual structured equivalent and is not the sole source of information.

## Explicit retire list

The consolidated public explorer does not contain or call:

- seed forms, seed progress polling, setup, transactions, schema editing/writes, cache eviction, persistent cache mutation, store deletion, migration, or snapshot-refresh endpoints;
- mutation revisions or public writer capabilities;
- backend-native values, exceptions, handles, bases, connection data, raw cursors, or secret-bearing diagnostics;
- legacy offset paging where a contract cursor is required, unbounded count/list behavior, or page sizes above 100;
- backend-name conditionals for capabilities, claims, limitations, or visible component structure; or
- claims that the selected profile is the latest source rather than the exact deployed identities returned by the registry/descriptor handshake.

This reconciliation is the acceptance boundary for the shared state package, component extraction, and DataScript worker work that follows.
