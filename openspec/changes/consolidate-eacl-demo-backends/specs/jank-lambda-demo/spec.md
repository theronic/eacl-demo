## Purpose

Define a fast-starting native Jank demonstration compiled for an Amazon Linux 2023 x86_64 Lambda custom runtime and its explicitly limited in-memory store.

## ADDED Requirements

### Requirement: Amazon Linux 2023 x86_64 artifact
The Jank Lambda SHALL initially be compiled for Linux x86_64 in a pinned x86_64 Amazon Linux 2023-compatible builder and deployed as a ZIP custom runtime using `provided.al2023` with Lambda architecture `x86_64`. This is the conservative target because current upstream Linux CI qualifies x64 Ubuntu rather than Linux arm64; an arm64 switch would require separate toolchain, dependency, Lambda, and performance qualification. The manifest SHALL bind exact Jank/EACL/demo source SHAs, toolchain, build flags, native dependency closure, architecture, runtime adapter, and artifact digest. Mach-O, Homebrew-linked, arm64-only, or non-AL2023-compatible artifacts MUST be rejected.

#### Scenario: Existing macOS AOT binary is offered
- **WHEN** the artifact is Mach-O or links to macOS/Homebrew libraries
- **THEN** deployment SHALL reject it before AWS publication

### Requirement: Reproducible custom runtime package
The ZIP SHALL contain executable `bootstrap`, the Linux Jank executable, and only required compatible libraries/resources, fixture input, and licenses. It SHALL implement the Lambda Runtime API/Function URL event shapes and rebuild reproducibly or with documented normalized nondeterminism.

#### Scenario: Package is inspected
- **WHEN** the deployment ZIP is produced
- **THEN** `bootstrap` SHALL be executable at its root and every native dependency SHALL resolve on the matching AL2023 x86_64 environment

### Requirement: Lambda semantic smoke does not require formal verification
Initial qualification SHALL prove the common public semantics and runtime ownership through the actual Lambda transport. Ordinary `main` merges SHALL require only build/package plus bounded health, bootstrap identity, one allowed exemplar, one denied exemplar, and mutation-denial probes. Formal models, source-linked certification, sanitizers, fault campaigns, and load suites MUST NOT gate demo deployment.

#### Scenario: Independent formal workflow is incomplete
- **WHEN** the Jank artifact builds and Lambda smoke passes but formal verification has not run
- **THEN** the demo candidate SHALL remain eligible for promotion

### Requirement: In-memory store is labeled honestly
The descriptor/UI SHALL name “bundled in-memory Datomic-like conformance store” and disclose it is not Datomic Pro, durable, distributed, Datalog-compatible, or a production database.

#### Scenario: User opens Jank
- **WHEN** bootstrap completes
- **THEN** the limitation summary SHALL be visible with Jank, Lambda, and memory identity

### Requirement: Deterministic immutable 10,000-resource runtime
Each environment SHALL create exactly 10,000 resources from the canonical fixture, verify digest/exemplars before readiness, expose no public mutation, and avoid request-local/cancellation/snapshot leakage across warm invocations.

#### Scenario: Cancelled request is followed by another
- **WHEN** a prior traversal was cancelled
- **THEN** the next request SHALL start without leaked request-local state

### Requirement: SnapStart is unsupported and unnecessary
The Jank function SHALL rely on native AOT startup and MUST NOT enable, require, or claim Lambda SnapStart because `provided.al2023` is an OS-only runtime. The profile SHALL meet its accepted startup threshold without SnapStart; provisioned concurrency is optional only if later measurements justify its recurring cost.

#### Scenario: Infrastructure requests SnapStart
- **WHEN** the Jank custom-runtime plan enables SnapStart
- **THEN** validation SHALL fail

### Requirement: Native startup and memory are measured
The selected configuration SHALL be the lowest tested memory that passes repeated cold/warm initialization, the 10,000-resource smoke/workload, process/native headroom of at least 20%, timeouts/errors, and declared cold-to-first-result threshold. It MUST NOT copy a JVM setting.

#### Scenario: Low memory is intermittently slow
- **WHEN** repeated new environments time out, exit, violate headroom, or miss startup threshold
- **THEN** the next larger memory setting SHALL be tested

### Requirement: Public route and IAM surface is minimal
The Lambda SHALL expose only the shared read allowlist and need no database-service permission beyond configuration/log/metric needs. Development setup, mutation, raw benchmark, and LAN-server routes MUST be absent.

#### Scenario: Development benchmark route is invoked
- **WHEN** a caller requests `/api/benchmark` or `/api/setup`
- **THEN** the Lambda SHALL reject it without starting the workload
