# Resource-first explorer design preview

Run from the `eacl-demo` repository:

```sh
node scripts/preview-explorer-design.mjs
```

Open [the light treatment](http://127.0.0.1:5198/?theme=light) or [the dark treatment](http://127.0.0.1:5198/?theme=dark). The theme button switches between them. Set `EACL_DESIGN_PORT` to select another local port. Stop the preview server with Ctrl-C in its terminal.

Branch: `design/resource-first-explorer`.

OpenSpec change: `openspec/changes/redesign-resource-first-explorer/`.

## What to try

1. Expand Accounts, then Production. Square disclosures expand; resource names select the access inspector independently.
2. Expand Teams or Servers beneath Production. Compare relationship groups with the top-level resource-type roots.
3. Use the top-right principal picker. User 1 and User 2 own different sample accounts; Team Lead can view four sample servers through a team but cannot administer them; Visitor has no grants; Super User sees all 40 resources.
4. Select a server and switch the inspector between Can view and Can administer. Use the explicit Explore as action on a holder.
5. Filter for `payments`, then clear the filter with Escape or the search input's clear control. Matching ancestors open temporarily; clearing restores ordinary expansion.
6. Use arrow keys, Home/End, and Enter in the tree. Change page size to 5, choose Super User, and expand Servers to exercise sample page loading.
7. Inspect at-least-as-fresh and exact-snapshot control layouts. Re-query keeps the sample basis; Refresh snapshot simulates a basis transition. Neither operation contacts EACL.
8. Open Schema, Cache & diagnostics, Query activity, and the standalone permission checker. Change a check input after running it to see the stale result clear.
9. Compare comfortable/compact rows with the density control. At phone width, the inspector follows the tree and View access moves focus to it.

## Scope and limitations

This is an interactive design study with 40 illustrative resources and five sample principals. Its small deterministic decision helper is not an EACL engine. Labels, IDs, and results are sample data; the schema excerpt is taken from `fixtures/schema.v1.zed`, but that schema is not evaluated by the prototype.

The backend/storage/execution controls demonstrate layout, not actual deployed profile availability. The consistency controls demonstrate input placement and context, not real snapshot/freshness guarantees. Timing stays unmeasured. A cache preference does not claim a cache hit.

The connected application's existing features are inventoried in the OpenSpec design and remain mandatory implementation work: real lookups/counts, first/previous/next pagination and recovery, cycles, late-response isolation, all advertised consistency modes, snapshot/date semantics, cache diagnostics/eviction, schema graph controls, local seeding, identity/availability, canonical URLs/history, and the independent caveats/expiry playground. Production source, transports, build inputs, and services are unchanged by this preview.

## Verification record — 2026-09-08

Verified through the Codex in-app browser against the loopback server:

| Check | Observed result |
| --- | --- |
| Light/dark visual inspection | Both rendered with coherent surfaces, type accents, selection, and controls |
| Phone width 390 × 844 | Single-column reflow; document width did not exceed viewport; profile names readable after layout correction |
| Tablet width 768 × 1024 | Both panes fit; no horizontal page overflow |
| Narrow desktop 1024 × 768 | Both panes fit; no horizontal page overflow |
| Default desktop viewport | Both panes and compact context bars rendered; inspected screenshots |
| Expansion and selection | Expanded Servers independently, then selected payments-api; inspector updated |
| Principal switch | Team Lead showed five sample resources (one team and four servers); previous selection cleared |
| Empty principal | Visitor showed zero sample resources and an empty selection prompt |
| Reverse lookup | payments-api showed three illustrative viewers for User 1's selected sample; permissions available separately |
| Sample pagination | Super User Servers showed 5 of 24, then 10 of 24 after Show next |
| Keyboard | Right from an expanded server root moved focus to its first visible child |
| Filter restoration | Filtering revealed ancestors; clearing with Escape restored the collapsed Accounts state |
| Principal search | `visitor` reduced the picker to one visible match |
| Dialog focus | Principal picker restored `principal-trigger`; consistency dialog restored `consistency` |
| Freshness/exact controls | Absolute datetime accepted `2026-09-08T10:30`; exact date control appeared in the exact-snapshot layout |
| Mobile inspector shortcut | View access moved focus to `access-title` |
| Schema and cache | Schema view rendered; independent cache-read toggle changed the visible summary to Cache off |
| Permission checker | Allowed and denied sample results rendered; changing input reset the old result to Ready to check |
| Console inspection | No error or warning entries observed in the checked session |

Also verified:

- `node --check docs/design-preview/app.js`
- `node --check scripts/preview-explorer-design.mjs`
- `openspec validate redesign-resource-first-explorer --strict`
- `git diff --check`
- HTTP 200 for `/`, `/app.js`, and `/styles.css`; HTTP 404 for non-allowlisted docs, repository paths, and API paths.

These checks are prototype verification, not a full accessibility certification or connected EACL regression qualification. The required connected tests and preservation checks are listed as unchecked apply tasks.
