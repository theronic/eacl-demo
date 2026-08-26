# `datahike-s3`

Read-only Java Lambda profile over the adopted legacy S3 store. No seed,
schema write, shared-cache mutation, store deletion, or administration entry
point may enter the replacement serving closure.

The upstream `konserve-s3` connector is intentionally not used by the serving
reader: its connect lifecycle writes the store metadata marker and can create a
bucket. The project backend first requires the existing marker, makes
Konserve's internal create hook a no-op, wraps every blob/store mutation method
with a denial, and wraps the AWS SDK client in an exact `GetObject`/`HeadObject`
allowlist. The runtime role grants only `s3:GetObject` on
`${StoreId}_*`; it cannot list the bucket or write the marker/data objects.
Generic dependencies still contain write-capable classes, so the defensible
claim is no reachable serving write path plus an in-process membrane and IAM
implicit deny—not physical absence of every write symbol.

A local format-only regression writes a tiny fixture with the rejected
upstream writer, reads it through the production adapter, and verifies the
complete object-key/SHA-256 map is unchanged. That harness is test-only and is
not a production seeder or live-store qualification.

The [adoption evidence](../../docs/provenance/datahike-s3-adoption-2026-08-25.md) keeps the store but rejects direct reuse of legacy Lambda version 133: its source SHAs are unresolved, its compiled closure contains mutation/maintenance code, and its legacy one-million-server dataset is not the canonical one-million-resource fixture. The profile remains non-enabled until a clean exact-SHA reader reports this data identity honestly and passes staged qualification.

Datahike's upstream cross-platform classpath includes ClojureScript build
artifacts that the JVM reader does not execute. The deployable ZIP must prune
and smoke-test that browser/compiler closure; a source-only build is not a
serving artifact and cannot satisfy the artifact-isolation gate.

The foundation descriptor reports SnapStart as disabled and explicitly
unqualified. Connecting the S3 reader creates native/network client state; no
profile may advertise SnapStart until a real restore lifecycle proves that
state is rebuilt or safely restored, along with repeated correctness, cleanup,
latency, and memory evidence. Initial deployment may proceed without SnapStart.
