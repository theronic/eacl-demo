## Context

See `proposal.md` for motivation. The audited estate is fragmented in both runtime and source control:

| Surface/source | Current useful evidence | Constraint |
| --- | --- | --- |
| `demo.eacl.dev/datahike/` | SolidJS plus Datahike/S3 on EC2, one million resources | Owns current DNS; retain as fallback through cutover |
| `serverless-datahike.demo.eacl.dev/datahike/` | Java arm64 Lambda/SnapStart reader against the same S3 store | Strongest deployed serverless baseline; adopt without reseeding |
| `explorer.eacl.dev` | Browser DataScript explorer | Old EACL/UI; preserve concept and migrate to isolated `/datascript/` artifact |
| `eacl-datomic-solidjs` | Newer SolidJS permission-detail behavior and current EACL v8 Datomic integration | Development startup writes/seeds and is not a read-only Lambda topology |
| `eacl-datalevin-solidjs` | Current adapter/lifecycle experiments | Repository remote is not an independent GitHub release authority; native/SnapStart topology needs initial qualification |
| `eacl-jank` | Native engine, in-memory demo, and macOS arm64 evidence | Remote is not yet a published release baseline; macOS artifacts cannot run on Lambda |

The user has initialized `/Users/petrus/code/eacl/eacl-demo` as a Git repository with `https://github.com/theronic/eacl-demo.git` as `origin`. The public GitHub repository was created on 2026-08-25 with immutable repository ID `1345904214` under owner ID `1011676`; these non-secret IDs are verified again before OIDC trust is created. This repository becomes the consolidated source authority. Existing sibling repositories remain evidence/import sources until their relevant code is reconciled; their current remotes and dirty worktrees are not release provenance.

Several platform facts determine the design:

1. Datomic Pro read-only connections return one fixed database/log value and support `d/db`, `d/log`, and `d/release`, not live synchronization. The current EACL Datomic source advertises modes whose authoritative/at-least/exact paths call `d/sync`. Therefore the read-only Lambda must serve direct snapshots over one captured `d/db` value and reject those modes before the generic source path. The underlying schema/storage still retains normal Datomic transaction history for the later separately qualified live EC2 demo.
2. The Datahike DynamoDB adapter path still needs repair for typed failures, consistent publication reads, unprocessed keys, deadlines, and real AWS behavior. DynamoDB Local cannot prove those properties.
3. Datalevin in-memory mode uses native resources whose snapshot ownership and SnapStart restore lifecycle need one-time deployment qualification.
4. Jank compiles natively. Lambda requires a Linux binary matching the configured architecture. `provided.al2023` supports x86_64 and arm64 custom runtimes, but AWS SnapStart excludes OS-only runtimes and container images. Upstream Jank currently exercises Linux release builds on GitHub's x64 `ubuntu-24.04` runner, not its arm64 runner, so Linux x86_64/AL2023 is the defensible initial target. Jank should start through AOT and does not need SnapStart.
5. AWS Budgets data is delayed; immediate DynamoDB cost defense must use on-demand maximums and CloudWatch consumption/throttle/write signals.
6. The current Datahike deployment already contains a tested Telegram notifier path using SNS, Lambda, an AWS-held token, and end-to-end ALARM/OK tests. Consolidation should generalize that implementation and reuse the token rather than introduce GitHub-held Telegram credentials.
7. GitHub currently has no branch protection on the relevant repositories. The user explicitly accepts uncoordinated and out-of-order workflow completion, so GitHub concurrency groups, latest-head guards, and cross-repository dispatch are unnecessary. AWS access can use OIDC rather than stored keys.

## Goals / Non-Goals

**Goals:**

- One stable URL and one source workspace for all demo presentation/contracts.
- Explicit backend selection followed by only supported deployed storage choices.
- Evidence-based fastest storage default within one backend, never a misleading global backend benchmark.
- Honest capability differences and exact source/deployment identity in every profile.
- Public read-only runtimes and private, bounded, recoverable data operations.
- Fast automatic deployment of every registered profile after a `demos` merge, with maximum parallelism and no fleet-atomic barrier.
- A failed profile retains the last healthy version and visibly/operationally reports that failed update while other profiles continue.
- Minimal merge gates: build, deploy, bounded smoke, promote/rollback. Formal verification is independent and non-blocking.
- No long-lived AWS access key, Telegram token, or cross-repository dispatch credential in GitHub.
- DynamoDB cost caps/alarms/budgets/anomaly detection routed to Telegram before durable seeding.

**Non-Goals:**

- A hosted authorization service, arbitrary user data/schema/query, public writes, or an SLA.
- Cursor or exact-basis portability across profiles, deployments, or browser workers.
- Fleet-wide atomic rollout or a requirement that every backend expose the same consistency/history/storage features.
- A formal-verification gate for demo build or deployment.
- Historical or at-exact-snapshot support from the Datomic read-only Lambda; a future non-read-only EC2 demo owns that problem.
- SnapStart for Jank, or representing its in-memory store as Datomic Pro/durable production storage.
- Automatic durable seeding, migration, replacement, or deletion on ordinary source merges.
- Automatic legacy destruction after cutover.

## Decisions

### 1. `theronic/eacl-demo` owns the consolidated product

The new repository contains shared UI/state/contract packages, deterministic fixtures, one service package per profile, browser worker code, infrastructure units, qualification/smoke tooling, deployment workflows, and runbooks. Adapter repositories remain upstream dependencies until separately moved.

Every build records two immutable identities:

- `demo-sha`: the `theronic/eacl-demo` commit providing services/UI/infrastructure;
- `eacl-sha`: the exact reachable `theronic/eacl` commit pinned by a dependency lock committed in that demo revision and providing EACL v8 modules/generated runtime.

Dirty local paths and mutable branch names are never published as artifact identity. Relevant current sibling work is imported deliberately into the new repository without modifying or overwriting those worktrees. An EACL Core change is deployed only after the lock update itself reaches `eacl-demo:demos`; activity in the Core repository does not coordinate or trigger this demo workflow.

### 2. The UI selects backend and storage separately

The first selector is a stable backend ID. The second is filtered by enabled registry entries:

| Backend | Storage options in this change | Runtime | Dataset |
| --- | --- | --- | --- |
| Datahike | S3, DynamoDB | managed Java arm64 Lambda; SnapStart where qualified | exactly 1,000,000 for both |
| Datomic | DynamoDB | managed Java Lambda, read-only Peer | exactly 1,000,000 |
| Datalevin | in-memory LMDB | managed Java Lambda/SnapStart | exactly 10,000 |
| Jank | bundled in-memory Datomic-like store | Linux x86_64 `provided.al2023` ZIP | exactly 10,000 |
| DataScript | browser memory | ClojureScript Web Worker | exactly 10,000 by default |

The internal key remains a composite profile ID such as `datahike-dynamodb`; routes, IAM, aliases, cursors, caches, and evidence stay profile-scoped. The canonical URL uses separate `backend` and `storage` parameters. Datahike is the neutral landing backend because a global speed comparison across unequal datasets/topologies is invalid.

Changing either selector is one client state transition: increment client epoch, cancel old requests, clear profile-owned bases/cursors/pages/cache/error state, validate portable semantic intent, and start the new profile from page one.

### 3. “Fastest” is a reproducible storage decision, not marketing

Only alternatives with the same backend and equal fixture/scale/region/runtime path/API/operation weights/cache states/concurrency/repetitions are ranked. For Datahike, the production-region S3 and DynamoDB profiles use the same one-million-resource fixture.

The evidence records at least warm p95 for the canonical interactive mix and cold/restore p95 to first result. The primary declared scoring rule is versioned with the workload. Results inside the declared uncertainty/tolerance are a tie, broken by lower cold/restore p95 and then lower projected monthly cost. The registry stores `defaultStorage`, evidence digest, method version, source/data identities, and timestamp.

Evidence expires after material storage/runtime/fixture/region/workload change. With one qualified option, that option is selected but no comparative speed claim is made. Until DynamoDB qualifies, Datahike/S3 remains the deterministic default.

### 4. One origin-visible domain uses path-isolated profiles

CloudFront serves the private S3 static origin and separate no-cache API behaviors:

```text
/                                  static main shell
/assets/*                          immutable main assets
/datascript/                       separate DataScript entry
/datascript/assets/*               DataScript-only assets
/api/v1/datahike-s3/*              Datahike/S3 alias
/api/v1/datahike-dynamodb/*        Datahike/DynamoDB alias
/api/v1/datomic-dynamodb/*         Datomic/DynamoDB alias
/api/v1/datalevin-memory/*         Datalevin alias
/api/v1/jank-memory/*              Jank alias
```

Function URLs use AWS IAM and CloudFront origin access control where supported. Direct anonymous origin invocation is denied. Foundation route additions occur during initial onboarding; ordinary profile merges do not contend on the shared CloudFront stack.

### 5. `explorer.v1` is capability-driven and N/N-1 compatible

Every success/error/descriptor includes exact profile, backend, storage, `eacl-sha`, `demo-sha`, artifact/deployment/data identity, capabilities, limits, and limitations. The UI identity-checks the route response.

Independent rollout means the shell may be N while one profile is N-1. Contract additions are optional/capability-discovered for one compatibility window. Incompatible semantics introduce `/api/v2` and dual support; they do not require a fleet-atomic release. The selector visibly reports each actually deployed source pair and its last deployment outcome.

Only portable semantic intent enters URLs/history. Cursors, basis tokens, revisions, request IDs, cached values, and seed state never do.

### 6. The fixture is deterministic and data lifecycles are separate

One fixture package defines stable IDs/schema/relationships/exemplars, a 10,000-resource prefix, and a 1,000,000-resource target. Each physical backend records achieved counts/digests. In-memory profiles rebuild and verify at initialization.

Durable seed jobs are private, idempotent, resumable, bounded, and observable. They are never called by the public API or ordinary merge workflow. Datahike and Datomic use different DynamoDB tables, roles, lifecycles, and recovery identities.

### 7. Adopt Datahike/S3 and repair Datahike/DynamoDB before enabling it

The existing S3 dataset/reader are adopted after source/config/store/basis/read-only/common-contract evidence. The store is not reseeded for consolidation.

The DynamoDB adapter must preserve typed failure categories, handle every unprocessed key, use strong publication reads or equivalent proof, implement deadline-aware bounded jittered retry, and remove destructive serving behavior. A disposable real AWS table exercises publication, throttling, permissions, timeouts, partial batches, corruption/missing distinction, cancellation, and load. Only then is the dedicated table seeded to one million and benchmarked against S3.

### 8. Datomic Lambda serves only one captured current value

Provisioning uses a temporary private transactor/EC2 lifecycle to create the database, install history-preserving schema, seed exactly one million resources, verify indexes/manifest/exemplars/final basis, record recovery identity, then stop the transactor and terminate compute. Relevant authorization attributes do not set `:db/noHistory true`; the qualification records multiple seed bases and proves normal-Peer `d/as-of` and history behavior before teardown.

Serving calls `d/connect` with `read-only=true`, captures `fixed-db = d/db(conn)` once per environment, and constructs direct EACL Datomic snapshots over `fixed-db`. Request validation advertises/accepts current/minimize-latency semantics only. It rejects fully-consistent, at-least-as-fresh, at-exact-snapshot, history-date, and live refresh before the generic source operations; instrumentation proves serving never calls `d/sync` or transact.

The table/database is immutable after publication. Data refresh is blue/green per profile: qualify a new data identity and function version, then move only that alias/descriptor. Retaining storage history does not change the Lambda's fixed-current public contract. The future live/history-capable Datomic EC2 serving deployment is outside this change.

### 9. Datalevin SnapStart remains a one-time topology gate

The maintained fork/native closure must support Linux arm64, explicit read snapshots, single owning platform-thread use/release, immutable public operation, and a durable source-lifecycle/watermark definition for deployment/rollback.

Initial qualification evaluates quiesced pre-checkpoint native state versus full post-restore in-memory construction, within AWS restore-hook limits. Repeated restore/eviction/concurrency/handle/lock/load evidence chooses the strategy. Ordinary merges do not rerun the campaign; they build, deploy, and smoke the already qualified topology.

### 10. DataScript remains a separate worker-backed entry

`/datascript/` shares UI/state/contract/fixture source but loads ClojureScript, EACL DataScript, DataScript, and worker only from its own build graph. The worker owns database/client/cache/cursor lifecycle and bounded request messages. The main bundle has a material-change qualification assertion proving those dependencies are unreachable.

### 11. Jank targets `provided.al2023` x86_64 and does not use SnapStart

Jank initially builds inside a pinned x86_64 Amazon Linux 2023-compatible environment on GitHub's x64 `ubuntu-24.04` runner or a temporary x86_64 AL2023 builder if nested tooling cannot qualify the host. This matches the architecture currently exercised by upstream Jank's Linux release workflow while avoiding a newer unproven Linux arm64 closure. A prebuilt digest-pinned builder image/cache avoids rebuilding the compiler on each merge. The artifact is a ZIP with executable root `bootstrap`, Linux x86_64 Jank executable, required compatible native libraries/resources, fixture input, and licenses. An arm64 migration remains possible only after a separate AL2023 toolchain/dependency/Lambda/performance qualification.

The function uses `provided.al2023`. SnapStart is neither available nor needed for this native OS-only runtime. Startup is optimized with AOT, a minimal native closure, deterministic fixture input, and measured memory/CPU. Initial Linux/Lambda semantic qualification and memory sizing remain required, but formal/source-linked certification is not a deployment gate. Merge CI only builds, deploys, and runs bounded public smoke.

The descriptor labels the store as a bundled in-memory Datomic-like conformance store and denies Datomic Pro, durability, Datalog, distribution, and production claims.

### 12. One `demos` branch triggers uncoordinated maximum-parallel deployment

`theronic/eacl-demo:demos` is the only deployment trigger. Its commit contains the exact EACL Core dependency lock, so a run needs no second branch lookup or cross-repository event. A trigger starts one static job and one job per registered server profile without a global build artifact or success barrier. The matrix uses `fail-fast: false` and no `max-parallel`. Static publishes both main/DataScript entries together to avoid conflicting S3-prefix writes.

There are deliberately no GitHub concurrency groups, cancel-in-progress settings, latest-head guards, or cross-run ordering. Every job deploys the exact `demo-sha` and locked `eacl-sha` checked out for that run. If two pushes overlap, either run may finish last for a profile. That user-approved trade-off maximizes speed and simplicity; descriptors always reveal the actually deployed identities.

If a job fails, it retains/restores that profile's last coherent alias/descriptor and records the failed update. Other jobs and runs continue. A later merge or explicit retry may replace it, but no fleet convergence or latest-source guarantee is claimed.

### 13. Merge deployment is deliberately small

Each job performs:

1. clean checkout at exact SHAs and dependency-cache restore;
2. build/package plus cheap artifact/configuration/read-only guards;
3. immutable candidate upload/version publication;
4. bounded health, descriptor identity, one allowed exemplar, one denied exemplar, and mutation-denial smoke through the production route;
5. per-profile promotion, or rollback/failure alert.

It does not await formal verification, full semantic conformance, browser/accessibility suites, fault injection, load/memory sweeps, data seeds, migrations, or other profiles. Initial enablement/material topology changes use separate manual qualification workflows. Formal workflows may continue independently but cannot gate demo deployment.

### 14. GitHub settings favor safe speed and AWS OIDC

`main` remains the development default; `demos` is the deployment branch. Rulesets block force-push/deletion and require pull-request merge with no required approval count. Separate environments such as `demo-production-static` and `demo-production-<profile>` accept only `demos` and have no reviewer or wait timer. This gives each deployment role a distinct OIDC subject without serializing the jobs. Head branches auto-delete after merge.

Repository Actions permissions default to read-only. Deploy jobs request `contents: read` and `id-token: write`; permissions are not broadened for the entire workflow. Before role creation, a non-secret claim audit verifies the current GitHub token format. AWS trust then matches `aud=sts.amazonaws.com`, the immutable owner/repository IDs, `ref=refs/heads/demos`, exact workflow and job-workflow references, the role-specific environment, and an exact non-wildcard subject. The static site and each profile use separate least-privilege deployment roles/stacks.

No AWS access key, Telegram token, or cross-repository dispatch credential is stored in GitHub. Non-secret region/account/role identifiers use environment variables. If a dependency repository proves it needs credentials in a clean locked-revision build, only that scoped credential is entered through the requested Chrome UI after its need and least privilege are demonstrated; no speculative dependency secret is created.

### 15. Cost controls precede DynamoDB and temporary compute

DynamoDB uses on-demand mode with per-table maximum read/write request units. The seed phase uses a bounded forecasted write maximum; after cutover, write access is removed from serving and unexpected writes alarm. Read maximums derive from qualified peak plus declared margin.

CloudWatch publishes one-minute consumption alarms at 70%/90% of configured bounds, throttle/max-throughput alarms, nonzero serving writes, system errors, and profile health. AWS Budgets provide 50%/80%/100% actual notifications against the forecast-plus-contingency seed/monthly envelopes; forecast notifications are used only when history exists. Tag-scoped Cost Anomaly Detection supplements them. Budgets are delayed and never substitute for throughput caps/metrics.

Alarm actions feed a shared SNS topic and a generalized version of the tested Datahike Telegram notifier. It reuses the retained AWS Secrets Manager token rather than copying it to GitHub or creating another secret. SNS alarm content is non-sensitive and does not require customer-managed KMS. DynamoDB uses AWS-owned encryption and S3 uses SSE-S3.

The user has authorized both table seeds and temporary EC2 compute for seeds, the Datomic transactor, or a Jank AL2023 build if required. The implementation still records exact tables/instance/roles, forecast/caps, and cleanup. Temporary instances have no inbound SSH, scoped instance profiles, IMDSv2, expiry tags/watchdog, and termination in cleanup by resolved instance ID. Completion proves no matching instance/volume/address remains billable; overdue cleanup sends critical Telegram notification.

### 16. Foundation, profiles, data, and retirement remain separate

Infrastructure units prevent a profile deploy from replacing shared DNS/static or another dataset. Stateful resources use retention/deletion protection and appropriate backups/exports. Per-profile alias promotion is coherent but there is no fleet-atomic registry move.

DNS cutover uses staging, tested legacy fallback, observation thresholds, and rollback. Cutover authorization is distinct from deletion. Legacy EC2/S3/Lambda/DNS/log/backup/certificate retirement resolves exact IDs, recovery evidence, costs, and receives separate approval.

## Risks / Trade-offs

- **[A UI deploy reaches an older profile]** → Maintain N/N-1 capability compatibility and version incompatible routes; show actual source identities.
- **[An older CI run finishes after a newer run]** → Accepted by user: make no latest-version claim and expose the actual demo/EACL/artifact identities after every promotion.
- **[One profile repeatedly fails]** → Preserve its last healthy alias, expose the failed deployment outcome, notify through the available operational path, and provide targeted retry.
- **[Fast merge CI misses a deep semantic regression]** → Keep one-time/material-change production qualification and independent scheduled/manual diagnostics; bounded allow/deny/identity/mutation smoke still gates every promotion.
- **[A branch merge mutates durable data]** → Ordinary roles/workflows lack seed/admin permissions; fixture mismatch fails closed and requires explicit stateful workflow.
- **[Datahike/DynamoDB outage appears as authorization absence]** → Repair typed failure handling and qualify real AWS faults before initial enablement.
- **[Datomic generic EACL source calls unsupported `d/sync`]** → Use captured direct DB snapshots, reject non-current modes at the profile boundary, and instrument no-sync tests.
- **[Datomic environments capture different heads]** → Stop the transactor/remove writers and treat the table/database as immutable before serving; blue/green replacements use new identity.
- **[Current-only Lambda is mistaken for history-free storage]** → Keep relevant attributes history-preserving, record multiple seed bases, prove normal-Peer as-of/history before teardown, and keep those controls hidden from Lambda.
- **[Jank build works on Ubuntu but not Lambda AL2023]** → Build inside matching x86_64 AL2023 environment and smoke the exact ZIP on Lambda before alias promotion.
- **[Jank Linux arm64 is assumed from macOS arm64 evidence]** → Use upstream-tested Linux x86_64 initially; treat arm64 as a separate migration gate and never reuse the macOS artifact.
- **[Telegram notification fails]** → Bounded retry, redacted notifier error metric/log/alarm, and acceptance test before seed/deployment.
- **[Budgets alert too late]** → Primary on-demand maximums plus one-minute consumption/throttle/write alarms.
- **[Temporary EC2 is orphaned]** → Expiry watchdog, critical Telegram alarm, `finally` termination by exact ID, and post-run absence/billing-resource verification.
- **[No Chrome connection prevents GitHub settings changes]** → Keep repository code/config work separate; do not substitute another UI surface when Chrome is explicitly required, and complete settings after the extension is connected.

## Migration Plan

1. Reconcile and strictly validate this OpenSpec change.
2. Establish clean initial commits in `theronic/eacl-demo`, create `demos`, and import shared behavior without modifying dirty sibling worktrees.
3. Implement contracts, two-step selector, fixtures, static entries, and profile packages locally.
4. Connect Chrome; configure GitHub rules, environments, variables, and Actions permissions; add no CI secret unless a clean locked-dependency build proves one is required.
5. Reauthenticate the AWS profile; deploy OIDC provider/trust and separate static/profile/seed roles plus Telegram/cost-control foundation.
6. Adopt Datahike/S3 and qualify each new topology/storage using separate initial workflows.
7. Install throughput caps/alarms/budgets/anomaly/Telegram tests before durable seeding; seed Datahike/DynamoDB and Datomic/DynamoDB; terminate and verify temporary compute.
8. Benchmark comparable Datahike storages and publish the evidenced default.
9. Implement the fast `eacl-demo:demos` workflow with the pinned EACL revision, maximum-parallel profile jobs, bounded smoke, per-job rollback, and actual-identity reporting, without GitHub concurrency management.
10. Deploy to staging, run initial material-change browser/contract qualification, and rehearse independent rollback.
11. Cut over DNS with legacy fallbacks and observe.
12. Reconcile/retire legacy resources only through separately approved destructive batches.

## Confidence Assessment

- **High:** two-step selector/profile isolation; fixed-value Datomic read-only semantics; Jank cannot use SnapStart and must target Linux; single-branch uncoordinated GitHub deployment and OIDC mechanics; DynamoDB AWS-owned encryption; budget-delay implications.
- **Moderate until measured:** fastest Datahike storage, exact Lambda memory sizes, Datalevin restore strategy, Jank cold-start latency, and cost envelopes.
- **Unknown until external execution:** current live AWS resource state because the configured AWS session is expired; GitHub UI settings because Chrome is not connected; clean Linux Jank builder success; real Datahike/DynamoDB fault behavior.

No finite planning audit can prove absence of unknown defects. The design attains defensible confidence by making every uncertain claim an executable gate, refusing unproven capability/speed claims, keeping stateful actions separate, and retaining a healthy rollback for each independently deployed profile.

## References

- Datomic read-only connections: https://docs.datomic.com/operation/read-only.html
- Datomic storage: https://docs.datomic.com/operation/storage.html
- AWS Lambda SnapStart: https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html
- AWS Lambda OS-only runtimes: https://docs.aws.amazon.com/lambda/latest/dg/runtimes-provided.html
- Upstream Jank Linux workflow: https://github.com/jank-lang/jank/blob/main/.github/workflows/build-compiler%2Bruntime.yml
- GitHub-hosted runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- GitHub Actions workflow syntax: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- GitHub OIDC: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers
- AWS GitHub OIDC condition keys: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html#condition-keys-wif
- DynamoDB on-demand maximum throughput: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html
- DynamoDB encryption: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/encryption.howitworks.html
- DynamoDB metrics: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/metrics-dimensions.html
- AWS Budgets: https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html
- Telegram Bot API: https://core.telegram.org/bots/api
