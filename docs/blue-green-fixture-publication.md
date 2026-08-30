# Immutable blue-green fixture publication

An accepted data manifest and its physical lifecycle are immutable. A normal
`main` deployment may verify that its expected manifest equals the profile's
serving lifecycle; it has no seed, migration, schema-write, table-create,
bucket-create, pointer-update, or deletion permission. A mismatch fails with
`stateful-migration-required` and leaves the healthy alias untouched.

Fixture changes use a separate explicitly invoked stateful workflow:

1. Resolve the exact currently serving lifecycle and physical resource.
2. Allocate a distinct green lifecycle ID and distinct table/bucket/database.
3. Install the exact schema and stream idempotent bounded batches into staging.
4. Verify generator/schema/exemplar/fixture/manifest digests, logical counts,
   duplicate/dangling invariants, backend physical evidence, permissions, and
   final native basis.
5. Mark green `verified`; neither partial nor merely seeded data is selectable.
6. Update only that profile's data pointer/alias to the exact verified lifecycle.
7. Observe bounded smoke and rollback by restoring the prior pointer if needed.
8. Retain blue for the declared recovery window. Retirement/deletion is a later
   separately approved destructive operation.

Allowed lifecycle transitions are only `staging -> verified -> serving ->
retired`. Lifecycle, profile, storage resource, manifest, fixture, predecessor,
and creation identities never change in place. Even publishing byte-identical
data to replacement infrastructure creates a new lifecycle ID because recovery
and physical evidence differ.

`packages/data-lifecycle/lifecycle.mjs` enforces these transition and promotion
rules. Stateful workflows record every batch digest and checkpoint, but those
operational records cannot rewrite the accepted canonical manifest. Stateful
resources use retention/deletion protection and profile-specific roles; an
ordinary merge cannot promote or clean them up.
