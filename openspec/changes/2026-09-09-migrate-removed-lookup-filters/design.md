> **Superseded relationship-read requirements (2026-09-09):** The later `2026-09-09-use-direct-relationship-expansion` change replaces every requirement below to retain, construct, validate or migrate to `read-relationships :authorization`. Nested demo branches use plain indexed reads with the exact parent/type/relation, pagination, consistency and cache controls, and perform no endpoint permission checks. Removed authorization fields are rejected on presence, including nil/null. Viewing subject and permission remain inputs to root lookups, the access inspector and permission checks only. Library callers needing endpoint authorization compose direct reads with `can?` or `check-permissions` on one snapshot and own filtered pagination. Historical completed tasks and measurements below describe the earlier release, not the new contract. All unrelated requirements remain in force. Apply the companion delta before archiving; do not restore the superseded clauses.

## Context

Companion to `../core-remove-lookup-filters/openspec/changes/2026-09-09-remove-lookup-relationship-filters`.
The inspected demo history includes nested routing migration `1693f04` merged in
`77bf776`. Re-check current files before implementation; the repository is actively
being edited. The existing resource-first specification already requires
`read-relationships` for nested branches. Root lookups remain ordinary lookups.

## Decisions

1. Keep nested reads indexed by exact subject type/id (parent), resource type
   (child) and relation, with `:authorization` containing the View As subject,
   selected permission and `:on :resource`. Never retry a rejected request raw.
2. Remove old lookup constructor fields and reject their presence at wire
   admission. Require the entire authorization group and displayed resource type;
   wholly absent authorization is still valid for the separate raw inspector.
3. Forward opaque cursors, bounded metadata, cache and consistency settings.
   Empty/short bounded pages retain Next. Accepted ranges accumulate actual row
   counts; root totals are never represented as exact branch totals.
4. Validate unqualified unique endpoint mapping at fixture generation and seed
   boundaries, not by scanning production data on page load. Cover small/large
   fixtures and larger supported browser seeds. Preserve the schema and dataset.
5. Reset pagination only when necessary, retaining selected subject/resource,
   permission and viewport. Reject superseded responses by relevant query scope.
6. Remove the Jank filter exemplar and reconcile vendored admission with the
   packaged core. Do not add a reverse-filter replacement: no production caller
   of the symmetric filter was found in the inventory.

## Performance and Release Evidence

Before collecting measurements, set numerical comparison budgets for broad-user
narrow branches and sparse-user platform-wide branches using measured fixture
cardinalities. Capture candidate work, backend work, cold/warm/bypass latency and
allocation where available. Disable lookahead for foreground attribution; separately
verify configured background depth/concurrency. Exhaustion probes and authorization
I/O are not included in the candidate examination limit. Report regressions without
raising budgets after the fact.

Test old browser/new service, migrated browser/compatible old service, and migrated
browser/new service with packaged artifacts. Obsolete fields and cursors must fail
explicitly and recover without losing user inputs. Record a core/browser/JVM/Jank
version matrix before adoption. No source/dependency update is complete until its
own backend tests and browser checks pass; no deploy is included in this plan.

## Current Gaps to Verify

The core audit found obsolete wire triplets, dropped bounded metadata and a Jank
filter exemplar. These are inventory observations, not completed companion fixes.
No performance or mixed-artifact evidence has been supplied to the core change.
