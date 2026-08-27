## Purpose

Define secure AWS delivery, GitHub/OIDC continuous deployment, independent profile rollout, Telegram cost controls, migration, rollback, and separately approved retirement.

## ADDED Requirements

### Requirement: Canonical CloudFront and private S3 delivery
`demo.eacl.dev` SHALL use one CloudFront distribution with private S3 origin access control. Public S3 access SHALL be blocked; HTML/registry SHALL revalidate quickly and content-hashed assets SHALL be immutable.

#### Scenario: Hashed asset is requested
- **WHEN** an asset is fetched through the canonical domain
- **THEN** CloudFront SHALL return compressed immutable content while anonymous S3 access remains denied

### Requirement: Server profiles use direct Lambda Function URLs
Each enabled server profile SHALL bind one exact alias-qualified Lambda Function URL origin in the closed client catalog. The browser SHALL send the profile's logical API path directly to that origin. CloudFront MUST NOT contain Lambda origins, API behaviors, API cache/request policies, Lambda origin access control, or Lambda invoke permissions.

#### Scenario: Same suffix targets two profiles
- **WHEN** Datahike/S3 and Datomic/DynamoDB bootstrap paths are requested
- **THEN** the browser SHALL call two distinct Lambda Function URL origins and each response SHALL identity-check

### Requirement: Direct Function URLs are CORS-scoped and read-only
Server Function URLs SHALL use `NONE` authorization so a browser can invoke them directly. Their alias policies SHALL allow public invocation only through the Function URL. Function URL CORS SHALL allow only `GET` and `POST`, the closed request-header set, and exactly `https://demo.eacl.dev`; wildcard origins and credentials MUST NOT be enabled. Because CORS does not authenticate non-browser clients, the public dispatcher and serving IAM SHALL remain bounded and read-only.

#### Scenario: Another browser origin attempts a request
- **WHEN** a browser from another origin sends a preflight
- **THEN** the Function URL SHALL omit permission for that origin while direct requests from `https://demo.eacl.dev` receive the exact CORS grant

### Requirement: Infrastructure and data lifecycles are independent
Foundation, each stateless runtime, and each stateful dataset SHALL be separate infrastructure units. A profile deployment MUST NOT replace another profile, database, or the canonical foundation.

#### Scenario: Jank deploys
- **WHEN** only Jank artifact/alias changes
- **THEN** no Datahike, Datomic, Datalevin, static, or DNS resource SHALL be replaced

### Requirement: Authoritative GitHub deployment branch
The public `theronic/eacl-demo` repository SHALL be authoritative for consolidated demo code, the pinned EACL Core revision, the deployment workflow, and all deployment runs, and use `demos` as its sole deployment branch. A commit reaching that branch SHALL deploy the exact demo commit and exact reachable EACL revision recorded by its dependency lock. Changes in `theronic/eacl` alone SHALL NOT trigger or coordinate a demo deployment.

#### Scenario: Pinned EACL revision advances
- **WHEN** a commit updating the EACL dependency lock reaches `theronic/eacl-demo:demos`
- **THEN** every eligible active-track demo profile SHALL be queued using that exact locked Core revision and the triggering demo commit, while ineligible or registered parked profiles SHALL remain unqueued and unavailable

### Requirement: GitHub deployment settings are fast and least privilege
The `demos` branch SHALL reject force-push/deletion and use pull-request merges without required approvals, formal checks, deployment reviewers, or wait timers. A separate no-review/no-wait GitHub environment for static and each active profile deployment role SHALL accept only that branch. A parked profile SHALL receive no ordinary production environment or role. Actions token permissions SHALL default read-only; deployment jobs SHALL request only `contents:read` and `id-token:write` plus narrowly necessary permissions. No cross-repository dispatch credential SHALL be created.

#### Scenario: Non-demos branch requests production OIDC
- **WHEN** an untrusted branch runs a workflow
- **THEN** GitHub environment policy and AWS trust conditions SHALL deny production credentials

### Requirement: AWS access uses OIDC and per-profile roles
GitHub SHALL store no long-lived AWS access key. Each static/profile job SHALL assume a dedicated least-privilege AWS role. The repository SHALL use an immutable custom subject composed in the exact order `repo`, `ref`, `workflow_ref`, `environment`, `event_name`, and `runner_environment`. Trust SHALL use `StringEquals` to require audience `sts.amazonaws.com`, the exact non-wildcard custom subject, immutable `theronic/eacl-demo` owner/repository IDs, exact repository, exact `refs/heads/demos` ref, exact top-level workflow name, and that role's exact GitHub environment. The custom subject SHALL bind `push` and `github-hosted` for ordinary deployment and `workflow_dispatch` for manual authorities. `workflow_ref`, `event_name`, and `runner_environment` SHALL be bound by the custom subject where AWS does not expose them as direct condition keys; `job_workflow_ref` SHALL be required in trust only for a job that actually runs a reusable workflow. A top-level job's claim capture MAY accept `job_workflow_ref` only when it equals the already validated `workflow_ref`, and MAY accept `job_workflow_sha` only when it equals `workflow_sha`; it SHALL reject any distinct called-workflow path or revision. It MUST NOT use an organization/repository/branch/workflow/environment/event/runner wildcard where an exact current claim is available. Because `id-token:write` exposes the OIDC request bearer to the whole job, every ordinary or manual OIDC job SHALL use only commit-pinned actions and directly invoked dependency-free checked-in entrypoints, disable checkout credential persistence, install no dependency, enable no package-manager cache, and execute no package-manager script. Before AWS credential configuration it SHALL signature-verify a dedicated GitHub JWT and retain only the exact allowlisted non-secret claims, never the JWT, its signature, request bearer, actor/run identity, commit SHA, token ID, or temporal claims. Repository-wide subject migration SHALL update all published OIDC role trusts before changing the GitHub template and SHALL remove any temporary exact legacy-subject alternative after all jobs pass.

#### Scenario: Datahike job requests Datomic permissions
- **WHEN** its assumed deployment role attempts a Datomic table or stack action
- **THEN** IAM SHALL deny it

#### Scenario: Another eacl-demo workflow requests a profile role
- **WHEN** an OIDC token has the correct repository and branch but a different workflow name, `workflow_ref` in its subject, reusable `job_workflow_ref` where applicable, environment, event, or runner environment
- **THEN** the role trust policy SHALL deny AssumeRoleWithWebIdentity

#### Scenario: Repository subject customization is enabled
- **WHEN** GitHub changes from the immutable default environment subject to the custom subject template
- **THEN** every published manual and future ordinary OIDC authority SHALL already trust its exact new subject, and the exact old subject SHALL be removed after verification

#### Scenario: A manual OIDC job prepares its AWS operation
- **WHEN** a qualification, transition, or stateful job has `id-token:write`
- **THEN** its pinned bootstrap SHALL capture and validate only the registered allowlisted claims before AWS configuration, and no dependency install, cache restore, package-manager script, or persisted checkout credential SHALL coexist in that job

### Requirement: Profile deployments fan out without fleet atomicity
Once any active ordinary target is eligible, each merge SHALL start an explicit unprivileged build job for static and every independently eligible active-track profile as soon as runners permit. Each target's separate credentialed deploy job SHALL depend only on that target's content-addressed artifact, verify its digest, and start as soon as that build finishes. An ineligible active target SHALL remain visible but unqueued and SHALL NOT suppress eligible siblings. Build jobs SHALL NOT receive OIDC; deploy jobs SHALL NOT install dependencies or rebuild. No target SHALL wait for a sibling, a parked profile, or a global artifact/success/eligibility barrier. Any matrix SHALL disable fail-fast and omit `max-parallel`. GitHub concurrency groups, cancel-in-progress, latest-head guards, and cross-run ordering SHALL NOT be required. Each pair SHALL deploy the exact demo commit and locked EACL revision checked out by its own run; mixed and out-of-order generations are accepted.

#### Scenario: One profile build fails
- **WHEN** Jank is later unparked and fails while JVM and static jobs pass
- **THEN** successful jobs SHALL continue/promote independently and Jank SHALL retain its prior healthy alias with visible/alerted lag

#### Scenario: A registered profile is parked
- **WHEN** Jank is marked `parked` in the closed build registry
- **THEN** ordinary merge deployment SHALL neither queue nor wait for Jank, and Datahike, Datomic, Datalevin, DataScript, and static targets SHALL retain independent eligibility and rollout

### Requirement: Merge CI builds deploys and smokes only
Ordinary branch CI SHALL restore/cache dependencies and build/package without OIDC, hand off a digest-verified artifact to a separate same-target deploy job, deploy immutable candidates, and run bounded health/bootstrap/identity/allow/deny/mutation-denial probes before per-profile promotion. The credentialed job MUST NOT install dependencies or execute build tooling. Neither job MUST run or await formal verification, full conformance, fault injection, load sizing, browser suites, data seeding, or state migrations.

#### Scenario: Dependency install is compromised
- **WHEN** install or build code attempts to request a GitHub OIDC token or use AWS deployment credentials
- **THEN** the build job SHALL have neither authority, and the later deploy job SHALL accept only the digest-verified handoff without rerunning that code

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
Before either durable table/seed, the system SHALL install on-demand read/write maximums, one-minute warning/critical consumption alarms at declared fractions of those limits, throttle alarms, write-frozen/serving unexpected-write alarms, actual-budget thresholds, and tag-scoped anomaly detection. All CloudWatch ALARM transitions, genuine ALARM-to-OK recovery transitions, and all available Budget/anomaly notifications SHALL reach a shared SNS/notifier path that calls Telegram and reuses the existing retained bot token. Per-alarm OK actions SHALL be absent so initial INSUFFICIENT_DATA-to-OK evaluation cannot generate false recovery notifications; a bounded same-account, alarm-name-scoped recovery rule SHALL select only a previous ALARM state.

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

### Requirement: Release reporting distinguishes definitions from live evidence
The system SHALL publish a closed, content-addressed release report covering every profile, exact source/artifact/data identity, storage-default evidence, fixture identity, memory setting, alarm/budget/Telegram status, and rollback coordinate. The top-level report-build source SHALL NOT be interpreted as fleet convergence; each profile deployment identity SHALL remain independently authoritative. A source template SHALL be reported as defined but not deployed or verified until immutable live evidence exists. Candidate memory SHALL NOT be reported as qualified, and an unavailable coordinate SHALL remain null with a reason.

#### Scenario: A pre-release report is generated from local definitions
- **WHEN** no consolidated demos-branch release or live readiness evidence exists
- **THEN** the report SHALL list every profile and exact local definition identity while keeping deployment, artifact, qualified memory, live-control evidence, and rollback coordinates absent and SHALL NOT complete the final release-report gate

#### Scenario: A storage default claims a benchmark winner
- **WHEN** the release report names a performance-selected storage default
- **THEN** its evidence ID SHALL resolve to the exact validated benchmark file whose backend, profile set, measurement time, and file digest match the selection

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
