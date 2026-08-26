# `datalevin-memory`

Managed Java 25 arm64 Lambda with one ephemeral Datalevin in-memory environment.
The demo uses true native in-memory LMDB and preinitializes its immutable reader
before Lambda snapshots each published SnapStart version. CI publishes the
profile only after the optimized restored candidate passes bounded live smoke.

`dependencies/datalevin-memory.v1.json` records the exact maintained-fork
candidate and its current blockers. The branch exposes an explicit owned
read-snapshot API, platform-thread confinement, idempotent close, and genuine
LMDB `MDB_INMEMORY` mode. Those source properties are necessary but not a
release: the candidate commit has no tag, the reserved
`dev.eacl/datalevin-embedded-eacl` coordinate returns no artifact metadata, and
the EACL adapter still names that fork through a development-only local root.
The release gate was rechecked on 2026-08-26: the branch still resolves to the
recorded commit, that commit still has no tag, and both reserved-coordinate
metadata endpoints still return 404. The native repository still publishes
0.18.8 as its latest Linux arm64 version, so no newer candidate can silently
replace the recorded ABI evidence.

The published `org.clojars.huahaiy/dtlvnative-linux-arm64:0.18.8` JAR is
AArch64, but each of its three shared libraries imports `GLIBC_2.38`. Lambda
`java25` uses Amazon Linux 2023, whose glibc baseline is 2.34, so those
published bytes remain incompatible. A separate, qualification-only
`0.18.8-eacl.al2023.1` candidate is now built from the exact upstream commit
and submodules in a digest-pinned AL2023 arm64 image. Its native closure tops
out at `GLIBC_2.34`, has no absolute runtime path, loads on Corretto 25 in the
exact pinned Lambda Java 25 arm64 image, and passes a write/read round trip
through null-path `MDB_INMEMORY` mode. The
builder and exact evidence are recorded in
`dependencies/datalevin-native-al2023-builder.v1.json`.

That local candidate is not a release and must not overwrite upstream 0.18.8.
It still needs a new immutable maintained coordinate and a clean remote
consumer test before the Datalevin service may depend on it. No x86_64,
macOS, container-only, EFS, or durable-LMDB substitute may replace the
declared managed-Java arm64 topology.

Run `npm run plan:datalevin-native-al2023` to inspect the locked local build,
or `npm run build:datalevin-native-al2023 -- --no-cache` to rebuild it. Run
`npm run qualify:datalevin-native -- --artifact /exact/artifact.jar
--expectations dependencies/datalevin-native-al2023-builder.v1.json` on the
result. The audit admits only the three closed Linux arm64 shared-library
paths, verifies their byte digests and AArch64 ELF format, records each
`DT_NEEDED` and runtime-path closure, and fails unless the maximum imported
glibc version is at most 2.34. `--report-only` exists solely to capture
evidence for a known incompatible artifact and must never make that artifact
deployment-eligible.

After those dependency gates pass, implementation still has to prove the
deployment-bound source watermark, one local in-memory environment per Lambda
environment, acquiring-thread snapshot ownership/release, both pre-checkpoint
and after-restore strategies, native/RSS/handle telemetry, memory headroom, and
the staged production route. Until then the profile registry must remain
non-enabled and `build-units.json` must remain `deploymentEligible: false`.

The source-only lifecycle boundary now lives in
`src/eacl_demo/datalevin_memory/lifecycle.clj`. It validates the closed
versioned metadata object and its digest, binds the exact bucket/key/version
and the exact demo SHA, EACL SHA, artifact digest, deployment ID, runtime,
architecture, topology, snapshot strategy, and source identity to immutable
Lambda configuration. Concurrent environments and restores must use the exact
same record. Rebuilds and deployments rotate the deployment, lifecycle, and
native-source identities. Rollback can select one exact prior record or create
a new rotated deployment over that exact prior source, but cannot regress a
watermark under an unchanged lifecycle. Its EACL watermark callback can
acknowledge only the already-published final revision and rereads the exact
immutable object on every acknowledgement instead of trusting process-local
state. Readiness
additionally requires the exact 10,000-resource identity,
memory topology, frozen schema/relations, no public writer, and zero active
read snapshots.

`src/eacl_demo/datalevin_memory/runtime.clj` is the dependency-independent
request boundary for the eventual service assembly. It admits one platform
thread, acquires one injected owned snapshot, checks deadline and cancellation
throughout the scope, copies only bounded closed transport values before
release, and releases once on success or any post-acquisition failure. Its
closed telemetry separates controller ownership, native reader state, heap,
non-heap, direct buffers, mapped memory, RSS, native mapping, file descriptors,
native handles, and every immutable deployment/lifecycle identity. Callback
failures are typed and redacted; release failures remain visible as active
ownership instead of being hidden by a request error.

These pure tests advance the lifecycle and ownership implementation but inject
fake Datalevin operations. They do not constitute a Datalevin build, native
snapshot test, SnapStart restore test, memory sweep, or production
qualification.

`infra/profiles/datalevin-memory-runtime.yaml` now fixes the eventual Lambda
boundary without relaxing those blockers. It has no Datalevin directory,
remote service, EFS, VPC, durable-store permission, provisioned concurrency,
or customer-managed KMS surface. The role can read only one exact version of a
small SSE-S3 lifecycle-metadata object plus write the exact function log group.
That object conforms to `schemas/datalevin-lifecycle-state.v1.schema.json` and
binds the data manifest, bootstrap plan, externally retained lifecycle,
deterministic native source UUID, and final revision watermark. A rebuilt
environment must reach those values before constructing the EACL client; the
runtime cannot advance or overwrite the record. This avoids process-local
watermarks and cross-environment bootstrap races without describing S3 as the
Datalevin data store. The published-version SnapStart candidate remains
visibly tagged `blocked-until-native-release-and-lifecycle-evidence`.
