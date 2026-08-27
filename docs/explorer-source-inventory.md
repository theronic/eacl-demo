# Explorer source parity ledger

This ledger records the line-by-line comparison used by the consolidated
Explorer. The visual and interaction authority is the current source in:

- `../eacl-datahike-demo/client/src` (the repository present locally for the
  user-requested `eacl-datahike-solidjs` comparison), at commit
  `06d8141a0cfebbd3b423cd719f9f05eb94ca50aa` plus its current worktree;
- `../eacl-datomic-solidjs/client/src`, at commit
  `8774ef39bc3e7d63d6a1be0bb9630b786a3d0a2a` plus its current worktree.

Those worktrees are comparison inputs only. They are not modified by the
consolidation. `scripts/explorer-ui-parity-policy.test.mjs` checks exact source
digests, the stylesheet union, canonical layout order, the Detail-panel union,
page-size parity, response metadata, and that the DataScript entry owns no
presentation component or stylesheet of its own on every static deployment.

## File reconciliation

| Source area | Datahike lines | Datomic lines | Consolidated lines | Reconciliation |
| --- | ---: | ---: | ---: | --- |
| `App.tsx` / `Explorer.tsx` | 139 | 116 | 145 | Datahike Explorer layout unchanged; the shared App coordinates profile selection and transport injection, while the backend/storage selector remains immediately after the original header. |
| `api.ts` | 182 | 176 | 200 | Datahike request behavior unchanged; only an injected profile dispatcher was added so the same components can call the selected backend. |
| `format.ts` | 16 | 16 | 16 | Byte-identical to both sources. |
| `preferences.ts` | 83 | 78 | 83 | Byte-identical to Datahike, including cache population and the original default page size. |
| `state.tsx` | 389 | 248 | 392 | Datahike state retained; `current` was added as the safe mixed-profile default and unsupported saved modes normalize to the descriptor default. |
| `styles.css` | 1661 | 1502 | 1736 | Exact Datahike stylesheet plus the exact Datomic permission-decision rule block and two inert audit markers. No selector-specific styling was added; the selector reuses the original consistency-panel classes. |
| `types.ts` | 189 | 149 | 190 | Datahike types retained plus the mixed-profile `current` consistency mode. Original page sizes 10/20/50/100/250/500/1000 are retained. |
| `CachePanel.tsx` | 230 | 193 | 230 | Byte-identical to Datahike. |
| `Common.tsx` | 206 | 206 | 206 | Byte-identical to both sources, including timing/cache badges, pagination, loading, errors, disclosures, and type badges. |
| `ConsistencyPanel.tsx` | 194 | absent | 195 | Datahike component plus the descriptor-backed `current` mode. |
| `DetailPanel.tsx` | 231 | 346 | 364 | Union: Datomic per-permission `can?` decisions plus Datahike basis, consistency, cache-population, generation invalidation, pagination, retry, and stale-request behavior. |
| `Header.tsx` | 153 | 149 | 155 | Datahike header behavior retained. Only backend/storage text and the consolidated source link replace backend/SolidJS-specific copy. |
| `ResourceTree.tsx` | 742 | 643 | 742 | Byte-identical to Datahike, including escalating bounded counts, cursor recovery, relationship expansion, cache controls, consistency, retries, and timing badges. |
| `SchemaGraph.tsx` | 151 | 151 | 151 | Byte-identical to both sources. |
| `SchemaPanel.tsx` | 214 | 210 | 214 | Byte-identical to Datahike. |
| `SubjectsPanel.tsx` | 237 | 229 | 237 | Byte-identical to Datahike. |

Both static entries instantiate `apps/explorer-main/src/App.tsx`, which in
turn instantiates the single `Explorer.tsx` and `components/*` tree above.
`apps/explorer-datascript/src/App.tsx` contains only the direct browser-runtime
transport wiring. Its entry imports `apps/explorer-main/src/styles.css`
directly. The former alternate `ServerExplorer.tsx` and DataScript-local
stylesheet were deleted, so there is no second deployed presentation surface
that can drift.

## Preserved feature inventory

The consolidated Explorer preserves the original header, source links, ready
and server-count pill, page-size control, conditional seed control, theme
control, Lambda startup timer and retry, bootstrap loading/error retention,
seed progress/error state, schema text/graph/presets, cache enable/populate
controls and cache snapshot, consistency/read-basis panel, paged subjects,
permission selection, resource groups, page ranges, escalating counts from
1,000 through 30,000, retained settled data during refresh, scoped stale-result
suppression, cursor first/previous/next recovery, relationship expansion,
cycle guards, per-request elapsed/cache badges, resource detail, independent
per-permission decisions, reverse permission-holder paging, light/dark themes,
reduced motion, focus states, responsive breakpoints, empty/loading/error
states, and the original three-column Subjects/Resources/Detail layout.

The only new visible control is the Backend & Storage section. It uses radio
options and the original panel/radio classes. DataScript is a separate same-tab
route and deployment of the same component tree. Backend-specific framework names, dashboard/report copy, deployment
statistics, verified-fact cards, and storage statistics are not part of the
Explorer UI.

## Contract adaptations required for parity

The original clients render `elapsedMs` and `cacheStatus`, so `explorer.v1`
now carries those optional success metadata fields. JVM boundaries measure
elapsed execution time; EACL-backed handlers attach `hit`, `miss`, or
`disabled` before transforming results. The selected-profile adapter preserves
both fields rather than discarding them.

The original clients also offer page sizes 250, 500, and 1000. The shared
request validator, response schema, client preferences, URL state, and active
JVM handlers therefore use a maximum of 1000 and the original default of 20.
The 1 MiB serialized response ceiling remains authoritative.

The direct DataScript page runtime implements the same `lookup-resources`,
`count-resources`, `lookup-subjects`, and `authorize` operations consumed by
the canonical Explorer adapter. It returns runtime-measured elapsed time and
EACL cache provenance, so the same paging, bounded-count, permission-holder,
and per-permission decision components behave identically without a UI fork.
