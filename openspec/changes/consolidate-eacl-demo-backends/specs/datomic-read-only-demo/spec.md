## Purpose

Define a one-million-resource Datomic Pro/DynamoDB demo served from one immutable current database value by a transactor-free read-only Peer Lambda.

## ADDED Requirements

### Requirement: Dedicated Datomic DynamoDB storage
The profile SHALL use a new DynamoDB table/database owned only by Datomic and MUST NOT share the Datahike table, policy, lifecycle, database name, backup, or seed checkpoint.

#### Scenario: Infrastructure is planned
- **WHEN** the profile plan is generated
- **THEN** table, database, AWS-owned encryption, retention, tags, seed role, and serving role SHALL resolve independently

### Requirement: Temporary private writer lifecycle
A private temporary environment SHALL create the database, run a compatible transactor, install exact EACL/demo schema, seed/verify the fixture, record the final basis/manifest and recovery identity, then stop and terminate its temporary compute. Write credentials/configuration MUST NOT enter the public artifact/role.

#### Scenario: Seed succeeds
- **WHEN** all batches/indexes reach the verified final basis
- **THEN** counts, digests, exemplars, storage identity, versions, and recovery evidence SHALL be recorded before transactor shutdown and EC2 termination verification

#### Scenario: Seed fails
- **WHEN** a count, relationship, exemplar, or publication check differs
- **THEN** the database SHALL remain non-public and the serving alias SHALL not reference it

### Requirement: Exactly one million resource objects
The qualified database SHALL contain exactly 1,000,000 logical resource objects plus declared subjects/schema/relationships; descriptors SHALL distinguish logical resources from Datomic entities/datoms.

#### Scenario: Bootstrap succeeds
- **WHEN** the profile becomes ready
- **THEN** it SHALL report achieved logical counts and the post-seed fixture digest

### Requirement: Durable storage preserves Datomic history
The seeded schema and publication process SHALL retain transaction history for the EACL data needed by a future separately qualified non-read-only EC2 demo. Relevant attributes MUST NOT use `:db/noHistory true`; seed evidence SHALL record multiple basis values and prove normal-Peer `d/as-of` and history behavior before writer teardown. This retained storage capability MUST NOT be advertised as a capability of the read-only Lambda.

#### Scenario: Seed history is qualified
- **WHEN** the temporary normal Peer inspects recorded earlier and final seed bases
- **THEN** expected as-of and history results SHALL be available while the Lambda descriptor continues to advertise fixed-current selection only

### Requirement: Read-only Peer serves one fixed current snapshot
The Lambda SHALL use Datomic Pro supporting read-only connections and a `datomic:ddb` URI with `read-only=true`. It SHALL capture one `d/db` value during initialization and serve direct EACL snapshots over that value. No transactor SHALL run or be required in serving.

#### Scenario: Transactor is stopped
- **WHEN** a new Lambda environment initializes after provisioning teardown
- **THEN** health/bootstrap/representative reads SHALL succeed directly from DynamoDB at the recorded immutable basis

### Requirement: All EACL consistency modes are available over the immutable deployed value
The profile SHALL support minimize-latency, fully-consistent, at-least-as-fresh, and at-exact-snapshot over its one captured `d/db` value. Minimize-latency and fully-consistent SHALL return that value because it is the immutable authoritative value for this read-only deployment. At-least-as-fresh SHALL return it only when its basis satisfies the authenticated requested floor. At-exact-snapshot SHALL accept the authenticated locator for the captured value and MAY select an earlier retained Datomic basis only when the fixed value can reconstruct and verify it without synchronization. A request beyond the captured value SHALL fail closed. Serving execution MUST NOT call `d/sync` or transact and MUST NOT imply a live transactor head.

#### Scenario: Permission decision is returned
- **WHEN** Datomic authorization completes
- **THEN** its public data SHALL contain only `allowed`, and metadata SHALL contain only revision, request ID, and optional elapsed/cache fields

#### Scenario: Exact snapshot is requested
- **WHEN** a client submits the current captured exact token
- **THEN** the profile SHALL return exactly that basis without calling `d/sync`

#### Scenario: Future freshness is requested
- **WHEN** a client submits an at-least floor newer than the captured deployment value
- **THEN** the profile SHALL return typed freshness-unavailable without calling `d/sync` or silently advancing

### Requirement: Serving IAM uses documented read actions
The role SHALL grant only documented DynamoDB reads required by the read-only Peer on the dedicated table/indexes plus narrow configuration/log/metric actions. It MUST deny writes, table administration, seed/transactor actions, and other demo storage.

#### Scenario: IAM is simulated
- **WHEN** the candidate policy is checked
- **THEN** write/delete/admin/cross-profile actions SHALL be denied

### Requirement: Immutable blue-green data publication
An active dataset SHALL not be mutated. Replacement data SHALL use a new qualified database/table and Lambda version, then move the profile alias/descriptor coherently while retaining the prior identity for rollback. The UI MUST NOT imply a live head.

#### Scenario: Replacement fixture is published
- **WHEN** the replacement passes gates
- **THEN** that profile alone SHALL move to the new matching data/artifact identity without coordinating other profiles

### Requirement: Current EACL v8 and dependency provenance
The function SHALL record exact EACL Core/demo SHAs, Datomic Peer version at/above `1.0.7622`, dependency closure/licenses, architecture/runtime/build inputs, and artifact digest.

#### Scenario: Artifact is inspected
- **WHEN** the ZIP is compared with its descriptor
- **THEN** all EACL/Datomic dependencies and digest SHALL match

### Requirement: Smallest fitting memory is qualified
The selected memory SHALL be the lowest tested configuration passing cold initialization and representative one-million-resource load with no OOM/timeout/GC/native failure, at least 20% peak headroom, and accepted warm/cold latency.

#### Scenario: Candidate initializes but thrashes
- **WHEN** latency/error/GC/headroom fails
- **THEN** the next larger candidate SHALL be evaluated

### Requirement: SnapStart is required and qualified
The production function SHALL enable SnapStart on a published Java version after forcing the read-only reader and immutable `d/db` value during initialization. Publication SHALL wait for AWS `OptimizationStatus=On`, and repeated restore tests SHALL prove reader validity, fixed-basis identity, cache isolation, concurrency, and error behavior before alias promotion.

#### Scenario: Restored client is stale
- **WHEN** a restored environment cannot re-establish safe read-only state
- **THEN** the candidate SHALL fail and the prior qualified alias SHALL remain deployed
