> **Superseded relationship-read requirements (2026-09-09):** The later `2026-09-09-use-direct-relationship-expansion` change replaces every requirement below to retain, construct, validate or migrate to `read-relationships :authorization`. Nested demo branches use plain indexed reads with the exact parent/type/relation, pagination, consistency and cache controls, and perform no endpoint permission checks. Removed authorization fields are rejected on presence, including nil/null. Viewing subject and permission remain inputs to root lookups, the access inspector and permission checks only. Library callers needing endpoint authorization compose direct reads with `can?` or `check-permissions` on one snapshot and own filtered pagination. Historical completed tasks and measurements below describe the earlier release, not the new contract. All unrelated requirements remain in force. Apply the companion delta before archiving; do not restore the superseded clauses.

## Context

See `proposal.md` for motivation and `specs/resource-first-explorer/spec.md` for the behavior contract. The proposal branch is `design/resource-first-explorer`, created from the clean `agent/record-legacy-storage-retirement` checkout. The workspace parent is not a Git repository; the affected repository is `eacl-demo`.

The connected application is SolidJS. `Explorer.tsx` composes Header, ProfileSelector, SchemaPanel, CachePanel, ConsistencyPanel, a three-column Subjects/Resources/Detail grid, CanPermissionFooter, and ExplorerFooter. The presentation already sits above substantial request scoping, basis generation, cancellation, pagination, and response identity machinery. This redesign must preserve that machinery.

The existing main spec tree contains `release-identity`, `datascript-landing-page`, and `datascript-local-seeding`. The broader shared-shell requirements are still an active delta in `consolidate-eacl-demo-backends/specs/unified-demo-shell/spec.md`. Some prose in the user guide and older planning artifacts differs from current source behavior (for example default backend and available profiles); the apply phase must use the deployed descriptor and current source as its operational authorities, and reconcile relevant documentation without changing the other active proposal.

### Reference evidence

Inspected locally on 2026-09-08; these are source references, not claims of live reference-app verification:

| Reference | Relevant evidence | Adaptation |
| --- | --- | --- |
| `~/code/0tx/ztx-solid/src/ledger/tree/LedgerRow.tsx` | Separate square disclosure and journal toggle; count rail; nested child container | Separate expand/select actions; keep counts and timings together |
| `~/code/0tx/ztx-solid/src/accounts/tree.ts` | Filled/outline plus/minus states, explicit empty-child text | Accurate branch/leaf state, no misleading expandable leaf |
| `~/code/peach/peach-roadmap/public/explorer/app.js`, `buildOrgTree` | Explicit comment attributing tree to 0tx; persistent collapse state; fuzzy local filtering; ancestor retention; visible-row keyboard movement; distinct navigation/filter actions | Preserve branch context and keyboard model; do not add resource filtering |
| `~/code/peach/peach-roadmap/public/explorer/styles.css` | Compact rows, disclosure/count styling, selected row state | Hierarchy guides and restrained use of type color |
| `~/code/eacl/eacl-edrive/client/src/App.tsx` | Top-right avatar/account menu and user-switch actions | Header principal selector with current identity visible |

The reference repositories are read-only for this change. No financial data, company datasets, or private reference assets are copied into the preview.

## Goals / Non-Goals

**Goals:**

- Make the forward/reverse query relationship understandable from the two-pane arrangement and language.
- Keep query context near the result, with a compact native-radio consistency selector and counts/latency/cache evidence directly beside each query result. Do not spend space on extra cards, dashboard summaries, or marketing copy.
- Reuse validated operations and request lifecycles while changing presentation and navigation.
- Provide a reviewable local prototype before converting the connected explorer.

**Non-Goals:**

- A new authorization engine, backend optimization, cache policy, server search API, wire-contract change, schema change, fixture replacement, renamed resources, or simplified stress-test topology.
- Unbounded expand-all, speculative descendant prefetch, or whole-dataset browser materialization.
- A fabricated benchmark dashboard or a ranking of different backends at different scales.
- Redesigning eDrive, Peach, or 0tx, deploying the site, or replacing the independent local caveats/expiry playground.

## Decisions

### 1. One coherent workspace with two visual treatments

Use the original explorer's control model, readable typography, and dense query/result presentation in the new two-pane layout. Keep the pale background and green accent, native radio buttons, the 🦅 eagle logo, and EACL Explorer title. Use this factual subtitle verbatim:

> EACL is a situated ReBAC authorization library inspired by SpiceDB, built in Clojure and backed by Datomic Pro, Datahike, Datalevin or DataScript.

Backend, Storage, and Execution occupy three separate labelled rows. Backend choices contain only backend names. Storage choices and defaults follow the original selector; reuse the existing backend transition and execution-normalization functions. At a fixed viewport, reserve the execution row's required height so changing backend cannot move the rows or the following panel. Native radios show selection, and disabled controls show an informative reason without strikethrough. No dropdowns, storage descriptions in backend choices, or large backend cards.

Consistency Mode is a collapsible section with a compact native-radio row above exploration, with all four mode names visible. Preserve Re-query, Refresh Snapshot, selected basis, supporting date/freshness controls, without a Semantics action/dialog or descriptive cards. Cache read/populate switches and the existing diagnostics remain accessible. Do not add global query-evidence or activity dashboards.

The resource pane takes most desktop width; the access inspector remains approximately 300–370px. Stack the inspector below the tree on narrow screens. Use at least 16px resource identifiers, 14px latency values, and 12px cache badges in both densities. Compact mode reduces spacing rather than shrinking essential text. Counts remain prominent, with their own timing/cache metadata directly adjacent. Information density and usability take priority over decoration.

### 2. Extract the principal picker without changing subject discovery

Move the existing quick users and `SubjectsPanel` 25-user page behavior into a fixed-height View As dialog. Add a schema-derived subject-type selector and send the selected type/ID through actual EACL queries. The existing runtime lists user-role records with `list-subjects`; the isolated preview browses other resource types with bounded `lookup-resources` under the canonical super-user. That is fixture discovery, not a new global search API. Preserve errors, paging, Escape, and focus restoration, and keep dialog height stable across types, empty pages, and loading.

Use the existing state setter for principal transitions. Clear the inspector selection on a principal change for an unambiguous first version. Keep independent Subject type/ID and Resource type/ID groups in the floating permission checker, plus permission selection and discovered-ID autocomplete; do not add a redundant independence label. Cosmetic expansion may remain, but mounted queries must re-scope and old results must disappear. Do not introduce a new text-search feature in the principal picker.

### 3. Keep query controllers; replace the nested card presentation

Keep `ResourceTypeGroup`, `RelationshipGroup`, `ResourceNode`, `LatestRequest`, and their existing `app.runQuery` paths as the initial data/controller boundary. Extract reusable row/disclosure presentation rather than rewriting transport logic. Roots continue to call `lookup-resources` and `count-resources`; relation groups continue to call `list-relationships` with authorization subject and permission.

A resource has distinct label selection and square disclosure. A resource's children are labelled schema relation groups such as `Servers via :account`; those groups reveal paginated authorized children. Type-root counts are unique authorized objects of that type. Relation-group counts are scoped to that relationship. Counts must never be summed across appearances to imply a unique dataset count.

Retain the current count escalation from 1,000 toward its 30,000 UI ceiling, independent page/count requests and timing, exact/lower-bound presentation, observed-range correction, explicit first/previous/next controls, and invalid-cursor recovery. The local preview uses actual first/previous/next cursors and counts starting at 1,000, doubling on request up to the original 30,000 ceiling. Count values retain their own adjacent latency/cache metadata and remain visible after collapse. Full production controller/recovery qualification remains apply work.

Key expansion by a bounded traversal path including root, object identity, and relation identity; maintain an ancestry set for cycle termination. Keep one roving keyboard focus key and reconstruct the visible-row sequence from rendered, expanded pages. Do not conflate selection and expansion. Implement Collapse all as a presentation action with focus repair. Do not implement recursive Expand all: EACL's relationship graph and million-resource profiles make eager traversal inappropriate.

Do not add loaded-resource or known-user text filtering. It is not an EACL search capability and produces browsing-dependent partial results. Keep the original paginated discovery and independent permission checker.

Virtualization is conditional on measured DOM/interaction cost, not a prerequisite. Existing page limits and lazy expansion bound the initial change; viewport virtualization would require separate focus/ARIA and variable-row treatment, particularly for nested page errors.

### 4. Preserve a full access inspector with progressive detail

The inspector identifies type, name, ID, and selected traversal context. Compact decision rows place each permission result and its latency/cache metadata together. Native radio choices or the existing per-permission sections expose reverse lookups and page controls, with the returned count and latency together. Changing the reverse lookup permission does not change the tree's discovery permission.

The narrow rail must not squeeze away IDs, attributes, decision evidence, or pagination. Use an Inspect resource disclosure/dialog for full attributes and overflow details. A labelled View As action on a reverse result changes the principal; simply inspecting a holder does not silently impersonate it. Do not turn an observed relationship path into a “why allowed” proof without backend explanation evidence.

### 5. Compact, unchanged consistency controls

Render all four named modes as compact native radio options above the tree, with the active mode selected and unsupported modes clearly disabled with informative reasons and no strikethrough. Use an inline collapsible section rather than a dropdown or a settings dialog; keep the selected basis beside Refresh Snapshot. Keep distinct Re-query/Refresh Snapshot actions visible. Remove the Semantics action and dialog; retain informative inline mode reasons, and supporting freshness/date inputs appear adjacent to the selected mode in the connected implementation. Preserve all current controls and explanatory text, including:

- The ordered mode set: minimize-latency, at-least-as-fresh, at-exact-snapshot, fully-consistent.
- Descriptor-driven availability and fully-consistent limitation immediately discoverable beside the selector.
- Relative floor anchored to the selected snapshot date; absolute floor input and its refresh reset behavior.
- Exact datetime input only when supported; otherwise its descriptor reason. Supported date resolution remains latest available immutable snapshot at or before the datetime.
- Selected capture time/revision and independently served response basis; refreshing a fixed profile does not imply advancement.
- Snapshot refresh busy/error states and current request cancellation/basis-generation invalidation.

Do not change `state.tsx`'s basis semantics to suit a simpler UI. Treat selected mode/basis as user intent and response basis as evidence, not interchangeable labels.

### 6. Preserve technical controls through a feature map

| Existing surface | Proposed home | Preservation acceptance |
| --- | --- | --- |
| Header quick/known subjects | Top-right View As picker | Typed subjects; quick users; fixed 25-object pages; first/previous/next; errors/retry; focus |
| Backend/storage/execution selectors | Three stable native-radio rows | Backend names only; original dependent storage/execution choices and defaults, explicit unavailable state/reason, conditional browser runtime, canonical navigation |
| Startup, health, deployment warning | Environment status and local status banners | Actual startup elapsed time, failure/retry, identity mismatch blocks readiness |
| SchemaPanel / SchemaGraph | Schema workspace view or expandable panel | All nodes, relations/permission expressions, graph toggles/preferences, actual supported editing |
| CachePanel | Original read/populate switches and diagnostics | Independent read/populate switches, refresh, captured metrics, raw data, capability-gated eviction |
| ConsistencyPanel | Compact native-radio row + existing semantics | Entire behavior listed above |
| ResourceTreePanel | Large resource pane | Type roots, permissions, child paths, cycle handling, bounded counts, page navigation, independent timing/retry |
| DetailPanel | Right access inspector | Every permission decision and paginated reverse lookup, independent failures, resource details |
| CanPermissionFooter | Collapsible floating permission checker | Independent arbitrary check inputs, schema-supported types/permissions, cache/consistency, metadata/cancellation |
| Add resources / SeedProgress | Dataset control with persistent progress banner | Limits/validation, progress, inert/busy exploration, polling/retry, local modifications/reset messaging |
| MetaTiming / response metadata | Immediately beside each query result and count | Preserve `elapsedMs` and `cacheStatus` metadata where supplied; distinguish operations and bases |
| Source/version footer | Navbar source links + copyright footer | Prominent navbar source links and original copyright footer; preserve identity checks internally, without a Runtime Identity control |
| URL/history/preferences | Existing state/URL controllers | Bounded portable semantic state only; no cursor, native revision, secret, or basis-token serialization |
| `caveats.html` / LocalCaveats | Existing independent local playground | Route and full caveat/expiry/schema/relationship operations unchanged; smoke before completion |

During apply, audit the current code again against this table. If any existing affordance was missed, preserve it and amend the table before removing its original home.

### 7. Preserve query-local counts and timings

Use the existing `MetaTiming` model: query/result, count, latency, and cache status stay together. Do not separate latency into a table column, distant rail, global “last query” summary, or query-activity dashboard. Every count query retains its own timing rather than borrowing lookup timing. Page item counts likewise stay beside their lookup latency. Count completeness and bounded-count escalation remain explicit, and collapsing a queried branch must not hide its count or timing.

In the local runtime's relationship adapter, do not show a candidate count. Show the number of authorized rows in the returned linked-object page with the traversal badge, whose tooltip explicitly excludes the subsequent checks. Each displayed object's permission check has its own timing badge. The runtime provides no authorized relation total, so do not invent N for these groups. Root rows display their actual range and bounded total, each with its own badge. Keep individual served basis/request details attached to the corresponding metadata. A cache-read preference is not evidence of a hit.

Navbar object/relationship totals use actual `count-objects` responses but omit their timing badges; they are inventory totals, not authorization counts. The runtime calls its resource-role inventory `objects`; no separate principal total is displayed. Existing cache diagnostics and qualified storage-comparison rules remain available; no new global benchmark or aggregate-evidence feature is introduced.

### 8. An isolated local preview over the canonical runtime

`docs/design-preview/index.html`, `styles.css`, and `app.js` provide the review shell. Build the existing browser runtime with `npm run build:datascript-runtime`, then run `node scripts/preview-explorer-design.mjs`. The loopback server at `127.0.0.1:5198` (override with `EACL_DESIGN_PORT`) allowlists the three preview assets, the compiled runtime, the two existing pure selection/platform modules, and one metadata document. It verifies the runtime SHA-256 and canonical schema digest before serving. Metadata comes from the checked-in schema, fixture manifest, backend/storage catalog, and existing platform-selection module. No external service, package dependency, production entry point, schema, fixture, or runtime source is changed.

The preview calls `window.EaclDataScriptRuntime` using the pinned EACL Core artifact and the original 10,000-resource browser snapshot: 80 user records, 38,613 relationships, all six definitions, 13 relations, and nine permissions. Resource IDs are displayed unchanged. There is no replacement fixture or local decision helper. The schema view displays the runtime wire schema and exact `fixtures/schema.v1.zed` source. Intentional account/server cycles and parent chains remain intact; the tree detects repeated ancestors only to bound visual traversal.

Root queries use actual lookup/count operations; nested groups adapt the runtime's reverse relationship traversal by checking each candidate's permission, preserving bounded page cursors. Traversal timing and each displayed object’s permission-check timing remain separately attributable; no candidate label is rendered. Independent permission checks, reverse subject lookup, 25-user subject pages, and cache diagnostics also use runtime operations. Only actual `elapsedMs` and `cacheStatus` are displayed; an absent cache status is not replaced by an invented badge. These are local browser operation latencies, not transport latency or a backend benchmark.

The local runtime supports only minimize-latency and a page-lifecycle basis. The other three native-radio modes and Refresh Snapshot remain visible but explicitly unavailable; no simulated snapshot guarantees are presented. Server backend radio choices show existing selector options with explicit disconnected status and do not route their queries to DataScript. Changing the principal/profile/cache/page-size scope clears old results and invalidates asynchronous completions. Cosmetic root expansion remains; descendant pages restart on a scope transition.

Full production retry/cancellation/recovery qualification, schema graph controls, historical/freshness basis selection on supporting profiles, cache eviction, connected seeding qualification, deployed identity handshakes, canonical URLs, and the caveats/expiry playground remain mandatory connected apply work. The original application and these features remain unchanged while the isolated design is reviewed. The README records current observed verification and limitations.

### 9. Preserve the stress-test data contract

This change is presentation-only with respect to authorization semantics. Retain `fixtures/schema.v1.zed`, `fixtures/schema-wire.v1.json`, fixture generation/manifests/exemplars, actual identifiers, recursive permission expressions, duplicate handling, and intentional cycles. Do not introduce application/service aliases or an alternative authorization helper for visual appeal. Verify unchanged schema and fixture diffs, the manifest digest, all eight existing decision exemplars, the 64-server `user-1` result, parent-cycle termination, and actual reverse lookup membership in the local preview. Connected regression qualification still uses the existing comprehensive suites.

## Risks / Trade-offs

- **Presentation changes accidentally alter request semantics** → Extract visual rows around existing controllers, run scope/basis/history tests, and verify real response contexts during connected qualification.
- **Tree gets mistaken for a complete authorization graph** → Label relation paths, query completeness, page boundaries, and cycles; avoid unsupported access explanations.
- **Information becomes too dense or too small** → Keep type color restrained, verify real desktop/phone layouts and contrast, offer compact rows as an option, preserve readable IDs in expanded details.
- **Principal picker removes discoverability of known users** → Put current principal in the header continuously; retain quick users and paginated browse in one opening action.
- **Reduced visual clutter hides consistency limitations** → Keep every mode and its unsupported reason visible; expose full descriptor text next to the relevant option.
- **Prototype mistaken for completed integration** → Explicit local DataScript context, actual response evidence, disconnected server-profile states, separate route/build inputs, and explicit unchecked connected implementation tasks.
- **Concurrent consolidation change drifts** → Reconcile against current controllers/contracts at apply time; avoid editing or archiving the other active change.

## Migration Plan

1. Review the isolated preview and finalize the visual direction in this branch.
2. Apply the redesign to the shared SolidJS components while retaining existing state/API boundaries. Start with the principal picker and shell, then tree rows, inspector, and evidence placement.
3. Qualify the behavior-preservation matrix, accessible responsive layouts, and actual supported consistency modes on available local profile fixtures. Record unavailable integration environments explicitly rather than replacing them with a mock success.
4. Build the normal explorer artifact and use the repository's ordinary review/delivery process. No deployment is part of the proposal.
5. Roll back by reverting the shared presentation changes; no data migration, schema migration, backend release, or persistent data rollback is required.

### 10. Document flow and original controls — 2026-09-09

Remove the repeated EACL Explorer heading; keep the title in the navbar. Move both source links and object/relationship counts into the navbar before View As. Use Title Case for headings and the original copyright notice. Remove the Backend & Storage heading, local-design label, runtime-identity action, healthy-runtime slogan, redundant Accessible Resources/scope labels, and idle checker sentence.

The resource tree follows document flow with no internal scrolling. Root and relationship pagination belongs to the branch heading row, with visibly bordered Prev/Next buttons; wrap within that branch at narrow widths. Keep `via :parent` beside the type name. Hide API operation names in the tree; detailed request/basis attribution remains on timing tooltips. Move Collapse All to the tree toolbar and Page Size to the top right.

The checker is fixed at the viewport bottom with document padding measured by ResizeObserver so the last rows remain reachable. Subject and Resource groups each contain type and ID. ID datalists use discovered objects, as the original checker did, rather than implying EACL text search. On phones the checker starts collapsed and expands into a bounded, scrollable form with a readable disabled Check Permission button. The header remains available by normal document scrolling.

DataScript additions use the unchanged seed-start/status/retry operations, advertised maximum, progress, and bootstrap refresh. Disable exploration during seeding while keeping backend choices enabled; clear prior query scopes/cursors and refresh inventory counts/basis when it finishes. Additions are page-local and reload restores the canonical fixture. No fixture or schema file is modified.

### 11. Stable viewport and reactive controls

Move the theme button before View As, which is the rightmost navbar control. Place Seed Data beside the object count. Its existing local seed operations run against the DataScript owner independently of the active backend, so changing backend cannot interrupt progress polling or relabel results as another backend's data. Render a progress bar and completed/target values; server profiles remain disconnected and cannot issue seed writes.

Backend, Storage, Execution, and Consistency Mode use plain native radios, without surrounding button borders. The consistency panel uses the standard panel background. Display Browser In-memory, enlarge disclosure and snapshot controls, and place Basis before the adjacent Re-query/Refresh Snapshot buttons. Remove Semantics and its dialog entirely. Move Page Size into the tree toolbar in place of the density icon, include the type icon inside the resource ID's selection action, and spell out First.

Place the expanded exact schema source before the inferred type cards. Rename the floating checker heading to Check Permission and restore the original 175 ms input debounce. Capture all typed identifiers/options before awaiting requests; invalidate stale responses, skip incomplete inputs, and retain manual checking.

Keep the viewport stable during page/scope/render transitions. Disable automatic scroll anchoring, restore focus with preventScroll, and preserve sufficient document height when loading or shorter results would otherwise clamp the current offset. Restore the offset through the immediate layout/focus frames, but cancel that restoration on new wheel/touch/key/pointer input so the user retains control. Explicit keyboard tree navigation and View Access still provide intentional navigation.

## Production integration (2026-09-09)

The user explicitly authorized integrating the approved design, upgrading to the latest published core commit from the local core checkout, committing/pushing, merging through main into production, and verifying the ordinary deployment. This supersedes the earlier preview-only deployment exclusion. Core is pinned to `6c3f33f2449ea10ba56b88b3e9d9f076b1ab2d56`. The canonical schema and generator remain unchanged.

The shared SolidJS shell retains the existing profile dispatcher, response validation, basis/freshness controls, and cursor recovery. Resource controllers are retained with path-specific expansion keys. View As is a typed, lazy dialog. The inspector issues reverse lookup only for its selected permission and still checks all available permissions independently. The schema/graph mounts on first visit, avoiding hidden graph initialization. Read/populate and permission changes preserve selection. Counts and their query metadata remain adjacent.

The DataScript cap is removed from runtime, UI, and local-only contract validation. Seed Data defaults to 10,000. The ordinary server request contract still rejects seed mutations. The shared production profile lifecycle retains its cancellation-on-release behavior: changing backend releases the browser dataset and cancels its seed job, rather than continuing a hidden runtime. Backend controls remain enabled. The isolated preview continues its original owner-pinned seeding experiment; production follows the existing validated release lifecycle.

Verification: TypeScript checking; explorer-state (91), contracts (61), shared UI (4), parity (10); desktop/mobile design interactions and light/dark accessibility; canonical DataScript seeding, partial failure/retry, and 110,001 total objects; supporting Datomic historical-date and Datahike relative/absolute freshness browser scenarios; DataScript bundle isolation. Ordinary production deployment is the final delivery gate.
