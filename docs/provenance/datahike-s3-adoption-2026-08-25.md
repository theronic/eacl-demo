# Datahike/S3 adoption decision

The existing S3 store is retained unchanged, but the legacy Lambda artifact is not eligible for the consolidated public profile.

The read-only capture resolves the live alias (`133`), exact ZIP digest (`ad91c…1085d9`), Java 25/arm64/SnapStart runtime, store bucket and ID, basis `datahike:536872941:6a7df54b…`, schema counts, logical counts, dependency versions, configuration shape, role, and bucket controls. No write, seed, refresh, migration, or administrative call was made.

Three independent blockers prevent direct enablement:

- Source identity is not reproducible. The legacy worktree is dirty, its configured remote points to `theronic/eacl-datomic-solidjs`, the embedded EACL libraries claim only mutable `8.0.0-SNAPSHOT` versions, and the artifact records no exact demo/EACL SHAs.
- The serving closure is not minimal read-only code. It contains compiled seed, schema-write, cache-eviction, storage-GC, and transaction paths; its role also permits the Konserve metadata marker write and a read-write S3 Express cache session.
- The legacy fixture is not the canonical million-resource fixture. It reports 1,000,000 servers plus ancillary resources and has no manifest/semantic digest, whereas the canonical cut point has 1,000,000 resources total, including 998,417 servers.

The proper adoption path is therefore to preserve the existing bucket/store and retained basis, build a clean exact-SHA replacement reader with no writer or shared-cache mutation closure, report the legacy dataset under a distinct honest identity, and qualify that artifact through the staged production path. It must not receive the canonical fixture digest or participate in a same-fixture S3/DynamoDB speed comparison unless the datasets are made genuinely equal through a separate approved blue/green data publication.

The complete machine-readable evidence is [datahike-s3-adoption-2026-08-25.json](./datahike-s3-adoption-2026-08-25.json).
