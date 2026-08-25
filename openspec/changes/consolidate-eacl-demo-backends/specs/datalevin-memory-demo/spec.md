## Purpose

Define a qualification-gated EACL/Datalevin in-memory demonstration in a managed Java Lambda using SnapStart and native lifecycle safety.

## ADDED Requirements

### Requirement: True ephemeral Datalevin in-memory profile
`datalevin-memory` SHALL use Datalevin's native in-memory environment mode and the canonical 10,000-resource fixture. The database SHALL not depend on durable LMDB data files, a remote Datalevin server, HA, WAL, or EFS. Any external state required solely for EACL source lifecycle and rollback detection SHALL be identified separately and MUST NOT be described as the data store.

#### Scenario: Environment initializes
- **WHEN** a new Lambda environment becomes ready
- **THEN** it SHALL prove in-memory mode, exact fixture/schema digests, exactly 10,000 resources, and absence of a durable serving database path

### Requirement: Qualified maintained fork and native artifact
The profile SHALL depend on the maintained Datalevin fork that exposes explicit owned read snapshots and executable write-policy/topology checks. Its reserved fork and EACL adapter coordinates, Linux arm64 native closure, clean remote-consumer installation, and source/artifact provenance MUST pass before public deployment.

#### Scenario: Only local-root dependencies work
- **WHEN** the service can build only by reading sibling source directories or unpublished native files
- **THEN** the profile SHALL remain unavailable and SHALL not describe those dependencies as published releases

### Requirement: Lambda topology receives its own EACL qualification
The currently qualified embedded Datalevin topology MUST NOT automatically qualify Lambda/SnapStart. A dedicated certification SHALL prove one local embedded database per environment, no remote/HA/WAL path, no runtime public writer, platform-thread request execution, acquiring-thread snapshot ownership, complete response realization before release, deterministic release on success/error/cancellation, and no use of an ordinary live DB handle as an immutable request snapshot.

#### Scenario: Snapshot crosses a thread
- **WHEN** an instrumented request acquires a Datalevin read snapshot on one thread and attempts to use or release it on another
- **THEN** the qualification SHALL fail and no public profile SHALL be enabled

#### Scenario: Response realization throws
- **WHEN** an exception occurs after snapshot acquisition during page realization
- **THEN** the owned read snapshot SHALL still be released exactly once and the response SHALL be a typed safe error

### Requirement: Production-safe ephemeral source lifecycle
The profile SHALL define and qualify an external, deployment-bound source-lifecycle and monotonic revision-watermark strategy that satisfies the EACL Datalevin adapter across rebuild, restore, rollback, and concurrent Lambda environments. A process-local test atom or an undocumented bypass MUST NOT be accepted as production persistence.

#### Scenario: Old deployment is restored
- **WHEN** an operator moves the alias back to a prior immutable dataset/artifact
- **THEN** the configured lifecycle/watermark SHALL either recognize the exact prior source safely or require an explicit lifecycle rotation; it SHALL not accept a revision regression under an unchanged lifecycle

### Requirement: SnapStart lifecycle strategy is selected by evidence
The deployment SHALL evaluate both (a) quiesced pre-checkpoint in-memory initialization with validated/reopened native resources after restore and (b) checkpointing only JVM/class state followed by complete in-memory creation/seed in `afterRestore`. The selected strategy SHALL pass repeated publish/restore waves, simultaneous environments, forced eviction, native handle/lock checks, fixture identity, semantic conformance, and representative load. Any `afterRestore` work MUST complete within AWS's ten-second limit.

#### Scenario: Pre-checkpoint handle passes one smoke test only
- **WHEN** a snapshotted native handle succeeds once but lacks repeated restore, eviction, lock, and load evidence
- **THEN** it SHALL not qualify the pre-checkpoint strategy

#### Scenario: Post-restore seed exceeds hook limit
- **WHEN** deterministic database creation and seed do not reliably finish inside the restore-hook limit
- **THEN** the post-restore strategy SHALL fail and MUST NOT be masked by returning readiness early

### Requirement: Public runtime is immutable and bounded
After readiness, the service SHALL expose only shared read routes and SHALL prevent schema, relation, fixture, cache-lifecycle, or raw Datalevin writes. Each invocation SHALL use one admitted request execution scope with deadlines, cancellation, and deterministic snapshot release.

#### Scenario: Public caller sends legacy seed route
- **WHEN** a caller attempts to reseed the in-memory database
- **THEN** the route SHALL be rejected before any transaction and the current fixture/basis SHALL remain unchanged

### Requirement: SnapStart-compatible managed Lambda configuration
The profile SHALL use a supported managed Java runtime, published function versions, an alias, and SnapStart. It MUST NOT combine SnapStart with provisioned concurrency, EFS, S3 Files, a container image, an OS-only runtime, or ephemeral storage above 512 MB.

#### Scenario: Infrastructure requests an incompatible feature
- **WHEN** a plan enables provisioned concurrency or oversized ephemeral storage for the SnapStart function
- **THEN** validation SHALL fail before deployment

### Requirement: Smallest fitting Datalevin memory is measured
The final memory setting SHALL be the lowest candidate that passes initialization/restore, the full 10,000-resource semantic and load suite, native/direct/heap observation, agreed latency/error/GC limits, and at least 20% peak-memory headroom. The report SHALL distinguish heap, native LMDB mapping, direct buffers, code, and process RSS as far as the runtime exposes them.

#### Scenario: Native memory is omitted from the report
- **WHEN** heap headroom passes but process RSS/native mapping approaches the Lambda limit
- **THEN** the candidate SHALL fail the fit gate despite its Java heap result
