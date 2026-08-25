## Purpose

Define secure AWS delivery, GitHub/OIDC continuous deployment, independent profile rollout, Telegram cost controls, migration, rollback, and separately approved retirement.

## ADDED Requirements

### Requirement: Canonical CloudFront and private S3 delivery
`demo.eacl.dev` SHALL use one CloudFront distribution with private S3 origin access control. Public S3 access SHALL be blocked; HTML/registry SHALL revalidate quickly and content-hashed assets SHALL be immutable.

#### Scenario: Hashed asset is requested
- **WHEN** an asset is fetched through the canonical domain
- **THEN** CloudFront SHALL return compressed immutable content while anonymous S3 access remains denied

### Requirement: Path-isolated non-cached profile origins
Each enabled server profile SHALL have a distinct API behavior and Lambda alias origin. API caching SHALL be disabled and behavior/path/identity routing automatically smoke-tested.

#### Scenario: Same suffix targets two profiles
- **WHEN** Datahike/S3 and Datomic/DynamoDB bootstrap paths are requested
- **THEN** CloudFront SHALL route to distinct aliases and each response SHALL identity-check

### Requirement: Lambda origins are not directly public
Where supported, CloudFront SHALL sign IAM-protected Function URL origins. Direct unauthenticated origin invocation SHALL fail.

#### Scenario: Caller bypasses CloudFront
- **WHEN** the Function URL is invoked without AWS authorization
- **THEN** Lambda SHALL deny it before the handler

### Requirement: Infrastructure and data lifecycles are independent
Foundation, each stateless runtime, and each stateful dataset SHALL be separate infrastructure units. A profile deployment MUST NOT replace another profile, database, or the canonical foundation.

#### Scenario: Jank deploys
- **WHEN** only Jank artifact/alias changes
- **THEN** no Datahike, Datomic, Datalevin, static, or DNS resource SHALL be replaced

### Requirement: Authoritative GitHub deployment branch
The public `theronic/eacl-demo` repository SHALL be authoritative for consolidated demo code, the pinned EACL Core revision, the deployment workflow, and all deployment runs, and use `demos` as its sole deployment branch. A commit reaching that branch SHALL deploy the exact demo commit and exact reachable EACL revision recorded by its dependency lock. Changes in `theronic/eacl` alone SHALL NOT trigger or coordinate a demo deployment.

#### Scenario: Pinned EACL revision advances
- **WHEN** a commit updating the EACL dependency lock reaches `theronic/eacl-demo:demos`
- **THEN** every registered demo profile SHALL be queued using that exact locked Core revision and the triggering demo commit

### Requirement: GitHub deployment settings are fast and least privilege
The `demos` branch SHALL reject force-push/deletion and use pull-request merges without required approvals, formal checks, deployment reviewers, or wait timers. A separate no-review/no-wait GitHub environment for static and each profile deployment role SHALL accept only that branch. Actions token permissions SHALL default read-only; deployment jobs SHALL request only `contents:read` and `id-token:write` plus narrowly necessary permissions. No cross-repository dispatch credential SHALL be created.

#### Scenario: Non-demos branch requests production OIDC
- **WHEN** an untrusted branch runs a workflow
- **THEN** GitHub environment policy and AWS trust conditions SHALL deny production credentials

### Requirement: AWS access uses OIDC and per-profile roles
GitHub SHALL store no long-lived AWS access key. Each static/profile job SHALL assume a dedicated least-privilege AWS role. Trust SHALL require audience `sts.amazonaws.com`, the immutable `theronic/eacl-demo` owner/repository identity, exact `refs/heads/demos` ref, exact workflow or job-workflow reference, and that role's exact GitHub environment. It MUST NOT use an organization/repository/branch/environment wildcard where an exact current claim is available.

#### Scenario: Datahike job requests Datomic permissions
- **WHEN** its assumed deployment role attempts a Datomic table or stack action
- **THEN** IAM SHALL deny it

#### Scenario: Another eacl-demo workflow requests a profile role
- **WHEN** an OIDC token has the correct repository and branch but a different workflow, job-workflow reference, or environment
- **THEN** the role trust policy SHALL deny AssumeRoleWithWebIdentity

### Requirement: Profile deployments fan out without fleet atomicity
Each merge SHALL start static and profile jobs as soon as runners permit, with matrix fail-fast disabled, no `max-parallel`, and no cross-profile success barrier. GitHub concurrency groups, cancel-in-progress, latest-head guards, and cross-run ordering SHALL NOT be required. Each job SHALL deploy the exact demo commit and locked EACL revision checked out by its own run; mixed and out-of-order generations are accepted.

#### Scenario: One profile build fails
- **WHEN** Jank fails while JVM and static jobs pass
- **THEN** successful jobs SHALL continue/promote independently and Jank SHALL retain its prior healthy alias with visible/alerted lag

### Requirement: Merge CI builds deploys and smokes only
Ordinary branch CI SHALL restore/cache dependencies, build/package, deploy immutable candidates, and run bounded health/bootstrap/identity/allow/deny/mutation-denial probes before per-profile promotion. It MUST NOT run or await formal verification, full conformance, fault injection, load sizing, browser suites, data seeding, or state migrations.

#### Scenario: Formal workflow is slow or failing
- **WHEN** independent formal verification has not completed
- **THEN** it SHALL neither delay nor determine demo deployment

### Requirement: Stateful operations never run from ordinary merge deployment
DynamoDB/S3 creation, schema installation, seeding, migration, deletion, and temporary EC2/transactor provisioning SHALL use explicit separate workflows with resource resolution, cost controls, idempotency, and cleanup.

#### Scenario: Merge changes fixture generation
- **WHEN** the normal deploy detects a durable fixture identity mismatch
- **THEN** it SHALL fail that profile without mutating the active dataset

### Requirement: Per-profile publication and rollback remain coherent
Within one profile, immutable artifact, descriptor, and data identity SHALL agree before alias promotion. There is no atomic registry/fleet move. Failure SHALL preserve or restore the previous matching profile version.

#### Scenario: Descriptor upload succeeds but alias move fails
- **WHEN** a partial profile rollout would mismatch identities
- **THEN** identity checks SHALL reject it and the previous coherent alias/descriptor SHALL remain usable

### Requirement: Least privilege and low-cost encryption
Serving and seed roles SHALL be separate and resource-specific. DynamoDB SHALL use AWS-owned encryption, S3 SHALL use SSE-S3, alarm SNS SHALL carry no secrets and require no customer-managed KMS key, and the existing AWS-held Telegram token SHALL not be copied to GitHub/browser/static configuration.

#### Scenario: New customer-managed KMS key is planned
- **WHEN** no regulatory or cross-account requirement justifies it
- **THEN** validation SHALL reject the added key and use the documented AWS-owned/service encryption choice

### Requirement: DynamoDB cost controls notify Telegram
Before either durable table/seed, the system SHALL install on-demand read/write maximums, one-minute warning/critical consumption alarms at declared fractions of those limits, throttle alarms, serving-phase unexpected-write alarms, actual-budget thresholds, and tag-scoped anomaly detection. All CloudWatch alarm and recovery transitions and all available Budget/anomaly notifications SHALL reach a shared SNS/notifier path that calls Telegram and reuses the existing retained bot token.

#### Scenario: Read consumption reaches warning threshold
- **WHEN** table consumption breaches the declared warning window
- **THEN** CloudWatch SHALL publish a profile/table-specific Telegram notification before delayed billing totals are relied upon

#### Scenario: Telegram rejects a message
- **WHEN** notifier delivery fails
- **THEN** the invocation SHALL fail for bounded retry, emit a redacted error metric/log, and alarm through the documented fallback path without logging the token

### Requirement: Budgets complement rather than replace immediate alarms
Seed and monthly serving envelopes SHALL be derived from recorded forecasts plus declared contingency and notify at 50%, 80%, and 100%. Because billing data is delayed, budgets SHALL NOT be the only guard; table caps and CloudWatch consumption alarms remain primary.

#### Scenario: Forecast history is insufficient
- **WHEN** forecasted-budget data is unavailable
- **THEN** actual thresholds, anomaly detection, throughput caps, and consumption alarms SHALL remain active

### Requirement: Temporary EC2 compute is guaranteed to terminate
Any temporary seed, transactor, or Jank-build instance SHALL have no inbound SSH, a scoped role, IMDSv2, expiry/owner/purpose tags, bounded runtime, a cleanup path that terminates by exact instance ID, and a watchdog/Telegram alarm if it remains running past expiry. Final evidence SHALL prove no matching instance is pending/running/stopping/stopped and no unintended volume/address remains billable.

#### Scenario: Seed process exits exceptionally
- **WHEN** provisioning fails or is interrupted
- **THEN** cleanup SHALL still terminate the resolved instance and verify terminal absence; failure to do so SHALL produce a critical Telegram alert

### Requirement: Observability precedes public enablement
Each profile SHALL emit redacted request/error/duration/init/throttle/timeout/OOM/storage metrics, retain bounded logs, expose health/bootstrap/exemplar synthetics, and provide dashboards/alarms/runbooks before enablement.

#### Scenario: Storage throttling rises
- **WHEN** the error threshold crosses its window
- **THEN** dashboard and Telegram alarm SHALL identify the exact profile/table and safe error class

### Requirement: Staged DNS cutover and legacy compatibility
The distribution SHALL be validated under a temporary hostname, prior services retained at tested fallbacks, and immediate checks run after Route 53 cutover. Legacy host redirects SHALL preserve only compatible portable parameters, never opaque cursors/tokens.

#### Scenario: Cutover checks fail
- **WHEN** canonical health/routing/semantic thresholds fail
- **THEN** operators SHALL restore the prior DNS/profile target without modifying stateful data

### Requirement: Retirement is separately approved
Cutover/continuous deployment SHALL NOT delete or permanently stop legacy EC2, S3, DynamoDB, Lambda versions, distributions, logs, backups, or certificates. Retirement SHALL resolve exact IDs, backups, dependencies, cost, recovery, and obtain explicit approval per destructive batch.

#### Scenario: Observation window expires
- **WHEN** the new site is healthy
- **THEN** the system SHALL produce a retirement plan rather than automatically delete legacy resources
