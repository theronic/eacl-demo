## Purpose

Define the separately identified embedded Datalevin Lambda and EC2 demonstrations, including their different persistence, startup, lifecycle, and qualification semantics.

## ADDED Requirements

### Requirement: Maintained source and native closure are immutable
Datalevin SHALL resolve the maintained fork by exact Git commit together with the exact EACL adapter and Linux native closure. Clean CI SHALL verify source resolution, snapshot API availability, native ABI compatibility, licenses, and artifact provenance without depending on a mutable branch, sibling checkout, or an unrecorded local native file. A separate Maven publication SHALL NOT be required when the exact source/native closure is reproducibly resolved and recorded.

#### Scenario: Only a mutable or local dependency works
- **WHEN** the service builds only from a mutable branch, sibling source directory, or unrecorded native file
- **THEN** the affected deployment SHALL remain unavailable because its source and native closure are not reproducible

### Requirement: Lambda and EC2 are distinct embedded topologies
The Lambda execution SHALL use one environment-local embedded LMDB database under `/tmp`, with no remote server, EFS, S3, DynamoDB, or HA serving dependency. The shared-EC2 execution SHALL use embedded LMDB on its declared durable path. Their descriptors SHALL publish distinct execution, persistence, deployment, service/data, lifecycle, and rollback identities. Neither topology's evidence SHALL qualify the other.

#### Scenario: Lambda environment is replaced
- **WHEN** AWS creates a new Lambda execution environment
- **THEN** that environment SHALL reconstruct or restore its own exact fixture/database and SHALL not claim persistence from the previous environment

#### Scenario: EC2 service restarts
- **WHEN** the declared EC2 service restarts without a data-generation change
- **THEN** it SHALL reopen the same qualified durable embedded path and retain its declared data identity rather than rebuilding an unrelated ephemeral store

### Requirement: Source lifecycle and cursors are topology-scoped
Each deployment SHALL bind the deterministic 10,000-resource fixture, schema digest, source identity, local Datalevin revision watermark, artifact identity, and deployment identity in bootstrap. Cursors and snapshot locators SHALL be scoped to the exact execution and lifecycle. Rollback SHALL restore the selected deployment's own identities and MUST NOT share mutable lifecycle state across Lambda environments or between Lambda and EC2.

#### Scenario: Cursor crosses execution platforms
- **WHEN** a Lambda cursor or snapshot locator is submitted to the EC2 service
- **THEN** the request SHALL fail with a typed invalid-scope error before reading page data

### Requirement: Read snapshots have exact ownership and release
Every request SHALL execute in one admitted scope on a platform thread, acquire one owned Datalevin read snapshot, fully realize the bounded response before release, and release the snapshot exactly once on success, error, deadline, or cancellation. An ordinary live database handle MUST NOT be represented as an immutable request snapshot.

#### Scenario: Snapshot crosses a thread
- **WHEN** an instrumented request acquires a read snapshot on one thread and attempts to use or release it on another
- **THEN** qualification SHALL fail and the affected deployment SHALL not be advertised as qualified

#### Scenario: Response realization throws
- **WHEN** an exception occurs after snapshot acquisition during page realization
- **THEN** the owned snapshot SHALL still be released exactly once and the response SHALL be a typed safe error

### Requirement: Lambda uses a ready pre-checkpoint reader
The Lambda SHALL use a supported managed Java runtime, published function versions, an alias, no reserved-concurrency cap, and qualified SnapStart. It SHALL create the embedded `/tmp` database and force the immutable reader during initialization, publish only after AWS reports `OptimizationStatus=On`, and smoke the exact restored candidate version before alias promotion. Rebuilding the full database in an after-restore hook is not a second supported production strategy.

#### Scenario: A published version is not optimized
- **WHEN** AWS reports a SnapStart optimization state other than `On`
- **THEN** deployment SHALL not promote that version even if an unoptimized invocation succeeds

### Requirement: Current Lambda memory is explicit and fully qualified
The primary Lambda SHALL use 1769 MiB. Deployment SHALL verify exact memory, runtime, architecture, code identity, and SnapStart state. Full qualification SHALL additionally cover the 10,000-resource semantic/load suite, repeated restore, simultaneous environments, eviction, stale handles, cancellation, failure recovery, accepted latency/error/GC, and at least 20% process-memory headroom. Bounded promotion smoke MUST NOT be represented as that full qualification.

#### Scenario: Ordinary smoke passes but headroom evidence is absent
- **WHEN** the candidate passes health, bootstrap, allow, deny, and mutation-denial probes without current load/process-memory evidence
- **THEN** it MAY remain deployed under the ordinary delivery policy but the full Datalevin qualification task SHALL remain open

### Requirement: EC2 service receives independent qualification
The shared-EC2 service SHALL qualify its exact host/service/runtime/native/data-path identities, restart and recovery behavior, read-only boundary, snapshot ownership/release, concurrency, latency, errors, process memory, disk capacity, alarms, and rollback coordinates. Lambda SnapStart or Lambda memory evidence MUST NOT satisfy this gate.

#### Scenario: EC2 is advertised from Lambda evidence
- **WHEN** the only evidence references a Lambda version, Function URL, `/tmp`, or SnapStart
- **THEN** the EC2 execution SHALL remain unqualified regardless of logical fixture equality

### Requirement: Public runtime and telemetry are bounded
After readiness, both executions SHALL expose only the shared read routes and prevent schema, relation, fixture, cache-lifecycle, or raw Datalevin writes. Bounded application telemetry SHALL record safe operation outcomes and exact-once cleanup without sensitive or high-cardinality data. Lambda REPORT/EMF and EC2 CloudWatch/process/service signals SHALL provide the surrounding memory, failure, and lifecycle observations.

#### Scenario: Public caller sends a legacy seed route
- **WHEN** a caller attempts to reseed either embedded database
- **THEN** the route SHALL be rejected before any transaction and the selected deployment's fixture/basis SHALL remain unchanged
