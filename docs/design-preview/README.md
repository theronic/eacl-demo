# Resource-first explorer design preview

Run from the `eacl-demo` repository:

```sh
npm run build:datascript-runtime
node scripts/preview-explorer-design.mjs
```

Open [the light treatment](http://127.0.0.1:5198/?theme=light) or [the dark treatment](http://127.0.0.1:5198/?theme=dark). The theme button switches between them. Set `EACL_DESIGN_PORT` to choose another loopback port. Stop the preview server with Ctrl-C.

Branch: `design/resource-first-explorer`.

OpenSpec change: `openspec/changes/redesign-resource-first-explorer/`.

## Design and data

- Retains the 🦅 eagle emoji logo and green visual direction.
- Moves principal selection to the top right; the resource tree and smaller access inspector form two desktop columns.
- Shows all four public backend names and supported storage names directly. Browser, both Lambda sizes, and EC2 execution options are visible, with unavailable combinations disabled.
- Keeps all four consistency modes above exploration. The local DataScript runtime supports minimize-latency only; other modes and snapshot refresh are visibly unavailable here.
- Displays actual operation latency and cache outcomes beside lookup pages, independent counts, permission decisions, and reverse lookups. The root row stays visible while scrolling its page. The evidence bar shows observed cache hits/misses/disabled outcomes separately from cache-read and cache-populate preferences.
- Uses 16px resource identifiers in both densities, 14px latency values, and 12px cache badges. Compact mode changes spacing, not these font sizes.

The preview now executes the **existing compiled EACL DataScript runtime** against the **original canonical browser fixture**. It does not define a replacement dataset or decision helper. It retains 10,000 resources, 80 subjects, 38,613 relationships, recursive parent chains, intentional cycles, and original identifiers such as `account-0-server-12`.

The complete schema has six definitions, 13 relations, and nine permissions. Its unchanged SHA-256 is:

```text
7fa7ae57dec4e442c66815ea74a63b08f12a79d7e9a716ebc8f1d6b03ee2262c
```

The schema view shows the runtime wire schema and exact `fixtures/schema.v1.zed` source. The server checks the compiled runtime artifact hash and canonical schema hash; the browser also checks the schema and fixture identities returned by EACL. It serves only the preview assets, compiled runtime, and a metadata document assembled from existing repository files.

## What to try

1. Expand Accounts, then `account-0`. Expand `Accounts via :parent`, then `account-1`, then its parent group. The return to `account-0` is marked as a cycle and stops visual traversal. Authorization still uses the original cyclic data.
2. Expand the Servers root as `user-1`: the actual count is 64. Change the resource page size or use First/Previous/Next to exercise bounded cursor pages.
3. Select `account-0-server-12`. The inspector shows independent admin/view checks and actual subjects with access. Reverse subject pages contain five users and have independent Previous/Next controls.
4. Click Re-query. Lookups, counts, checks, and reverse lookups reuse the browser basis; returned cache outcomes and timings update. A hit is shown only when EACL reports it.
5. Disable Read cache, then run a permission check. Its cache outcome reports `disabled`. Read cache and Populate cache are independent options. Diagnostics exposes actual provider statistics and per-operation metrics.
6. Open the principal picker. Quick choices retain `user-1`, `user-2`, and `super-user`; known users are paginated in batches of 25. `user-2` sees accounts 4–7. A principal transition clears the inspector and old scoped results.
7. Select `super-user` and expand Servers. The bounded count displays `1,000+`, not a fabricated exact total. Production count escalation remains part of the connected implementation.
8. Filter a loaded identifier. Filtering does not fetch additional pages. Clear with Escape to restore ordinary expansion. Use arrow keys and Home/End to navigate visible tree rows; Enter selects a resource or toggles a group.
9. Use the independent permission checker with exact fixture IDs. Missing objects return errors rather than fabricated denial results; changing inputs clears the displayed decision.
10. Compare light/dark themes, comfortable/compact spacing, and phone layout. On narrow screens, View access moves focus to the inspector.

## Measurement scope and remaining integration

`elapsedMs` comes directly from the compiled runtime response and measures operation dispatch time in the current browser. It is not HTTP round-trip time, a pure-engine-only measurement, a reproducible benchmark, or a comparison with a remote backend. Timing varies per run. Missing `cacheStatus` reads “not reported”; traversal latency and its candidate permission-check totals are labelled separately.

The top-level hit/miss counters summarize responses in the current query scope, including underlying authorization checks. They reset on principal/profile/cache/page-size changes. Provider diagnostics cover the actual page-local cache lifetime and may therefore show different totals. Re-query preserves existing cache entries; preference changes do not claim eviction.

Only DataScript is connected in this local preview. Other backend cards show existing catalog/storage/execution choices with explicit disconnected status, clear the local results, and make no remote requests. Unsupported consistency guarantees are never simulated.

Production source, transports, EACL runtime source, schema, fixture generation, manifests, services, and build inputs remain unchanged. Full connected integration remains in the unchecked OpenSpec apply tasks: existing count escalation and advanced recovery, schema graph controls, supporting profiles' freshness/date/snapshot behavior, cache eviction, local seeding, deployed identity/availability, canonical URLs/history, and the independent caveats/expiry playground. This preview does not replace or remove those features from the existing application.

## Verification record — 2026-09-08

Observed through the Codex in-app browser against the loopback server:

| Check | Observed result |
| --- | --- |
| Canonical runtime | Rebuilt against pinned EACL Core `d153cd767a62440d133f01abaacfc3eb2edfe8c7`; bootstrap/schema/fixture identity checks passed |
| Original schema | All six definitions and complete original source rendered; unchanged schema digest |
| Eight existing decision exemplars | Direct owner allow/deny, platform arrow, team arrow, VPC grant, recursive parent, and cyclic allow/deny all matched `fixtures/exemplars.v1.json` |
| Forward lookup | `user-1` returned 64 servers and four accounts |
| Bounded stress-test count | `super-user` Servers displayed `1,000+` |
| Nested parent traversal | `account-0 → account-1 → account-0` stopped at an explicit cycle boundary; traversal and authorization-check evidence remained separate |
| Resource pagination | Servers advanced from page 1 to page 2, 20 items per page, then returned to page 1 |
| Reverse lookup | `account-0` viewers included the canonical two owner IDs, `super-user`, and `user-1`; server reverse lookup advanced between five-subject pages |
| Real cache reuse | Re-query changed all five initial authorization-operation outcomes from misses to hits; independent repeated denial also changed from miss to hit |
| Cache bypass | Unchecking Read cache produced `disabled` on the real permission check |
| Cache diagnostics | Actual provider stats and operation metrics rendered; no fabricated cache values |
| Backend visibility | Four backend cards, all their storage names, and four execution choices visible; Datahike exposed S3/DynamoDB and both supported Lambda choices, with EC2 disabled |
| Profile isolation | Selecting Datahike showed disconnected state and cleared DataScript results |
| Principal pagination/isolation | First and second pages each contained 25 users; switching to `user-2` showed accounts 4–7, cleared selection, and restored picker-trigger focus |
| Loaded filtering | Searching `account-0-server-12` showed that loaded result; query-activity count did not change |
| Keyboard | Right from expanded Accounts moved to `account-0`; Left returned to Accounts |
| Typography | Computed resource text 16px, timing 14px, cache badges 12px; compact rows retained 16px identifiers |
| Desktop / dark treatment | Inspected the two-column layout at 1440px and its corresponding dark palette |
| Phone | At 390 × 844, document width stayed 390px, identifiers remained 16px and timings 14px; View access focused the inspector |
| Console | No warning/error entries observed in the checked session |

Additional checks: successful canonical DataScript runtime build, fixture tests, JavaScript syntax checks, strict OpenSpec validation, `git diff --check`, and unchanged fixture/schema/production-source diffs. Allowlisted runtime and metadata returned HTTP 200; direct repository-file and API paths returned 404.

These are local-preview checks. They do not claim full production integration or accessibility qualification, which remain explicit apply tasks.
