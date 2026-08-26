## Purpose

Define a stable bounded read-only explorer contract that remains compatible while backend/storage profiles deploy independently.

## ADDED Requirements

### Requirement: Versioned logical contract and mixed-generation compatibility
All profiles SHALL implement `explorer.v1` logical operations and normalized data/error shapes. Server profiles SHALL expose them below `/api/v1/{profile-id}` and the DataScript worker SHALL expose the same logical operations through structured messages. An N client SHALL remain compatible with N-1 profile descriptors during independent rollout; incompatible behavior SHALL use a new versioned route.

#### Scenario: Shell deploys before one backend
- **WHEN** the current shell contacts a healthy N-1 profile during a non-atomic rollout
- **THEN** it SHALL use the compatible descriptor/operations without inventing unsupported fields or requiring fleet coordination

### Requirement: Bootstrap identifies exact sources and ordinary responses stay compact
Health and bootstrap SHALL establish the exact profile, EACL Core SHA, demo SHA, deployment/artifact identity, dataset identity, and basis before ordinary operations. Every backend SHALL then use the same prior consumer-facing envelope: success is `{data, meta}`, failure is `{error, meta}`, and metadata is revision, request ID, and elapsed/cache fields when meaningful. Ordinary responses MUST NOT repeat an `ok` flag, deployment identity, contract version, operation, structured basis, retryability, authorization reason, or explanation path. Every failure SHALL return only a stable code, safe message, and compact request metadata when available; clients infer retry behavior from the stable code.

#### Scenario: Permission check succeeds
- **WHEN** a permission check completes
- **THEN** it SHALL return only the allowed decision plus revision, request ID, and optional elapsed/cache metadata, relying on the already validated profile bootstrap for deployment identity

#### Scenario: Internal exception occurs
- **WHEN** an adapter throws unexpectedly
- **THEN** the response SHALL use a stable internal-error shape without a stack trace, credential, connection URI, signing material, filesystem path, or unbounded exception data

### Requirement: Identity-checked bootstrap descriptor
Each descriptor SHALL contain stable profile, backend, storage, runtime, dataset manifest/counts, EACL Core/demo source SHAs, artifact/deployment digest, capability set, consistency semantics, limits, mutability, known limitations, and current/target deployment status. Its identity MUST agree with the statically selected route.

#### Scenario: CloudFront origin is misrouted
- **WHEN** the `datalevin-memory` route returns a descriptor identifying `datahike-s3`
- **THEN** client and deployment smoke checks SHALL reject it before explorer operations

### Requirement: Public route allowlist is read-only
Server profiles SHALL allow only health, bootstrap, bounded subject listing, EACL lookup/count/relationship/permission reads, schema read, advertised cache inspection, and advertised snapshot behavior. Public writes, setup, benchmark, arbitrary query, transaction, and administration routes MUST be rejected before implementation work.

#### Scenario: Caller attempts seed mutation
- **WHEN** a caller posts to a seed/setup route
- **THEN** the artifact SHALL reject it before any database, cache, fixture, or lifecycle change

### Requirement: Closed inputs and bounded work
Every request SHALL validate content type, method, body/JSON/string sizes, closed keys, enum/schema/permission values, page/count/cursor/deadline bounds, and aggregate structural ceilings before unbounded work.

#### Scenario: Unknown semantic field is supplied
- **WHEN** a caller includes an unsupported consistency or query field
- **THEN** the service SHALL reject it rather than ignore a potentially security-relevant input

### Requirement: Cursor and basis scope is explicit
Cursors and exact-basis tokens SHALL be opaque/authenticated where supported and bound to profile, source lifecycle, dataset, query shape, and basis semantics. They MUST NOT transfer across storage/backend profiles or silently advance.

#### Scenario: Cursor crosses a storage switch
- **WHEN** a Datahike/S3 cursor is submitted to Datahike/DynamoDB
- **THEN** the receiver SHALL return a typed invalid-scope error before page data

### Requirement: Consistency claims are executable
A profile SHALL advertise only modes executable through its production topology. Responses SHALL identify the selected basis when meaningful; refresh SHALL exist only when it establishes the described semantics.

#### Scenario: Datomic fixed snapshot is served
- **WHEN** the Datomic Lambda uses a read-only connection's fixed `d/db` value
- **THEN** it SHALL expose no meaningless `current` choice, use the fixed lowest-latency snapshot internally, and reject exact-history, at-least, fully-consistent, and live-refresh requests without calling Datomic synchronization

### Requirement: Cancellation deadlines and overload are typed
Server operations SHALL have bounded deadlines, cancellation, and concurrency admission. Disconnect/cancellation, deadline, storage throttle, and busy admission SHALL remain distinct safe errors where the runtime can distinguish them.

#### Scenario: DynamoDB throttles a read
- **WHEN** a recognized throttle exhausts bounded deadline-aware retry
- **THEN** the profile SHALL return `throttled`, which the client recognizes as retryable, never not-found authorization data

### Requirement: Responses are deterministic and bounded
Normalized ordering, pages, count truncation, object/relationship representation, cache status, and errors SHALL have one documented meaning. Bodies/diagnostics SHALL have maximum sizes.

#### Scenario: Count reaches its ceiling
- **WHEN** authorized resources exceed the requested count limit
- **THEN** the response SHALL return the limit, `truncated=true`, and no fabricated exact total
