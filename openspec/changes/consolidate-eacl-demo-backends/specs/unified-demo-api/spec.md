## Purpose

Define a stable bounded read-only explorer contract that remains compatible while backend/storage/execution profiles deploy independently.

## ADDED Requirements

### Requirement: Simple profile-owned logical contract and mixed-generation compatibility
All profiles SHALL implement the same normalized logical operations and data/error shapes. Each server profile SHALL own one origin and expose operations directly at root paths such as `/health`, `/bootstrap`, `/lookup-resources`, and `/check-permission`; paths MUST NOT contain an `/api` prefix, route version, backend name, storage name, composite profile ID, or execution platform. The permission operation SHALL be named `check-permission`, not `authorize`. The direct DataScript page runtime SHALL implement the same logical operations without a second protocol. Descriptor metadata SHALL declare contract major and compatible range. An N client SHALL remain compatible with N-1 profile descriptors during independent rollout; an incompatible descriptor SHALL fail during bootstrap rather than add transport noise to every operation path.

#### Scenario: Shell deploys before one backend
- **WHEN** the current shell contacts a healthy N-1 profile during a non-atomic rollout
- **THEN** it SHALL use the compatible descriptor/operations without inventing unsupported fields or requiring fleet coordination

#### Scenario: Browser checks a permission
- **WHEN** the active server profile checks whether a subject has a permission
- **THEN** the browser SHALL POST directly to that profile's `<function-url>/check-permission` path with no `/api`, version, backend, storage, or profile path segment

#### Scenario: Bootstrap returns an incompatible contract major
- **WHEN** the descriptor's declared compatibility range excludes the shell contract major
- **THEN** the shell SHALL reject that profile before ordinary operations and SHALL NOT retry through a versioned or platform-prefixed route

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

#### Scenario: Direct profile origin is misbound
- **WHEN** the `datalevin-memory` Function URL returns a descriptor identifying `datahike-s3`
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
- **THEN** minimize-latency, fully-consistent, at-least-as-fresh, and at-exact-snapshot SHALL select or validate against that immutable deployed value without calling Datomic synchronization or implying a live head

#### Scenario: Datahike exact selection names an older basis
- **WHEN** a Datahike caller requests at-exact-snapshot with a token other than the environment's current captured basis
- **THEN** the profile SHALL return a typed exact-snapshot-unavailable error rather than reconstruct, silently advance, or return a different basis

### Requirement: Cancellation deadlines and overload are typed
Server operations SHALL have bounded deadlines, cancellation, and per-environment resource admission. Production Lambda functions MUST NOT reserve or cap account concurrency, so a cost guard SHALL NOT create `ReservedFunctionConcurrentInvocationLimitExceeded`. Disconnect/cancellation, deadline, storage throttle, and busy admission SHALL remain distinct safe errors where the runtime can distinguish them.

#### Scenario: DynamoDB throttles a read
- **WHEN** a recognized throttle exhausts bounded deadline-aware retry
- **THEN** the profile SHALL return `throttled`, which the client recognizes as retryable, never not-found authorization data

### Requirement: Responses are deterministic and bounded
Normalized ordering, pages, count truncation, object/relationship representation, cache status, and errors SHALL have one documented meaning. Bodies/diagnostics SHALL have maximum sizes.

#### Scenario: Count reaches its ceiling
- **WHEN** authorized resources exceed the requested count limit
- **THEN** the response SHALL return the limit, `truncated=true`, and no fabricated exact total
