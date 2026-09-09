> **Superseded relationship-read requirements (2026-09-09):** The later `2026-09-09-use-direct-relationship-expansion` change replaces every requirement below to retain, construct, validate or migrate to `read-relationships :authorization`. Nested demo branches use plain indexed reads with the exact parent/type/relation, pagination, consistency and cache controls, and perform no endpoint permission checks. Removed authorization fields are rejected on presence, including nil/null. Viewing subject and permission remain inputs to root lookups, the access inspector and permission checks only. Library callers needing endpoint authorization compose direct reads with `can?` or `check-permissions` on one snapshot and own filtered pagination. Historical completed tasks and measurements below describe the earlier release, not the new contract. All unrelated requirements remain in force. Apply the companion delta before archiving; do not restore the superseded clauses.

## 1. Migrate and Verify Consumers

- [ ] 1.1 Refresh current-source inventory without overwriting concurrent UI work; reconcile all obsolete constructors and the existing nested-read mandate.
- [ ] 1.2 Reject old lookup fields and incomplete authorized reads consistently in browser/JVM transports; test partial/nil and entirely absent authorization separately.
- [ ] 1.3 Preserve bounded metadata and opaque page state through workers, services and UI; test empty pages, sentinels, backward pages, cumulative ranges and stale responses.
- [ ] 1.4 Verify unqualified unique endpoint mapping at generation/seed boundaries for small/large/larger browser fixtures; retain canonical schema/data.
- [ ] 1.5 Replace Jank filter exemplar and reconcile vendored validation; run packaged fixture verification.

## 2. Qualify Adoption

- [ ] 2.1 Declare numerical measurement budgets, then capture broad/narrow and sparse/wide cases with candidate/backend work and cold/warm/bypass latency; separately verify lookahead limits.
- [ ] 2.2 Verify selected inputs/viewport and query-local evidence in DataScript and representative remote browsers.
- [ ] 2.3 Test old-browser/new-service, migrated-browser/compatible-old-service and migrated-browser/new-service packaged combinations; record version matrix and fail-closed recovery.
- [ ] 2.4 Provide evidence to the core removal change and run strict validation. Publication/deployment is separate.
