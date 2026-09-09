> **Superseded relationship-read requirements (2026-09-09):** The later `2026-09-09-use-direct-relationship-expansion` change replaces every requirement below to retain, construct, validate or migrate to `read-relationships :authorization`. Nested demo branches use plain indexed reads with the exact parent/type/relation, pagination, consistency and cache controls, and perform no endpoint permission checks. Removed authorization fields are rejected on presence, including nil/null. Viewing subject and permission remain inputs to root lookups, the access inspector and permission checks only. Library callers needing endpoint authorization compose direct reads with `can?` or `check-permissions` on one snapshot and own filtered pagination. Historical completed tasks and measurements below describe the earlier release, not the new contract. All unrelated requirements remain in force. Apply the companion delta before archiving; do not restore the superseded clauses.

## Why

Core change `2026-09-09-remove-lookup-relationship-filters` removes both lookup
relationship predicates. The demo must stop constructing obsolete requests and
qualify its existing authorized relationship-read migration before adopting it.

## What Changes

- **BREAKING**: reject obsolete lookup relationship wire fields, including partial/nil forms.
- Preserve indexed authorized nested reads, bounded cursors, consistency and cache controls across browser, JVM profiles and vendored Jank.
- Verify fixture assumptions, page ranges, query-local measurements and mixed-version behavior.
- Preserve the approved design, permission schema and canonical stress-test data.

## Capabilities

### New Capabilities

- `lookup-filter-removal-compatibility`: demo admission, pagination and release compatibility with the core removal.

### Modified Capabilities

None. This supplements the active `redesign-resource-first-explorer` change;
its nested-branch requirement already uses authorized relationship reads.
Any earlier nested filtered-lookup mandate is superseded by this change.

## Impact

Browser worker, profile API and wire validation, four JVM profile configurations,
Jank source/vendor verification, tree page state and release artifacts. This is
a companion plan, not a deployment or permission to overwrite concurrent UI work.
