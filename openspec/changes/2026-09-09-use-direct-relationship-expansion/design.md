## Context

See proposal.md for the behavior change. `ResourceTree.tsx` sends the viewing subject and selected permission along with the parent/child/relation filters. `profile-api.ts` maps them to `authorizationSubjectType`, `authorizationSubjectId` and `permission` on `reverse-relationships`. DataScript and the four JVM profiles construct `:authorization`; Jank has its own vendored authorized scan implementation. Shared JavaScript and Clojure contracts admit these fields.

The active redesign and lookup-filter-migration plans require authorized nested reads. This change supersedes only those requirements. Their other layout, query isolation and consistency constraints remain applicable. Current UI files have concurrent modifications; this proposal creates its own artifacts without modifying those files.

## Goals / Non-Goals

**Goals:** show direct relationship pages, remove every demo dependency on the removed core clause and keep measured performance attributable to the displayed query.

**Non-Goals:** replace authorization with per-item or bulk calls, add an authorization toggle, special-case a username or schema implication, change fixture/schema, redesign the approved UI, or deploy during this change's local implementation/review phase.

## Decisions

1. **Use the same plain read for every viewer.** The nested request contains parent subject type/id, child resource type, relation, page demand/cursor, cache controls and consistency. The viewing subject and permission do not belong to this request. Root `lookup-resources`, root counts, `lookup-subjects` and Check Permission retain them. A directly related object can appear despite a separate permission denial; a relationship is not an authorization assertion. Keep the existing `read-relationships` label and remove any claim that a nested list is an authorized list; add no new interface mode.

2. **Remove callers and reject stale fields at admission.** Update ResourceTree and profile mapping first, then shared wire admission, worker validation and all backend handlers. Reject removed fields by key presence, including null/partial forms, before payload translation can discard them. The edge's parent `subjectType`/`subjectId` is unrelated to the removed viewing subject and remains required where already required. Permission fields remain valid on permission endpoints. No silent fallback or retry that strips fields is allowed.

3. **Keep runtimes aligned.** Datomic/DynamoDB, Datahike/DynamoDB, Datahike/S3 and Datalevin JVM handlers use plain reads. Rebuild the DataScript runtime against the simplified core. Remove Jank's dedicated authorized-page implementation and clause validation using its documented vendor/build process, while preserving plain reads and ordinary authorization. Audit source-selection and packaged dependency metadata so a rebuilt browser does not quietly retain an older compiled runtime. Unrelated service `:authorization-reader` settings are not the removed clause and must remain.

4. **Scope nested state to its inputs.** Remove viewing subject/type and permission from the nested resource source, scope key and cursor-reset effect. Do not gate expansion on a permission being selected. Retain profile, parent/edge, page size/cursor, consistency/basis, cache flags and explicit query/refresh generations. Audit shared generation updates so a subject/permission-only change cannot indirectly refetch unchanged mounted branches. Root lookup changes may unmount branches naturally; stale async responses must still fail the current scope check. Avoid broad changes to root lifecycle solely to retain an invisible branch.

5. **Preserve native paging and evidence.** Return backend cursor/page metadata without authorized-page refill loops. Range labels use actual displayed rows, and totals only use existing valid evidence. First/Prev/Next and cache badges remain in their approved positions. Reset old authorized cursor state through existing compatibility recovery, without resetting the selected resource, viewer, permission or viewport. Re-query remains an explicit exception to dependency reuse and reruns expanded branches; Refresh Snapshot establishes its new basis before relevant reads.

6. **Verify zero hidden authorization.** HTTP request counting alone is insufficient: the existing code already performs its candidate checks inside one call. Trace/stub the relevant permission entry points at the runtime test boundary and require zero calls for a nested page, while root and inspector tests still exercise actual authorization. Measure a non-final 25-row platform/account page with Read Cache and Populate Cache disabled, record backend work and latency, and compare raw library read versus wrapped service timing. No absolute latency claim is made without host-specific measurements.

## Risks / Trade-offs

- Nested branches can display objects not accessible to the viewer → this is the owner's intended graph-inspection behavior; keep permission evidence in its actual query panes and test the distinction.
- Old browsers send removed fields → return explicit validation errors; verify mixed-version behavior and packaged identities before any later release.
- A stale cursor survives the semantic change → reject/recover the cursor explicitly; do not reinterpret an authorized page as a direct page.
- A JVM-only change leaves DataScript or Jank inconsistent → qualify each packaged runtime, not merely shared source.
- Broad reactive invalidation still reruns direct reads → test viewer/permission changes, siblings, pagination, Re-query and basis refresh independently.

## Migration Plan

1. Reconcile conflicting clauses in the active redesign and lookup migration artifacts during implementation; preserve unrelated work.
2. Update callers/contracts/handlers and Jank, then rebuild against the core companion implementation. Plain reads can be qualified against compatible existing runtimes before adopting the removed-clause core.
3. Verify old caller/new service rejects, new caller/compatible old service reads directly, and new caller/new service behaves identically across profiles. Validate local navigation and preserve all user inputs.
4. Supply a local demo and validation results for review. No production publish, commit, push or merge is part of this proposal request. A later rollback must restore a compatible artifact set rather than add permissive request handling.
