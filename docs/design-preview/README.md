# EACL Explorer design preview

From the `eacl-demo` repository:

```sh
npm run build:datascript-runtime
node scripts/preview-explorer-design.mjs
```

Open [the local preview](http://127.0.0.1:5198/?theme=light). The theme button also provides the dark treatment. `EACL_DESIGN_PORT` overrides the loopback port. Stop the server with Ctrl-C.

Branch: `design/resource-first-explorer`.

OpenSpec change: `openspec/changes/redesign-resource-first-explorer/`.

## Design constraints

The change centers on the original request: move principal selection to the top right, give the resource tree most of the width, and place the smaller subject/access inspector on the right. Preserve original semantics, controls, data, and query information. Usability and information density take priority over decoration.

- Retain the 🦅 eagle logo and EACL Explorer title.
- Use the subtitle exactly: “EACL is Situated ReBAC Authorization Library backed by Datomic Pro, Datahike, Datalevin or DataScript.”
- Keep native radio buttons and three stable Backend, Storage, and Execution rows. Backend labels contain names only; dependent storage/execution choices follow the original selector. Compatible selections survive backend changes. Unavailable options are explicitly labelled and retain their reason.
- Keep the four consistency choices in a compact radio row, with the existing Re-query, Refresh Snapshot, basis context, and semantics access.
- Keep counts prominent. Each query result and count has its own latency/cache evidence immediately beside it. Queried counts remain visible after branch collapse. No separate timing column or global query-evidence/activity dashboard.
- Preserve bounded count expansion: start at 1,000 and double the ceiling on request, up to 30,000. A truncated result displays `+`; an exact result does not.
- Do not add browser-only resource or known-user filtering.
- Keep 16px resource identifiers, 14px latency values, and 12px cache badges in either density. Compact mode reduces padding rather than essential text size.

## Runtime and unchanged data

The preview calls the existing compiled EACL DataScript runtime with its original browser fixture: 10,000 resources, 80 principals, and 38,613 relationships. It retains the original IDs, recursive parents, intentional cycles, and complete six-definition, 13-relation, nine-permission schema. No replacement fixture or local decision helper exists.

The unchanged schema SHA-256 is:

```text
7fa7ae57dec4e442c66815ea74a63b08f12a79d7e9a716ebc8f1d6b03ee2262c
```

The server checks runtime/schema artifact hashes and allowlists the preview assets, compiled runtime, existing pure selection/platform modules, and metadata. The browser checks the returned schema and fixture identities. Production source, canonical fixtures, manifests, generators, and runtime source remain unchanged.

Only DataScript is connected locally. Server profile options use the existing selector semantics but show “Profile not connected” and make no remote requests. DataScript supports minimize-latency only; other consistency modes and snapshot refresh remain visibly unavailable in this preview. Supporting production profiles retain their full consistency requirements in the apply tasks.

## Query evidence

Latency comes from the specific runtime response's `elapsedMs`; cache outcomes come from its `cacheStatus`. These are browser-local operation measurements, not HTTP round-trip measurements or a cross-backend benchmark. An absent cache status receives no invented badge.

Lookup page counts and total count queries retain separate measurements. Relationship traversal shows the actual candidate count with traversal latency, while each displayed candidate's permission decision carries its own timing/cache result. The traversal measurement does not include subsequent checks. Static fixture totals describe the dataset and are not timed authorization queries.

Independent cache read/populate controls and actual provider diagnostics remain available. The preview has no global last-query display or aggregate query-evidence counters.

## What to try

1. Expand Servers as `user-1`: the total is 64, immediately followed by count latency/cache status. The page's item count has its separate lookup timing. Use First/Previous/Next for cursor navigation.
2. Select a server. Inspect admin/view decisions, then use the reverse-lookup radios and five-subject pages. Each result has adjacent latency/cache evidence.
3. Re-query to see genuine cache hits. Disable Read cache and run a check to observe `disabled`, not an invented hit.
4. Choose `super-user`, expand Servers, then click the bounded count. It progresses through 1,000+, 2,000+, 4,000+, and 8,000+ to the exact 9,922 servers. Collapse the branch; its count and timing remain visible.
5. Expand `account-0 → Accounts via :parent → account-1 → Accounts via :parent`. The repeated `account-0` has an explicit cycle boundary; the original relationship is not changed.
6. Switch backends. Backend/Storage/Execution rows retain their positions at a fixed viewport. Datahike DynamoDB / 4 GiB Lambda remains DynamoDB / 4 GiB Lambda when switching to Datomic.
7. Use the principal picker's original quick choices and 25-user pages. Switching principal clears the old inspector and scoped results.
8. Use arrow keys and Home/End in the tree. On narrow screens, View access focuses the inspector. Inspect the complete schema and independent permission checker.

## Verification — 2026-09-08

- Canonical runtime rebuilt against pinned Core `d153cd767a62440d133f01abaacfc3eb2edfe8c7`; identity checks passed.
- All 23 fixture tests passed; canonical schema/fixture/production-source diffs remain empty.
- All eight existing selection/platform tests passed.
- The eight canonical allow/deny examples were checked through the runtime-backed permission checker, including recursive and cyclic cases.
- Browser checks returned 64 servers for `user-1`, and count escalation reached the exact 9,922 for `super-user`. Count latency/cache stayed adjacent and remained visible after collapse.
- Backend rows and panel height stayed identical across all four backends at each checked width: 1440, 768, and 390px. No horizontal page overflow occurred. Compatible DynamoDB / 4 GiB Lambda selection survived Datahike → Datomic.
- Native profile, tree-permission, reverse-permission, and consistency radios rendered correctly. Unsupported consistency choices explicitly read unavailable. The compact consistency panel measured 117 CSS pixels at the checked desktop width.
- Real cache miss/hit/bypass behavior, resource and reverse pagination, parent-cycle termination, principal paging, selection/focus, light/dark styling, and phone access were exercised.
- The global evidence strip, timing column, resource filter, and query activity view are absent. The factual subtitle matches the supplied text.
- JavaScript syntax checks, strict OpenSpec validation, and `git diff --check` passed. No browser warning/error entries were observed in the checked session.

This is an isolated local design preview. Full production controller/recovery qualification, schema graph controls, supporting profiles' historical/freshness semantics, cache eviction, local seeding, deployed identity/availability, canonical URLs/history, and the caveats/expiry playground remain explicit connected apply tasks. The preview does not remove those features from the existing application.
