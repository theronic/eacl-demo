## Context

See `proposal.md` for motivation and `specs/resource-first-explorer/spec.md` for the behavior contract. The proposal branch is `design/resource-first-explorer`, created from the clean `agent/record-legacy-storage-retirement` checkout. The workspace parent is not a Git repository; the affected repository is `eacl-demo`.

The connected application is SolidJS. `Explorer.tsx` composes Header, ProfileSelector, SchemaPanel, CachePanel, ConsistencyPanel, a three-column Subjects/Resources/Detail grid, CanPermissionFooter, and ExplorerFooter. The presentation already sits above substantial request scoping, basis generation, cancellation, pagination, and response identity machinery. This redesign must preserve that machinery.

The existing main spec tree contains `release-identity`, `datascript-landing-page`, and `datascript-local-seeding`. The broader shared-shell requirements are still an active delta in `consolidate-eacl-demo-backends/specs/unified-demo-shell/spec.md`. Some prose in the user guide and older planning artifacts differs from current source behavior (for example default backend and available profiles); the apply phase must use the deployed descriptor and current source as its operational authorities, and reconcile relevant documentation without changing the other active proposal.

### Reference evidence

Inspected locally on 2026-09-08; these are source references, not claims of live reference-app verification:

| Reference | Relevant evidence | Adaptation |
| --- | --- | --- |
| `~/code/0tx/ztx-solid/src/ledger/tree/LedgerRow.tsx` | Separate square disclosure and journal toggle; count rail; nested child container | Separate expand/select actions and compact aligned metadata |
| `~/code/0tx/ztx-solid/src/accounts/tree.ts` | Filled/outline plus/minus states, explicit empty-child text | Accurate branch/leaf state, no misleading expandable leaf |
| `~/code/peach/peach-roadmap/public/explorer/app.js`, `buildOrgTree` | Explicit comment attributing tree to 0tx; persistent collapse state; fuzzy local filtering; ancestor retention; visible-row keyboard movement; distinct navigation/filter actions | Preserve branch context and keyboard model; adapt filtering to loaded EACL pages |
| `~/code/peach/peach-roadmap/public/explorer/styles.css` | Compact rows, disclosure/count styling, selected row state | Hierarchy guides and restrained use of type color |
| `~/code/eacl/eacl-edrive/client/src/App.tsx` | Top-right avatar/account menu and user-switch actions | Header principal selector with current identity visible |

The reference repositories are read-only for this change. No financial data, company datasets, or private reference assets are copied into the preview.

## Goals / Non-Goals

**Goals:**

- Make the forward/reverse query relationship understandable from the two-pane arrangement and language.
- Keep query context near the result, with all consistency modes visible above exploration and latency/cache evidence beside each result.
- Reuse validated operations and request lifecycles while changing presentation and navigation.
- Provide a reviewable local prototype before converting the connected explorer.

**Non-Goals:**

- A new authorization engine, backend optimization, cache policy, server search API, wire-contract change, schema change, fixture replacement, renamed resources, or simplified stress-test topology.
- Unbounded expand-all, speculative descendant prefetch, or whole-dataset browser materialization.
- A fabricated benchmark dashboard or a ranking of different backends at different scales.
- Redesigning eDrive, Peach, or 0tx, deploying the site, or replacing the independent local caveats/expiry playground.

## Decisions

### 1. One coherent workspace with two visual treatments

Use a neutral pale background, white panels, deep green accent, small type-specific icon treatments, restrained borders, and a corresponding dark palette. The header retains the existing 🦅 eagle emoji logo and top-right principal trigger. A concise introduction sits above always-visible backend cards, storage and execution choices, and a prominent four-card consistency panel. All supported backend/storage names must be visible without opening a dropdown. Execution choices remain visible with unsupported combinations disabled and explained. The live shell must retain descriptor-driven availability; local preview cards for server profiles explicitly say they are not connected. Resource navigation receives approximately three quarters of available desktop width; the inspector uses a bounded 300–370px rail. On smaller screens the inspector follows the tree with an explicit reachable selection target.

Use at least 16px resource identifiers and 14px operation timing in either density; compact mode reduces padding, not those font sizes. Use at least 12px cache badges and readable supporting text. The prototype offers light/dark and comfortable/compact variants of one interaction model. Multiple unrelated dashboard concepts would dilute the review; these variants let the user assess density and visual character while comparing identical functionality. A draggable divider is deferred because it adds interaction and preference complexity without being necessary to establish the layout.

### 2. Extract the principal picker without changing subject discovery

Move the existing quick subjects and `SubjectsPanel` 25-user page behavior into a header-triggered dialog/popover. Keep its selected-user display, errors, recovery, and known-user registration. Use native/dialog focus containment, Escape, and focus restoration. The first implementation supports the current user-principal flow; it must not silently invent arbitrary subject-type selection.

Use the existing state setter for principal transitions. Clear the inspector selection on a principal change for an unambiguous first version. Keep the independent standalone permission check form's inputs; label its separate context. Cosmetic expansion may remain, but mounted queries must re-scope and old results must disappear. A separate local picker filter can narrow only already loaded users unless an existing search capability is found during implementation.

### 3. Keep query controllers; replace the nested card presentation

Keep `ResourceTypeGroup`, `RelationshipGroup`, `ResourceNode`, `LatestRequest`, and their existing `app.runQuery` paths as the initial data/controller boundary. Extract reusable row/disclosure presentation rather than rewriting transport logic. Roots continue to call `lookup-resources` and `count-resources`; relation groups continue to call `list-relationships` with authorization subject and permission.

A resource has distinct label selection and square disclosure. A resource's children are labelled schema relation groups such as `Servers via :account`; those groups reveal paginated authorized children. Type-root counts are unique authorized objects of that type. Relation-group counts are scoped to that relationship. Counts must never be summed across appearances to imply a unique dataset count.

Retain the current count escalation from 1,000 toward its 30,000 UI ceiling, independent page/count requests and timing, exact/lower-bound presentation, observed-range correction, explicit first/previous/next controls, and invalid-cursor recovery. The local preview uses actual first/previous/next cursors and bounded counts at 1,000. Production count escalation and advanced recovery remain mandatory apply tasks.

Key expansion by a bounded traversal path including root, object identity, and relation identity; maintain an ancestry set for cycle termination. Keep one roving keyboard focus key and reconstruct the visible-row sequence from rendered, expanded pages. Do not conflate selection and expansion. Implement Collapse all as a presentation action with focus repair. Do not implement recursive Expand all: EACL's relationship graph and million-resource profiles make eager traversal inappropriate.

Loaded-row filtering is a presentation operation. A transient expansion overlay reveals matching ancestors and clears when filtering ends. It must not trigger discovery beyond already loaded pages or advertise global search. The existing controller can retain bounded loaded pages within a valid query scope for filtering; introducing any new cross-scope response cache is out of scope.

Virtualization is conditional on measured DOM/interaction cost, not a prerequisite. Existing page limits and lazy expansion bound the initial change; viewport virtualization would require separate focus/ARIA and variable-row treatment, particularly for nested page errors.

### 4. Preserve a full access inspector with progressive detail

The inspector identifies type, name, ID, and selected traversal context. A compact decision row shows the active principal's independent results for every schema permission. Reverse lookup sections or permission tabs expose every permission's subject list and page controls, each with local loading/error/evidence. Changing the reverse lookup permission does not change the tree's discovery permission.

The narrow rail must not squeeze away IDs, attributes, decision evidence, or pagination. Use an Inspect resource disclosure/dialog for full attributes and overflow details. A labelled Explore as action on a reverse result changes the principal; simply inspecting a holder does not silently impersonate it. Do not turn an observed relationship path into a “why allowed” proof without backend explanation evidence.

### 5. Consistency modes stay front and center

Render all four named modes as visible options above the tree, with the active mode selected and unsupported modes disabled with a visible reason. Do not put mode selection behind a dropdown or a settings dialog. Keep distinct Re-query/Refresh Snapshot actions visible. Expose the existing detailed semantics in a compact expansion or dialog; supporting freshness/date inputs appear adjacent to the selected mode in the connected implementation. Preserve all current controls and explanatory text, including:

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
| Header quick/known subjects | Top-right principal picker | Quick subjects; fixed 25-user pages; first/previous/next; errors/retry; focus |
| Backend/storage/execution selectors | Always-visible backend cards and storage/execution choices | All supported names discoverable without dropdowns; registry availability/reasons, dependent choices, conditional browser runtime, canonical navigation |
| Startup, health, deployment warning | Environment status and local status banners | Actual startup elapsed time, failure/retry, identity mismatch blocks readiness |
| SchemaPanel / SchemaGraph | Schema workspace view or expandable panel | All nodes, relations/permission expressions, graph toggles/preferences, actual supported editing |
| CachePanel | Visible read/populate switches and measured hit/miss counters; detailed diagnostics panel | Independent read/populate switches, refresh, captured metrics, raw data, capability-gated eviction |
| ConsistencyPanel | Prominent four-mode panel + detailed semantics | Entire behavior listed above |
| ResourceTreePanel | Large resource pane | Type roots, permissions, child paths, cycle handling, bounded counts, page navigation, independent timing/retry |
| DetailPanel | Right access inspector | Every permission decision and paginated reverse lookup, independent failures, resource details |
| CanPermissionFooter | Full-width permission checker below panes | Independent arbitrary check inputs, schema-supported types/permissions, cache/consistency, metadata/cancellation |
| Add resources / SeedProgress | Dataset control with persistent progress banner | Limits/validation, progress, inert/busy exploration, polling/retry, local modifications/reset messaging |
| MetaTiming / response metadata | Inline timing + expandable operation evidence | Preserve `elapsedMs` and `cacheStatus` metadata where supplied; distinguish operations and bases |
| Source/version footer | Compact footer + evidence detail | Existing source links and actual healthy EACL SHA; no invented release identity |
| URL/history/preferences | Existing state/URL controllers | Bounded portable semantic state only; no cursor, native revision, secret, or basis-token serialization |
| `caveats.html` / LocalCaveats | Existing independent local playground | Route and full caveat/expiry/schema/relationship operations unchanged; smoke before completion |

During apply, audit the current code again against this table. If any existing affordance was missed, preserve it and amend the table before removing its original home.

### 7. Evidence rather than decorative performance claims

Keep latency and cache outcomes directly beside pages, counts, independent permission decisions, and reverse lookups. A persistent evidence row shows the latest operation and measured hit/miss/disabled counters for the current query scope. Root evidence stays visible while scrolling its loaded page. Add a bounded, ephemeral Query activity view for inspection; neither activity nor a diagnostics dialog is the sole place to find performance evidence. Feed it sanitized summaries after validated responses settle, not raw bodies or native values. Distinguish backend-supplied elapsed time from separately labelled client round-trip duration. Keep exact operation, principal/resource scope, returned count/completeness, cache metadata, and served basis associated.

The evidence view can expose existing profile, manifest, runtime, and deployment/source identity. It must not create new aggregate performance claims. Retain the existing current, comparable qualified-storage evidence policy. A cache-enabled preference is never rendered as a cache hit. Clear the activity scope across incompatible profile changes; any historical records retained within a session must be unmistakably historical and bounded.

### 8. An isolated local preview over the canonical runtime

`docs/design-preview/index.html`, `styles.css`, and `app.js` provide the review shell. Build the existing browser runtime with `npm run build:datascript-runtime`, then run `node scripts/preview-explorer-design.mjs`. The loopback server at `127.0.0.1:5198` (override with `EACL_DESIGN_PORT`) allowlists the three preview assets, the compiled runtime, and one metadata document. It verifies the runtime SHA-256 and canonical schema digest before serving. Metadata comes from the checked-in schema, fixture manifest, backend/storage catalog, and existing platform-selection module. No external service, package dependency, production entry point, schema, fixture, or runtime source is changed.

The preview calls `window.EaclDataScriptRuntime` using the pinned EACL Core artifact and the original 10,000-resource browser snapshot: 80 principals, 38,613 relationships, all six definitions, 13 relations, and nine permissions. Resource IDs are displayed unchanged. There is no replacement fixture or local decision helper. The schema view displays the runtime wire schema and exact `fixtures/schema.v1.zed` source. Intentional account/server cycles and parent chains remain intact; the tree detects repeated ancestors only to bound visual traversal.

Root queries use actual lookup/count operations; nested groups adapt the runtime's reverse relationship traversal by checking each candidate's permission, preserving bounded page cursors. Traversal latency and authorization-check totals remain separately labelled. Independent permission checks, reverse subject lookup, 25-user subject pages, and cache diagnostics also use runtime operations. Only actual `elapsedMs` and `cacheStatus` are displayed; missing cache outcomes read “not reported.” These are local browser operation latencies, not transport latency or a backend benchmark.

The local runtime supports only minimize-latency and a page-lifecycle basis. The other three modes and Refresh Snapshot remain visible but disabled; no simulated snapshot guarantees are presented. Server backend cards show catalog choices with explicit disconnected status and do not route their queries to DataScript. Changing the principal/profile/cache/page-size scope clears old results and invalidates asynchronous completions. Cosmetic root expansion remains; descendant pages restart on a scope transition.

Production count escalation, full retry/cancellation/recovery qualification, schema graph controls, historical/freshness basis selection on supporting profiles, cache eviction, local seeding, deployed identity handshakes, canonical URLs, and the caveats/expiry playground remain mandatory connected apply work. The original application and these features remain unchanged while the isolated design is reviewed. The README records current observed verification and limitations.

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
