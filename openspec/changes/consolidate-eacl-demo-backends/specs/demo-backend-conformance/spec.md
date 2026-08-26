## Purpose

Define deterministic fixtures, initial backend qualification, lightweight continuous-deployment smoke gates, comparable storage evidence, provenance, and truthful profile behavior.

## ADDED Requirements

### Requirement: Canonical deterministic fixture manifest
One versioned manifest SHALL define EACL v8 schema, stable IDs, generation seed/algorithm, 10,000 and 1,000,000 cut points, expected counts, relationships, exemplars, schema/generator digests, and manifest digest. The small profile SHALL be a semantic prefix of the large profile.

#### Scenario: Two small profiles initialize
- **WHEN** Datalevin and DataScript build the accepted fixture
- **THEN** physical storage MAY differ but stable objects, relationships, schema, exemplars, and fixture digest SHALL agree

### Requirement: Initial production-path qualification is separate from merge CI
Before first public enablement or after a material storage/topology change, each profile SHALL run its advertised operations through production transport, normalization, EACL client, immutable snapshot, adapter, and real runtime/storage. This qualification is not repeated by ordinary `demos` merges and formal verification MUST NOT be a demo enablement or deployment requirement.

#### Scenario: Unit tests pass but route is wrong
- **WHEN** adapter tests pass but staged CloudFront behavior diverges
- **THEN** initial qualification SHALL fail and the profile SHALL remain unavailable

### Requirement: Common authorization semantics
Supported fixture cases SHALL agree on direct/arrow permissions, cycles, duplicates, forward/reverse discovery, relationship filters, reverse subjects, counts/truncation, and stable semantic ordering.

#### Scenario: One backend disagrees on an exemplar
- **WHEN** the same applicable exemplar differs
- **THEN** the discrepant profile SHALL fail initial qualification

### Requirement: Pagination cursor and cache safety
Qualified profiles SHALL prove advertised page directions/bounds, no duplicates/gaps, cursor tamper/wrong-scope rejection, no silent fall-forward, and cache enabled/disabled semantic equivalence.

#### Scenario: Cursor is modified
- **WHEN** an authenticated cursor byte changes
- **THEN** the profile SHALL return invalid-cursor before data

### Requirement: Capability and limitation truthfulness
Executable checks SHALL compare descriptor claims with behavior/infrastructure. Profiles MUST NOT advertise unsupported consistency, liveness, history, mutation, durability, runtime, dataset size, source identity, or qualification.

#### Scenario: Datomic exact history is advertised
- **WHEN** the fixed-current Lambda descriptor lists at-exact-snapshot
- **THEN** enablement/smoke SHALL fail and the UI SHALL not expose it

### Requirement: Provenance manifest binds both repositories
Each candidate SHALL bind immutable EACL Core SHA, demo SHA, dependencies, toolchain/architecture, fixture/data identity, infrastructure digest, artifact digest, non-secret configuration, and applicable evidence. Aliases SHALL resolve to the recorded artifact.

#### Scenario: Running alias drifts
- **WHEN** an alias points to an unrecorded artifact
- **THEN** monitoring SHALL mark the profile unhealthy or lagging until reconciled

### Requirement: Failure security and memory qualification
Initial qualification SHALL cover bounded input, cancellation/deadline cleanup, overload, retry classification, IAM denial, artifact/dependency review, redaction, no public mutations, storage fault injection where applicable, and representative cold/restore/warm memory/load with at least 20% peak headroom.

#### Scenario: Secret-like text reaches an exception
- **WHEN** a test exception contains a URI, token, or filesystem path
- **THEN** neither response nor retained structured logs SHALL expose it

### Requirement: Storage performance evidence is comparable
A fastest-storage decision SHALL compare only profiles of the same backend with equal dataset, region, production transport, runtime architecture, operation weights, cache states, concurrency, repetitions, and scoring. Reports MUST label unequal comparisons and SHALL expire evidence after material change.

#### Scenario: Ten-thousand profile is charted with million-resource profile
- **WHEN** cross-backend results are presented
- **THEN** dataset scale SHALL be prominent and no global fastest claim SHALL be derived

### Requirement: Merge deployment gate is deliberately small
Every `demos` merge SHALL build/package each independently eligible active-track profile in an unprivileged job, pass its content-addressed artifact to a separate digest-verifying credentialed job, deploy an immutable candidate, and run bounded health, bootstrap/identity, one allowed exemplar, one denied exemplar, and public-mutation-denial probes. It SHALL NOT wait for formal verification, full conformance, fault campaigns, load sweeps, browser suites, ineligible siblings, or a registered parked profile. Ineligible and parked profiles SHALL remain fail-closed and SHALL NOT be queued by ordinary merge deployment.

#### Scenario: One smoke probe fails
- **WHEN** the candidate returns the wrong identity or exemplar
- **THEN** that profile SHALL retain/restore its previous alias, report lag, notify operators, and SHALL NOT cancel unrelated profile deployments

### Requirement: Initial browser and bundle qualification remains available
Before initial cutover and after material shell/contract changes, the staged domain SHALL prove principal desktop/mobile accessibility, history/share links, stale-response switching, identity/routing, cache headers, API no-cache, and DataScript bundle exclusion. Ordinary merges require only build and bounded public smoke.

#### Scenario: Main bundle imports DataScript
- **WHEN** bundle analysis finds browser database code reachable from `/`
- **THEN** initial/material-change qualification SHALL fail
