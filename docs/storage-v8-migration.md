# Durable demo storage v8 migration

The operator requested completion of the v8 storage migration for every demo
platform on 2026-09-08. This authorizes the exact copy, migration, verification,
and CI cutover described here. It supersedes the old initial-generation-only
authorization for this operation. It does not authorize deleting retained data.

The source and target identities and bounded throughput are in
`infra/data/storage-v8-migration.json`. Datahike/S3 uses the store ID verified
against the serving Lambda alias, including its larger comparison instance.
Datahike/DynamoDB and Datomic/DynamoDB each have one retained source table.

Use the PR-reviewed `migrate-storage-v8.yml` workflow on `production`, with
`MIGRATE-V8:<profile>` confirmation for the selected profile. The separate OIDC
role is defined in `infra/deployment/storage-v8-migration-role.json`. Its initial
bootstrap creates only the CI identity; storage operations run in GitHub Actions.
The role explicitly denies data writes to retained sources. Ordinary deployment
roles keep their existing read-only relationship to durable data.

Datahike copies complete Konserve blobs into an isolated local file store, runs
the pinned native permission and relationship migrations, then compacts that
local copy with Datahike's reachability GC. It uploads the resulting store to a
new generation. This does not reseed from an assumed equivalent fixture.
Datomic restores the frozen source table through DynamoDB PITR and runs a
loopback-only transactor in the CI runner. It migrates the restored native
database and completes indexing before publication. The runner trap stops its
transactor on success or failure; no temporary EC2 instance is required.

Both paths verify application datoms independently of Core's exact bidirectional
relationship identity certificate. The native client must admit both permission
storage 8 and relationship storage 8. Retain reports as CI artifacts or under
ignored `target/`; do not check observed counts or source hashes into tests.

The copied targets remain unpublished while migrating. Protect DynamoDB targets
from deletion, enable PITR, install alarms, and use bounded on-demand throughput.
The temporary write cap is 1,000 request units and the Datahike exporter paces
itself to 500 units/second. The retained source read budget leaves capacity for
serving. These are short-lived migration limits; serving returns to a one-unit
write cap with read-only reader identities. Keep old generations for rollback.

After all migrations succeed, dispatch the same workflow with action
`publish-readers`, `PUBLISH-V8:<profile>` confirmation, and the successful
migration run ID. It requires that production workflow's exact profile artifact,
checks the native v8 certificate and recovery protections, lowers the DynamoDB
write cap, and grants only the listed reader roles read access to that target.
A partial reader-grant failure leaves the generation unpublished and is retryable.
The next ordinary release binds both Lambda sizes and the Datomic EC2 reader
to the migrated generation and rotates lifecycle UUIDs. The normal production CI deployment must
pass before registry promotion. Verify health/version identity, allow and deny,
complete pagination, and Datomic historical requests within the v8 era. Earlier
historical databases retain their old physical format and return
`unsupported-consistency`, rather than a misleading permission denial. The
historical reader applies native relationship and permission admission before
lending the selected snapshot.

Compare post-migration retained bytes with the storage audit baseline. Creating a
copy for rollback is separate from rebuilding fixtures for space savings. No
bucket, table, backup, or old generation is deleted by this operation. Remove the
temporary migration authority after cutover and retain the old generation until
the upgraded demos have been accepted.

Durable authorization handlers pass the live EACL reader into every authorization
operation so v8 expiration uses fresh trusted time. The retained snapshot remains
available for immutable fixture inspection. Datomic historical requests pass the
boundary-selected database token to that live reader; cursor continuation keeps
its authenticated evaluation context. Tests exercise both regular and historical
pagination while the trusted clock advances, and denial at the expiration boundary.

The maintenance JVM has a 12 GiB heap for full relationship certificates. The
Datomic peer object cache is explicitly capped at 2 GiB instead of taking half
the heap; the separate transactor has a 2 GiB heap. This leaves room for native
index caches and proof sets on the 16 GiB runner. Minute-by-minute heap and GC
statistics distinguish verification progress from memory pressure. Interrupted
Datomic maintenance resumes the existing unpublished target from its committed
migration checkpoint; it does not restore another copy or skip verification.

Datahike readers use the native `:self` driver with `:exclusive` ownership to
retain the immutable generation's local head. EACL v8 certifies that native
prepared publication strategy; the previous custom deny-only writer has no such
capability. The EACL client remains read-only, and Konserve, SDK, and IAM still
reject storage mutations. A file-backed native fixture served through the real
read-only S3 facade verifies qualified authorization, EACL write rejection, raw
Datahike transaction rejection, and an unchanged database after the rejected write.
No storage writes are attempted against AWS during these tests.
