# EACL Explorer Design Preview

```sh
npm run build:datascript-runtime
node scripts/preview-explorer-design.mjs
```

Open [the local preview](http://127.0.0.1:5198/?theme=light). `EACL_DESIGN_PORT` overrides the loopback port. Stop with Ctrl-C.

Branch: `design/resource-first-explorer`. OpenSpec: `openspec/changes/redesign-resource-first-explorer/`.

## Current Layout

- One navbar title with the 🦅 logo, prominent EACL/Demo Source links, object/relationship counts without timings, Seed Data beside Objects, theme toggle, and rightmost View As. No separate principal count.
- Exact subtitle: “EACL is Situated ReBAC Authorization Library backed by Datomic Pro, Datahike, Datalevin or DataScript.”
- Collapsible Backend/Storage/Execution controls with plain native radios matching Consistency Mode, original compatible-choice behavior, and stable row positions across backend changes. No redundant section heading.
- Collapsible Consistency Mode with native radios, informative disabled reasons without strikethrough, the standard panel background, and Basis before the adjacent enlarged Re-query/Refresh Snapshot buttons. No Semantics action or dialog remains.
- Page Size at the top right inside the tree, replacing the density icon; navbar Seed Data controls with the advertised limit, progress bar, and retry. Backend selection remains enabled during seeding.
- A document-flow resource tree, with Collapse All above it. No internal tree scroll window, duplicate scope heading, API-operation labels, or candidate counts.
- Root ranges and counts share the branch heading row with visibly bordered pagination buttons. Page and count queries retain separate combined latency/cache badges. Queried counts remain visible when collapsed; bounded counts still expand from 1,000 toward the 30,000 ceiling. At phone widths the controls wrap within their branch row.
- Fixed-height View As dialog with all schema types and bounded pages. The current subject type and ID are passed to EACL.
- A collapsible floating Check Permission checker with Subject type/ID, Resource type/ID, Permission, and Check Permission. Complete input changes automatically re-query after the original 175 ms debounce; stale responses are discarded and incomplete inputs clear the result. Autocomplete uses discovered IDs, as the original checker did. It makes no text-search request and keeps a bounded set of suggestions. The checker starts collapsed on phones; document padding tracks its actual height so the last rows remain reachable.
- The original EPL 2.0/copyright footer. No Local Design label, Runtime Identity link, healthy-runtime slogan, idle checker sentence, or independent-selection caption.

## Runtime and Data

This isolated preview calls the existing compiled EACL DataScript runtime. It starts with the original 10,000 resource-role objects, 80 user records, and 38,613 relationships. The runtime names that resource-role inventory `objects`; no count is presented as the total number of potential principals. All six definitions, 13 relations, nine permissions, recursive parents, IDs, and intentional cycles are unchanged.

Canonical schema SHA-256:

```text
7fa7ae57dec4e442c66815ea74a63b08f12a79d7e9a716ebc8f1d6b03ee2262c
```

The existing artifact is pinned to EACL Core `d153cd767a62440d133f01abaacfc3eb2edfe8c7`. The loopback server verifies the runtime/schema artifact digests; the browser verifies schema and manifest identities. Production source, runtime source, schema files, fixture manifests, and generators remain unchanged.

Only DataScript is connected in this preview. Server profiles display their existing catalog options and an explicit disconnected status; they make no remote requests. DataScript supports minimize-latency and no snapshot refresh operation. Other modes remain disabled with reasons, not simulated guarantees. Supporting production profiles' freshness/history controls remain mandatory connected implementation work.

### Typed Subject Discovery

The runtime's `list-subjects` operation enumerates its user-role records only. View As uses it for 25-user pages. For account, platform, server, team, and vpc pages, the preview calls existing bounded `lookup-resources` with the canonical `user:super-user` and `view`. It does not load the full object inventory or invent a list/search API. Selecting a result then uses its real subject type/ID for tree and inspector queries. The unchanged stress-test permission schema primarily resolves through user relations, so selecting another object type need not produce an allow.

### Query Timings and Relationship Pages

Every badge uses its specific runtime response's `elapsedMs` and optional `cacheStatus`. These are browser-local operation measurements, not HTTP round trips or cross-backend benchmarks. Missing cache status is not replaced by an invented hit/miss.

Roots use separate `lookup-resources` and `count-resources` calls. The navbar uses actual `count-objects` calls for object and relationship inventory, refreshed after seeding; their timings are intentionally omitted from the navbar.

The removed “5 candidates” label was the size of a `reverse-relationships` response. That runtime operation scans the in-memory relationship collection for the selected object/relation, deduplicates linked objects, sorts, and returns a bounded page. The preview then checks the selected permission for each returned object of the target type and renders the authorized results. It now says only how many results are shown; it does not claim a total authorized relation count. The branch badge measures traversal only, and each displayed object has its own permission-check badge. Tooltip text preserves this distinction. No unmeasured total or combined traversal/check timing is fabricated.

### Local Additions

Seed Data uses the unchanged `seed-start`, `seed-status`, and `seed-retry` operations. Validation respects the 100,000-resource browser ceiling. Exploration is disabled during seeding, but backend choices stay enabled. The job and progress polling remain pinned to the original DataScript runtime when the selected backend changes. Completion refreshes bootstrap/basis and inventory counts and resets scoped pages, counts, decisions, and cursors. Additions are page-local; reloading restores the canonical fixture. No fixture/schema file is edited.

## Verification — 2026-09-09

- Ten existing selection/platform and local-seeding contract tests passed.
- JavaScript syntax, strict OpenSpec validation, and whitespace checks passed.
- Backend/Storage/Execution row positions and panel heights were identical across all four backends at each checked width: 1440, 768, and 390px. No horizontal page overflow occurred.
- Disabled Check Permission contrast measured 4.98:1 in light mode and 6.71:1 in dark mode; options had no computed strikethrough.
- View As listed users, 11 accounts, the single platform, and 25-server pages. Dialog height remained 650px at the checked desktop size. Known-user Next displayed 26–50 of 80; closing restored focus to the header trigger.
- Selecting `account:account-0` produced actual typed tree queries and a typed checker denial, consistent with the unchanged schema. User allow/deny checks and real miss/hit/disabled cache outcomes were verified.
- Root Next changed 1–20 to 21–40, with independent page/count timing badges. Super-user count escalation displayed 1,000+ then 2,000+ and preserved the latter count/timing after collapse. The existing full escalation to 9,922 was verified in the preceding revision.
- Parent traversal terminated at the original cycle boundary; tree operation labels and candidate text were absent.
- Adding three resources yielded 10,003 objects, 38,617 relationships, five accessible accounts, and 66 accessible servers for user-1. The basis advanced, suggestions included discovered IDs, and reload restored 10,000/38,613.
- The tree computed to `overflow: visible` and `max-height: none`; the phone checker started collapsed at 42px and expanded into grouped controls. Light/dark phone and desktop layouts were inspected.
- No browser console entries were observed in the checked session.

This is the local design stage. Production controller/recovery qualification, complete schema graph controls, supporting server profiles' historical/freshness semantics, cache eviction, deployed identity/availability, canonical URLs/history, and the caveats/expiry playground remain connected apply tasks. The existing production application retains those features.

### Subsequent Control Revision Verification

- Automatic checker behavior returned the expected denial for user-2/admin/account-0 and allow for user-1 without submitting; clearing the Subject ID via keyboard cleared the result and disabled submission.
- A 1,000-object seed showed intermediate progress (600/1,000) with zero disabled backend choices. Switching to Datahike during the job still reached 1,000/1,000; returning to DataScript showed 11,000 objects and 39,623 relationships.
- Instrumented pagination retained the click-time offset through settled results (364.5px in the measured case). The browser test driver's pre-click scrolling was distinguished from application updates. Temporary instrumentation was removed. New user scroll/key/pointer input cancels pending viewport restoration.
- The resource type icon selected the resource; First is written out; Page Size is inside the tree. Schema source is open and precedes the inferred type cards. No Semantics button or associated screen remains.
- At 390px there was no horizontal overflow, View As was the rightmost navbar control, no navbar timing badges existed, and configuration/consistency panels shared the same background in both light and dark modes.
- Ten existing selection/platform/seeding contract tests, syntax checking, and strict OpenSpec validation passed. No schema, canonical fixture, runtime, or production source files changed.
