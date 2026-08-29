## Purpose

Define honest read-only EACL/Datahike demonstrations for an adopted S3 store and a separately repaired, seeded, and qualified DynamoDB store.

## ADDED Requirements

### Requirement: Existing Datahike S3 reader is adopted by evidence
`datahike-s3` SHALL use the existing one-million-resource S3 database and read-only Lambda when source, artifact, configuration, fixture, store, basis, and `explorer.v1` behavior are attributable and passing. Consolidation MUST NOT duplicate or reseed the store merely to change hostname/UI.

#### Scenario: Provenance cannot be established
- **WHEN** the deployed artifact cannot be tied to claimed EACL source and fixture
- **THEN** the profile SHALL remain unavailable until a reproducible replacement is built without modifying the store in place

### Requirement: S3 serving remains public-read-only and bounded
The S3 profile SHALL expose no public data/schema/seed/shared-cache mutation, retain its reader write guard, keep maintenance credentials out of the artifact, and use bounded immutable request bases.

#### Scenario: Legacy mutation route is called
- **WHEN** a caller attempts schema or seed mutation
- **THEN** the reader SHALL reject it before Datahike transaction, S3 write, cache persistence, or administration

### Requirement: Datahike consistency limitations are truthful
Both Datahike profiles SHALL expose minimize-latency, at-least-as-fresh, and at-exact-snapshot. At-least-as-fresh SHALL return the current captured basis when it satisfies the requested floor and fail when the requested floor is newer. At-exact-snapshot SHALL succeed only for the current captured basis and reject any older, newer, foreign, or expired token. Fully-consistent SHALL remain unavailable in the read-only Lambda topology and the descriptor SHALL explain that no authoritative writer barrier can establish a newer head.

#### Scenario: Cross-environment exact reconstruction is incomplete
- **WHEN** another Lambda environment cannot reconstruct the exact basis
- **THEN** it SHALL accept only that environment's authenticated current-basis token and reject the foreign token without returning a different basis

#### Scenario: Fully consistent is requested
- **WHEN** a caller requests fully-consistent from the read-only Datahike Lambda
- **THEN** the service SHALL return typed unsupported-consistency before traversal or cache work and the UI SHALL display the `fully-consistent*` explanation

### Requirement: DynamoDB adapter hard gate
`datahike-dynamodb` MUST remain unavailable until the pinned adapter preserves typed failures, distinguishes absence from throttle/auth/timeout/transport failures, handles all `UnprocessedKeys`, uses strong publication reads or proven equivalent, propagates cancellation/deadlines through bounded jittered retry, and excludes destructive serving deletion.

#### Scenario: Batch response is partial
- **WHEN** DynamoDB returns unprocessed keys
- **THEN** the adapter SHALL complete them within the original bound or fail the whole read explicitly

### Requirement: Real AWS qualification precedes durable seeding
DynamoDB Local alone MUST NOT qualify the profile. A disposable real AWS table SHALL prove initialization, post-publication reads, strong-read behavior, throttling, IAM denial, timeouts, partial batches, malformed/missing classification, cancellation, and representative concurrency before durable seeding.

#### Scenario: Only local tests pass
- **WHEN** real AWS publication/fault evidence is absent
- **THEN** the public profile SHALL remain disabled

### Requirement: Dedicated one-million-resource DynamoDB fixture
After adapter qualification, a private idempotent/resumable bounded workflow SHALL seed a dedicated table to exactly 1,000,000 logical resources and verify schema/fixture digests, counts, relationships, exemplars, and final published lifecycle/basis. The user's authorization covers this planned seed but not an expanded resource scope.

#### Scenario: Seed is interrupted
- **WHEN** provisioning stops after a committed batch
- **THEN** resume SHALL continue from verified manifest state without duplication or public exposure

### Requirement: DynamoDB serving role is read-only
The Lambda role SHALL permit only exact table/index reads plus necessary configuration/log/metric actions and SHALL deny writes, deletes, administration, seed credentials, and Datomic-table access.

#### Scenario: Serving function attempts PutItem
- **WHEN** code attempts a write
- **THEN** IAM SHALL deny it and an unexpected-write signal SHALL alarm

### Requirement: Fastest Datahike storage default is evidence-based
S3 and DynamoDB SHALL be benchmarked through the same deployed Datahike API with the same one-million-resource fixture, operation weights, cache states, region, architecture, concurrency, and repetitions. The accepted evidence SHALL record warm p95 and cold/restore first-result p95; ties within the declared uncertainty/tolerance SHALL prefer lower cold p95 and then lower projected cost.

#### Scenario: Evidence is stale after material change
- **WHEN** storage, runtime, fixture, region, or benchmark method changes
- **THEN** the prior winner SHALL lose its fastest evidence until rerun, while the last qualified deterministic default remains selected without a speed claim

### Requirement: Comparable S3 data requires a separately authorized blue-green generation
The adopted S3 store SHALL retain its honest legacy data identity and MUST NOT
be assigned the canonical fixture digest. Before S3 can participate in the
same-fixture DynamoDB benchmark, a distinct versioned SSE-S3 store generation
SHALL be seeded from the canonical one-million-resource fixture, verified, and
published through an explicit stateful workflow with a forecast, bounded
scope, separate maintenance identity, and no in-place mutation. The user's
existing DynamoDB seed authorization SHALL NOT be interpreted as authorization
for this additional S3 generation or its spend.

#### Scenario: DynamoDB is qualified before canonical S3 publication is authorized
- **WHEN** the only S3 profile uses the adopted noncanonical dataset
- **THEN** both profiles MAY remain independently usable, but the registry SHALL use its deterministic qualified fallback with no fastest claim and SHALL NOT run or publish comparable benchmark evidence

### Requirement: Runtime size is measured per storage profile
Each Datahike Lambda's lowest passing memory SHALL be established independently
against initialization, cold/restore/warm workload thresholds, zero correctness
failures, and at least 20% peak-memory headroom. One storage profile's minimum
MUST NOT be copied as qualification evidence for the other. While a comparable
speed claim is active, both profiles SHALL run the smallest common memory that
passes both independent gates (the larger of the two minima) and the same
qualified SnapStart state. Both production profiles SHALL force their immutable
reader before a published-version checkpoint, wait for AWS optimization, and
qualify restored storage reads. Switching lifecycle mode is a material change
that expires and reruns any comparison evidence.

Both production Datahike profiles SHALL publish a 1769 MiB primary variant and
MAY retain a 4096 MiB comparison variant. Each advertised variant SHALL qualify
independently with its exact memory, runtime, architecture, code identity, and
SnapStart optimization recorded. A larger variant MUST NOT be represented as a
performance improvement unless the same-fixture workload evidence supports the
claim, and avoidable initialization, whole-store warming, or repeated remote
reads SHALL still be optimized rather than hidden by memory alone.

#### Scenario: Smaller memory boots but violates latency
- **WHEN** a candidate starts but fails representative latency/error/headroom limits
- **THEN** it SHALL not be selected

#### Scenario: A 1769 MiB primary misses the qualification gate
- **WHEN** memory headroom passes but avoidable initialization or remote reads cause the timeout
- **THEN** the initialization path SHALL be profiled and reduced, and any 4096 MiB result SHALL remain a separately identified comparison rather than silently redefining the primary
