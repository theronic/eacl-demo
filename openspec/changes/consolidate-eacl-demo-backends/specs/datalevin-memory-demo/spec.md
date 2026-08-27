## Purpose

Define an EACL/Datalevin in-memory demonstration in a managed Java Lambda with an honest ephemeral lifecycle and bounded cold initialization.

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

### Requirement: Honest environment-local source lifecycle
The profile SHALL bind its deterministic fixture and deployment identity in bootstrap while keeping the Datalevin revision watermark inside the execution environment that owns the in-memory database. It MUST NOT describe that process-local watermark as durable persistence or coordinate it through another storage service.

#### Scenario: Old deployment is restored
- **WHEN** an operator moves the alias back to a prior immutable dataset/artifact
- **THEN** the old function version SHALL rebuild its own exact packaged fixture and advertise its own deployment/basis; it SHALL not share mutable database state with the newer environment

### Requirement: Cold initialization and restore are bounded and measurable
The production deployment SHALL initialize its native in-memory database before a published Java SnapStart checkpoint. Fixture parsing and writes SHALL use bounded batches, publication SHALL wait for AWS `OptimizationStatus=On`, and ordinary candidate smoke SHALL report wall time to first restored healthy response. Repeated restore, eviction, lock, and load evidence SHALL remain part of qualification.

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

### Requirement: Managed Lambda configuration
The profile SHALL use a supported managed Java runtime, published function versions, an alias, qualified SnapStart, and no EFS or durable database attachment. The production function SHALL use exactly 1024 MB and no reserved-concurrency cap.

#### Scenario: Infrastructure requests an incompatible feature
- **WHEN** a plan configures more than 1024 MB or reserved concurrency for the production function
- **THEN** validation SHALL fail before deployment

### Requirement: Smallest fitting Datalevin memory is measured
The final memory setting SHALL be 1024 MB and SHALL pass initialization/restore, the full 10,000-resource semantic and load suite, native/direct/heap observation, agreed latency/error/GC limits, and at least 20% peak-memory headroom. The report SHALL distinguish heap, native LMDB mapping, direct buffers, code, and process RSS as far as the runtime exposes them. Failure at 1024 MB SHALL require initialization/data-layout optimization and MUST NOT be resolved by increasing production memory.

#### Scenario: Native memory is omitted from the report
- **WHEN** heap headroom passes but process RSS/native mapping approaches the Lambda limit
- **THEN** the candidate SHALL fail the fit gate despite its Java heap result
