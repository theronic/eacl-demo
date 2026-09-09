## 1. Direct Nested Requests

- [x] 1.1 Re-read concurrent UI edits and reconcile the authorized nested-read clauses in the redesign and lookup-filter-migration plans; verify their unrelated design and behavior requirements are preserved.
- [x] 1.2 Remove viewing-subject and permission fields from ResourceTree and profile API relationship requests, rejecting stale fields before translation; verify request tests show only parent/child/relation, paging, consistency and cache inputs.
- [x] 1.3 Remove viewing subject/type and permission from mounted nested query sources, scope keys and cursor resets; verify they do not rerun unchanged branches or move selection/viewport, while sibling disclosure remains isolated and explicit Re-query/Refresh Snapshot still work.

## 2. Runtime and Admission Parity

- [x] 2.1 Remove authorization fields from JavaScript/Clojure wire contracts and browser worker admission; verify presence-based rejection for complete, partial, null and empty forms before EACL is invoked, while other permission endpoints remain valid.
- [x] 2.2 Remove `:authorization` construction from Datomic/DynamoDB, Datahike/DynamoDB, Datahike/S3, Datalevin and DataScript handlers; verify each runtime returns direct anchored pages and performs zero endpoint permission evaluations in nested-read tests.
- [x] 2.3 Remove Jank's dedicated authorized-read handling and update its packaged/vendor source through the existing process; verify plain-read pagination and ordinary authorization conformance still pass.
- [ ] 2.4 Rebuild browser/JVM/Jank artifacts against the core companion change as applicable; verify packaged dependency/source identities and test old caller/new service rejection plus new plain caller/compatible old and new services.

## 3. Behavior and Performance Review

- [x] 3.1 Verify First/Prev/Next, page size 25, range labels, native cursors and obsolete-cursor recovery in local browser tests; confirm no fabricated branch total, full relationship count scan, selection reset, timing-induced button movement or viewport jump.
- [x] 3.2 Verify root lookup/counts, lookup-subjects and automatic Check Permission retain the selected viewer/permission semantics, while a direct branch can display a separately denied endpoint; confirm schema and stress-test fixture files are unchanged.
- [x] 3.3 Measure a non-final platform/account page locally with cache reads/population disabled, recording internal permission-call counts, bounded backend work and raw-library versus service timing; verify zero hidden checks rather than relying only on HTTP request count.
- [x] 3.4 Run the affected contract, runtime and UI tests plus the production browser build; verify the approved light/dark and mobile layouts retain query labels, counts and latency/cache badges without added controls or presentation changes.
- [x] 3.5 Validate this change strictly and provide the local review URL, tested runtime identities and verification results; verify no commit, push, merge or production deployment was performed as part of this proposal/local review scope.

Task 2.4 release handoff: the local advanced browser artifact uses the modified companion checkout and is marked deployment-ineligible; all JVM handlers compile/test against that checkout and native Jank semantic tests execute its revised vendored implementation. Immutable release pins, release packages and the full packaged old/new deployment matrix remain pending a committed core revision. This local review does not claim those release checks.
