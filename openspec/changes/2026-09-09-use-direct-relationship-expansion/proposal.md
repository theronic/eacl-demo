## Why

Nested demo expansion should display directly related objects and demonstrate indexed relationship-read performance. Its current authorization clause adds an unrequested permission decision for every candidate and depends on a library feature the owner has directed EACL to remove.

## What Changes

- **BREAKING**: nested branches become direct relationship pages; they are not filtered by the View As subject or selected permission. Root resource lookups, subject lookups and the Check Permission pane retain their authorization semantics.
- Remove authorization subject and permission fields from nested constructors, browser/JVM/Jank execution and relationship-read wire admission. Reject obsolete fields rather than silently ignoring them.
- Use one anchored `read-relationships` page per nested request with no scalar or bulk authorization replacement, no root lookup substitution and no super-user special case.
- Remove irrelevant viewing-subject/permission dependencies from nested query identity; preserve pagination, relevant refresh behavior, selection and scroll position.
- Preserve the approved layout, schema, stress-test data, query labels, counts and query-local latency/cache evidence.
- Supersede the authorized nested-read requirements in `redesign-resource-first-explorer` and `2026-09-09-migrate-removed-lookup-filters`. Their unrelated requirements remain in force.

## Capabilities

### New Capabilities

- `direct-relationship-exploration`: direct nested traversal, removal of authorization wire inputs, dependency-scoped queries and performance verification across demo runtimes.

### Modified Capabilities

None. The superseded nested-expansion requirements currently live in active changes rather than an archived main capability.

## Impact

ResourceTree, profile API, shared JavaScript/Clojure contracts, DataScript worker, Datomic/Datahike/Datalevin handlers, vendored Jank implementation, related tests and packaged dependency references. Companion core change: `/Users/petrus/code/eacl/core/openspec/changes/2026-09-09-remove-relationship-read-authorization`. Implementation must preserve concurrent UI work. Publication is outside this proposal's scope.
