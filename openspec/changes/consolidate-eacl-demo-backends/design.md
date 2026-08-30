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

1. Datomic Pro read-only connections return one fixed database/log value and support `d/db`, `d/log`, and `d/release`, not live synchronization. The Lambda therefore constructs the EACL Datomic adapter directly over one captured `d/db` value without a connection-backed synchronization path. That immutable value is both current and authoritative for the deployed read-only dataset; at-least requests validate their floor against it, and exact requests select only verifiable bases at or before it. No serving request calls `d/sync`. The underlying schema/storage retains normal Datomic transaction history for a later separately qualified live EC2 demo.
2. The Datahike DynamoDB adapter path still needs repair for typed failures, consistent publication reads, unprocessed keys, deadlines, and real AWS behavior. DynamoDB Local cannot prove those properties.
3. Datalevin uses embedded LMDB in two explicitly different execution topologies. Lambda builds an environment-local database under `/tmp`, realizes the immutable reader during Java initialization, and snapshots only a quiescent ready database; EC2 uses a durable embedded path and service lifecycle. Their source fixture may match, but deployment identity, durability, startup, telemetry, cursor scope, and qualification evidence are never interchangeable.
4. Jank compiles natively. Lambda requires a Linux binary matching the configured architecture. `provided.al2023` supports x86_64 and arm64 custom runtimes, but AWS SnapStart excludes OS-only runtimes and container images. Upstream Jank currently exercises Linux release builds on GitHub's x64 `ubuntu-24.04` runner, not its arm64 runner, so Linux x86_64/AL2023 is the defensible initial target. Jank should start through AOT and does not need SnapStart.
5. AWS Budgets data is delayed; immediate DynamoDB cost defense must use on-demand maximums and CloudWatch consumption/throttle/write signals.
6. The current Datahike deployment already contains a tested Telegram notifier path using SNS, Lambda, an AWS-held token, and end-to-end ALARM/OK tests. Consolidation should generalize that implementation and reuse the token rather than introduce GitHub-held Telegram credentials.
7. GitHub currently has no branch protection on the relevant repositories. The user explicitly accepts uncoordinated and out-of-order workflow completion, so GitHub concurrency groups, latest-head guards, and cross-repository dispatch are unnecessary. AWS access can use OIDC rather than stored keys.

## Goals / Non-Goals

**Goals:**

- One stable URL and one source workspace for all demo presentation/contracts.
- Explicit backend and storage selection followed by only supported deployed execution choices.
- Evidence-based fastest storage default within one backend, never a misleading global backend benchmark.
- Honest capability differences and exact source/deployment identity in every profile.
- Public read-only runtimes and private, bounded, recoverable data operations.
- Fast automatic deployment of every independently eligible active-track target after a `demos` merge, with maximum parallelism and no fleet-atomic eligibility barrier; an ineligible sibling or parked registered profile neither enters nor blocks the fan-out.
- A failed profile retains the last healthy version and visibly/operationally reports that failed update while other profiles continue.
- Minimal merge gates: build, deploy, bounded smoke, promote/rollback. Formal verification is independent and non-blocking.
- No long-lived AWS access key, Telegram token, or cross-repository dispatch credential in GitHub.
- DynamoDB cost caps/alarms/budgets/anomaly detection routed to Telegram before durable seeding.

**Non-Goals:**

- A hosted authorization service, arbitrary user data/schema/query, public writes, or an SLA.
- Cursor or exact-basis portability across profiles, deployments, or browser page lifecycles.
- Fleet-wide atomic rollout or a requirement that every backend expose the same consistency/history/storage features.
- A formal-verification gate for demo build or deployment.
- A live advancing Datomic head or transactor-coordinated consistency claim from the read-only Lambda; the separately identified non-read-only EC2 execution owns that topology.
- SnapStart for Jank, or representing its in-memory store as Datomic Pro/durable production storage.
- Automatic durable seeding, migration, replacement, or deletion on ordinary source merges.
- Automatic legacy destruction after cutover.

## Decisions

### 1. `theronic/eacl-demo` owns the consolidated product

The new repository contains shared UI/state/contract packages, deterministic fixtures, one service package per server profile, a direct DataScript browser runtime, infrastructure units, qualification/smoke tooling, deployment workflows, and runbooks. Adapter repositories remain upstream dependencies until separately moved. Generic build-unit manifests prove deterministic source identity only; they cannot qualify concrete deployment bytes. Each real static, ZIP, JAR, or native artifact requires its own byte-for-byte double-build evidence before its unit becomes deployment-eligible. The compiled static check remains a manual/material-change qualification and does not slow ordinary demo merges.

Deterministic JVM uber-JAR normalization preserves Clojure's AOT loader invariant: non-class entries use the fixed ZIP timestamp `2000-01-01T00:00:00`, while `.class` entries use `2000-01-01T00:00:02`. Equal source and class timestamps are forbidden because Clojure then recompiles `.clj`/`.cljc` sources and can split generated interfaces/proxies across classloaders. Packaged audits execute an AOT-sensitive `clojure.pprint` path in addition to loading each entrypoint.

Every build records two immutable identities:

- `demo-sha`: the `theronic/eacl-demo` commit providing services/UI/infrastructure;
- `eacl-sha`: the exact reachable `theronic/eacl` commit pinned by a dependency lock committed in that demo revision and providing EACL v8 modules/generated runtime.

Dirty local paths and mutable branch names are never published as artifact identity. Relevant current sibling work is imported deliberately into the new repository without modifying or overwriting those worktrees. An EACL Core change is deployed only after the lock update itself reaches `eacl-demo:demos`; activity in the Core repository does not coordinate or trigger this demo workflow.

### 2. The UI selects backend storage and execution separately

The first selector is a stable backend ID. The second is its supported storage. The third selects an execution platform when that backend/storage pair has multiple deployed Lambda-memory, EC2, or browser variants:

| Backend | Storage options in this change | Runtime | Dataset |
| --- | --- | --- | --- |
| Datahike | S3, DynamoDB | managed Java arm64 Lambda; 1769 MiB primary and 4096 MiB comparison variants; preinitialized published-version SnapStart | exactly 1,000,000 for comparable generations; adopted S3 retains its declared legacy identity |
| Datomic | DynamoDB | managed Java Lambda read-only Peer at 1769/4096 MiB with published-version SnapStart; separately identified shared-EC2 historical-exact service | exactly 1,000,000 |
| Datalevin | embedded LMDB | managed Java 25 arm64 Lambda at 1769 MiB with ephemeral `/tmp` and published-version SnapStart; separately identified shared-EC2 durable service | exactly 10,000 |
| Jank | bundled in-memory Datomic-like store | Linux x86_64 `provided.al2023` ZIP | exactly 10,000 |
| DataScript | browser memory | direct ClojureScript page runtime | exactly 10,000 prebuilt |

The internal product key remains a composite profile ID such as `datahike-dynamodb`; execution selection resolves that product to one exact origin. Routes, IAM, aliases, cursors, caches, and evidence stay execution-scoped. The canonical URL uses separate `backend`, `storage`, and `platform` parameters. Datahike is the neutral landing backend because a global speed comparison across unequal datasets/topologies is invalid.

The checked-in registry is a fail-closed catalog/bootstrap record, not a mutable fleet pointer. Each profile job publishes only `/registry/profiles/<profile-id>.json`, a closed content-addressed record containing that profile's exact demo SHA, locked EACL SHA, artifact, data-manifest digest, deployment ID, gate evidence, state, and last attempt. The shell fetches all allowlisted records concurrently from its own HTTPS origin with bounded no-store requests, validates each record and digest against the closed route mapping, and composes a view without requiring every sibling. A missing, redirected, oversized, duplicate, tampered, wrong-route, or wrong-profile record disables only that profile. An embedded enabled fallback is never selectable without a verified independent record.

This per-profile layout is required for uncoordinated fan-out: no profile job writes a shared aggregate object and the static job does not overwrite server status keys. Mixed generations are therefore ordinary state, not a failed fleet transaction. Comparable benchmark evidence has its own content-addressed index and raw-file loader. The browser checks the exact active deployment/data identities before applying a result and otherwise falls back without a speed claim.

Changing any selector is one client state transition: increment client epoch, cancel old requests, clear execution-owned bases/cursors/pages/cache/error state, validate portable semantic intent, and start the selected execution from page one.

### 3. “Fastest” is a reproducible storage decision, not marketing

Only alternatives with the same backend and equal fixture/scale/region/runtime path/API/operation weights/cache states/concurrency/repetitions are ranked. For Datahike, the production-region S3 and DynamoDB profiles use the same one-million-resource fixture.

The evidence records at least warm p95 for the canonical interactive mix and cold/restore p95 to first result. The primary declared scoring rule is versioned with the workload. Results inside the declared uncertainty/tolerance are a tie, broken by lower cold/restore p95 and then lower projected monthly cost. The registry stores `defaultStorage`, evidence digest, method version, source/data identities, and timestamp.

Evidence expires after material storage/runtime/fixture/region/workload change. With one qualified option, that option is selected but no comparative speed claim is made. Until DynamoDB qualifies, Datahike/S3 remains the deterministic default.

### 4. CloudFront is static-only and server APIs use direct Function URLs

CloudFront has one private S3 origin and serves only the two static entries:

```text
/                                  static main shell
/assets/*                          immutable main assets
/datascript/                       separate DataScript entry
/datascript/assets/*               DataScript-only assets
```

The closed profile catalog binds each enabled server profile to one exact,
alias-qualified Lambda Function URL origin. That origin is the complete profile
namespace, so the browser appends only a root operation such as
`/lookup-resources` or `/check-permission`. There is no `/api`, route version,
backend, storage, or composite profile prefix, and the old `authorize` operation
is removed. The browser never sends server API traffic to `demo.eacl.dev`, and CloudFront
contains no Lambda origins, API behaviors, API cache/request policies, Lambda
origin access control, or Lambda invoke permissions.

Function URLs use `AuthType: NONE` because ordinary browsers cannot sign IAM
requests. Each alias resource policy allows public invocation only through the
Function URL, while Function URL CORS allows `GET` and `POST` from exactly
`https://demo.eacl.dev` with the closed request-header set and a bounded
preflight lifetime. CORS is a browser-origin control, not authentication;
non-browser callers can invoke the URL, so safety comes from the runtime's
closed, bounded, read-only dispatcher and storage IAM that denies mutation.
The static CSP names the exact enabled Function URL origins rather than using a
wildcard.

Every server profile has an independently auditable serving role. Datahike/S3
is confined to one store prefix, Datahike/DynamoDB and Datomic/DynamoDB to
their distinct exact generation tables, Datalevin Lambda to its environment-local
embedded database and bounded operational resources, shared EC2 services to
their exact instance/service/data paths, and Jank to one pre-created log group. Serving roles attach no
managed policies and accept no whole-resource or action wildcard. Automated
decision checks exercise cross-profile table and store identities as well as
write/admin actions. Stateful write identities are separate; the temporary
Datomic EC2 writer's sole managed-policy exception is the exact AWS SSM core
policy needed for command execution without inbound SSH, while its data-plane
statements remain exact-resource scoped.

### 5. `explorer.v1` is capability-driven and N/N-1 compatible

Health/bootstrap descriptors include exact profile, backend, storage, `eacl-sha`, `demo-sha`, artifact/deployment/data identity, capabilities, limits, and limitations, and the UI identity-checks them before ordinary use. Ordinary responses keep the earlier Explorer's compact metadata shape instead of repeating deployment facts on every operation.

Every backend, including DataScript, uses exactly the same ordinary envelope:
success is `{data, meta}` and failure is `{error, meta}`. `meta` contains only
`revision`, `requestId`, and optional `elapsedMs`/`cacheStatus`. Authorization
data is only `{allowed}`. Retry behavior is inferred from stable error codes;
there is no backend-specific `ok`, operation, identity, basis, retryability,
reason, or explanation-path payload.

Independent rollout means the shell may be N while one profile is N-1. Contract additions are optional/capability-discovered for one compatibility window. Contract major and compatibility range live in the descriptor handshake; transport remains on the same profile-owned root operation paths. An incompatible descriptor fails bootstrap until a compatible client/profile pair is selected, without introducing `/api/v2` or any other version path. The selector visibly reports each actually deployed source pair and its last deployment outcome.

Only portable semantic intent enters URLs/history. Cursors, basis tokens, revisions, request IDs, cached values, and seed state never do.

### 6. The fixture is deterministic and data lifecycles are separate

One fixture package defines stable IDs/schema/relationships/exemplars, a 10,000-resource prefix, and a 1,000,000-resource target. Each physical backend records achieved counts/digests. Ephemeral Lambda and browser profiles reconstruct or restore their exact environment-local data; durable EC2 and cloud-storage profiles bind separately qualified data identities.

Durable seed jobs are private, idempotent, resumable, bounded, and observable. They are never called by the public API or ordinary merge workflow. Datahike and Datomic use different DynamoDB tables, roles, lifecycles, and recovery identities.

### 7. Adopt Datahike/S3 and repair Datahike/DynamoDB before enabling it

The existing S3 dataset/reader are adopted after source/config/store/basis/read-only/common-contract evidence. The store is not reseeded for consolidation. The replacement artifact is an architecture-neutral JVM uber-JAR with an AWS `RequestStreamHandler`, a custom existing-store-only Konserve facade that preflights the existing marker without invoking upstream `konserve-s3`'s marker-writing connect path, a writer implementation that denies dispatch/create/delete, deny-all blob/store mutation methods, an exact `GetObject`/`HeadObject` SDK membrane, one immutable snapshot per admitted request, a request-basis-bound bootstrap descriptor, a closed explorer operation map, and no ClojureScript/Closure compiler closure. The runtime adds exact-prefix `s3:GetObject` IAM with no list/write/admin permission. Generic dependencies still contain upstream write-capable symbols; the claim is no reachable serving write path, backstopped by the SDK membrane and IAM, not physical absence of every write class. A MinIO regression proves upstream physical-format compatibility and unchanged object hashes across open/query. The JAR also passes an exact pinned-AL2023 double-build and Java 25 kernel-load audit. Production realizes the immutable reader before a published-version SnapStart checkpoint and is promoted only after AWS optimization plus restored read smoke. The deployed path is enabled; the current 1769/4096 MiB full memory/load qualification and separately authorized canonical comparable S3 generation remain open.

That adopted store contains one million server entities plus ancillary data; it
is not the canonical one-million-resource fixture and cannot enter the
same-fixture S3/DynamoDB benchmark. Comparable evidence therefore has a
separate hard prerequisite: explicit new authorization followed by a distinct
versioned SSE-S3 blue-green generation seeded from the canonical fixture. The
adopted store is never mutated or relabeled. Until the canonical S3 generation
exists, qualified choices use the deterministic S3 fallback with no speed
claim—even if DynamoDB is also enabled. DynamoDB seed authorization does not
authorize this additional S3 state or spend.

The adopted manifest's aggregate non-user resource count is 1,001,584
(1,000,000 servers plus accounts, teams, VPCs, and the platform object). The
descriptor therefore carries both aggregate logical-resource count and exact
server count; the Explorer's Servers total uses the latter. The consolidation
does not seed or select another S3 bucket.

The DynamoDB adapter must preserve typed failure categories, handle every
unprocessed key, use strong publication reads or equivalent proof, implement
deadline-aware bounded jittered retry, and remove destructive serving behavior.
Its local replacement artifact is a normalized JVM uber-JAR with an AWS
`RequestStreamHandler`, exact read-only SDK membrane, strongly consistent
GetItem/BatchGetItem adapter, existing-table-only Datahike connection,
deny-all Datahike writer and Konserve mutation methods, authenticated
profile-scoped cursors, request-basis-bound bootstrap, closed explorer routes,
and no ClojureScript/Closure, rejected upstream adapter, or alternate AWS HTTP
client closure. The generic Datahike and AWS SDK dependencies still contain
write-capable library symbols, so the claim is no reachable serving write path,
backstopped by the exact read-only client and later exact-table IAM role—not
physical absence of every upstream write class. Production realizes the reader
before a published-version SnapStart checkpoint and qualifies restored reads.
Source/package/fake-reader audits, the refreshed DynamoDB Local run, the exact
pinned-AL2023 double-build/Java 25 kernel-load audit, and ordinary deployed
Lambda smoke establish the current enabled reader path. They do not substitute
for the still-open full 1769/4096 MiB restored semantic/load/headroom gate or
the canonical same-fixture comparison.

A disposable real AWS table exercises publication, throttling, permissions,
timeouts, partial batches, corruption/missing distinction, cancellation, and
load. Only then is the dedicated table seeded to one million and benchmarked
against S3.

### 8. Datomic Lambda serves all consistency selections over one captured value

Provisioning uses a temporary private transactor/EC2 lifecycle to create the database, install history-preserving schema, seed exactly one million resources, verify indexes/manifest/exemplars/final basis, record recovery identity, then stop the transactor and terminate compute. Relevant authorization attributes do not set `:db/noHistory true`; the qualification records multiple seed bases and proves normal-Peer `d/as-of` and history behavior before teardown.

Serving calls `d/connect` with `read-only=true`, captures `fixed-db = d/db(conn)` once during Java initialization, and constructs the EACL Datomic adapter over `fixed-db` without passing the connection into request selection. Minimize-latency selects `fixed-db`. Fully-consistent selects the same value because it is the immutable authoritative head of this deployment, not a live transactor head. At-least-as-fresh verifies the authenticated requested revision is no newer than `fixed-db`. At-exact-snapshot accepts the current authenticated locator and may use `d/as-of` only for an authenticated retained revision that `fixed-db` can reconstruct. A future floor, foreign token, or unavailable exact basis fails closed. Instrumentation proves serving never calls `d/sync` or transact.

The UI exposes the four EACL labels and describes their immutable-deployment scope. Datahike, by contrast, displays `fully-consistent*` disabled with an adjacent note because its read-only Lambda has no writer barrier. Both Datahike storage profiles expose at-least against the current captured basis and exact only for that current basis.

The table/database is immutable after publication. Data refresh is blue/green per profile: qualify a new data identity and function version, then move only that alias/descriptor. Retaining storage history does not turn the Lambda into a live head. A separately identified shared-EC2 service exposes the historical-exact topology; its lifecycle and evidence are independent and do not broaden the Lambda descriptor.

The shared Datomic EC2 transport uses pinned http-kit 2.8.1 behind CloudFront, with its Java-21+ virtual request-task executor around one fair Datomic engine permit on the one-vCPU host. The prior JDK `com.sun.net.httpserver.HttpServer` was not the direct source of the contention failures—the engine boundary used non-blocking semaphore acquisition and rejected every overlapping request immediately—but the JDK documents its default server as a minimal implementation not intended to be full-featured or high performance. http-kit is a small zero-runtime-dependency, event-driven Clojure server designed for reverse-proxy deployment; it starts each request promptly so its deadline governs the admission wait rather than an opaque fixed-worker backlog. The boundary waits fairly in short interruptible intervals until admission, request cancellation, interruption, or the existing deadline. Waiting occurs before snapshot capture and response duration includes admission delay. This preserves serial Datomic work and bounded request lifetime. Netty is not selected: it is a substantially larger, lower-level closure and blocking Datomic work would still need the same offload and admission queue.

The separate Datomic serving and seed JARs pass exact pinned-AL2023
double-builds and Java 25 kernel-load audits. The handler forces the reader and
captured basis during initialization, enables SnapStart on published versions,
waits for `OptimizationStatus=On`, and promotes only after repeated restored
health, consistency, permission, pagination, and mutation-denial qualification.

### 9. Datalevin uses separately identified embedded Lambda and EC2 topologies

The Lambda artifact is a Java 25/arm64 ZIP built from an exact maintained-fork
commit and an exact AL2023-compatible native closure. It opens one embedded
LMDB database under `/tmp` per execution environment, with no remote server,
EFS, S3, DynamoDB, or HA serving dependency. The packaged 10,000-resource
fixture, schema digest, local revision watermark, artifact identity, and
deployment identity determine that environment's source lifecycle. A restored
or rolled-back version advertises its own identities and never shares mutable
database state with another Lambda environment.

The Lambda handler forces the immutable reader during initialization. Published
versions alone enable SnapStart, deployment waits for `OptimizationStatus=On`,
and the exact candidate version must pass health, bootstrap, allow, deny, and
mutation-denial smoke before alias promotion. The primary Lambda is 1769 MiB;
ordinary deployment verifies exact memory, runtime, architecture, code identity,
and AWS optimization. That bounded promotion evidence does not close task 10.8:
repeated restore, concurrency, cancellation, failure, load, GC, and at least 20%
process-headroom qualification remain required.

The shared-EC2 Datalevin service uses an embedded LMDB database on its declared
durable path. It is not described as memory-only or environment-ephemeral, and
its service/data identity, restart behavior, process metrics, cursor scope, and
rollback coordinates are distinct from Lambda. The same logical fixture may be
used, but Lambda SnapStart evidence cannot qualify EC2 and EC2 persistence
evidence cannot qualify Lambda.

Both runtimes use an admitted execution scope that owns one read snapshot on
the acquiring platform thread, fully realizes the response, and releases the
snapshot exactly once on success, error, deadline, or cancellation. Bounded
application telemetry records outcomes without sensitive/high-cardinality data;
Lambda REPORT/EMF and EC2 CloudWatch/process/service signals own the surrounding
memory and lifecycle observations. Full current semantic/load/headroom evidence
for both advertised topologies remains the open Datalevin qualification gate.

### 10. DataScript remains a separate direct static entry

`/datascript/` shares the exact UI/state/contract/fixture source but loads ClojureScript, EACL DataScript, DataScript, and its direct browser runtime only from its own build graph. There is no Web Worker, Blob loader, independent worker protocol, or duplicated presentation. The page owns the database/client/cache/cursor lifecycle. The build creates a DataScript-native serialized database from the exact 10,000-resource generator and embeds it in the content-addressed runtime; startup restores that database rather than replaying the fixture in every browser. The main bundle has a material-change qualification assertion proving those dependencies are unreachable.

### 11. Jank targets `provided.al2023` x86_64 and does not use SnapStart

Jank is currently parked by explicit user direction. It remains registered,
unavailable, independently buildable, and governed by the following gates, but
it is not part of the active `demo.eacl.dev` rollout and cannot block ordinary
deployment of Datahike, Datomic, Datalevin, DataScript, or the shared static
surface. Re-entry requires an explicit unpark decision; parking itself closes
none of the Jank qualification tasks.

Jank initially builds inside a pinned x86_64 Amazon Linux 2023-compatible environment on GitHub's x64 `ubuntu-24.04` runner or a temporary x86_64 AL2023 builder if nested tooling cannot qualify the host. This matches the architecture currently exercised by upstream Jank's Linux release workflow while avoiding a newer unproven Linux arm64 closure. A prebuilt digest-pinned builder image/cache avoids rebuilding the compiler on each merge. The artifact is a ZIP with executable root `bootstrap`, Linux x86_64 Jank executable, required compatible native libraries/resources, fixture input, and licenses. An arm64 migration remains possible only after a separate AL2023 toolchain/dependency/Lambda/performance qualification.

The function uses `provided.al2023`. SnapStart is neither available nor needed for this native OS-only runtime. Startup is optimized with AOT, a minimal native closure, deterministic fixture input, and measured memory/CPU. Initial Linux/Lambda semantic qualification and memory sizing remain required, but formal/source-linked certification is not a deployment gate. Merge CI only builds, deploys, and runs bounded public smoke.

The vendored native engine is not allowed to inherit the repository's locked
EACL Core SHA by assertion. A fail-closed rebase ledger enumerates all 33
runtime source paths changed between the imported baseline and locked Core and
classifies each as verified, partial, unqualified, or inapplicable with a
rationale. Individually executable deltas currently cover cache read versus
publication controls, sealed-plan relation-scope certification, and stable
validation identities; partial or unqualified entries keep the profile
unavailable. Linux compilation and Lambda semantic smoke are additional gates,
not substitutes for closing that source-compatibility ledger.

The manual builder run is itself content-addressed before it may consume long
runner time. One digest binds the complete builder lock, immutable Dockerfile,
runner, pinned action revisions, `linux/amd64` platform, compiler/base-image
closure, output tag, provenance, and SBOM settings; confirmation additionally
binds the exact demo commit. The same run must build the qualification-only
Lambda ZIP with the published image digest, retain raw ELF/ABI/`ldd`/license
evidence, and smoke that exact package in the immutable `provided.al2023`
x86_64 base image. A published builder image alone closes no artifact task.
The workflow artifacts expire after one day to limit storage. Execution and
review of this gate remain open; the current source-only policy does not mark
the Jank build unit deployable.

The descriptor labels the store as a bundled in-memory Datomic-like conformance store and denies Datomic Pro, durability, Datalog, distribution, and production claims.

### 12. One `demos` branch triggers uncoordinated maximum-parallel deployment

`theronic/eacl-demo:demos` is the only deployment trigger. Its commit contains the exact EACL Core dependency lock, so a run needs no second branch lookup or cross-repository event. Every push starts five independent jobs: static/DataScript, Datahike/S3, Datahike/DynamoDB, Datomic/DynamoDB, and Datalevin/memory. Each job checks out the same immutable commit, installs the pinned toolchain and dependencies, builds only its target, assumes only its target-specific OIDC role, deploys, and runs the bounded live smoke in one job. There is no certification job, readiness ledger, generated workflow, artifact handoff, global barrier, matrix, or sibling dependency. The static job produces main and DataScript entries together to avoid conflicting S3-prefix writes. Parked Jank remains catalogued and unavailable without being queued or gating the five live targets.

There are deliberately no GitHub concurrency groups, cancel-in-progress settings, latest-head guards, or cross-run ordering. Every job deploys the exact `demo-sha` and locked `eacl-sha` checked out for that run. If two pushes overlap, either run may finish last for a profile. That user-approved trade-off maximizes speed and simplicity; descriptors always reveal the actually deployed identities.

If a server job fails after candidate promotion, the direct deployer restores that profile's prior alias using the exact observed alias revision. It never touches a sibling alias or dataset. Because Lambda alias and registry updates cannot form one atomic AWS transaction, the browser and every operation still perform descriptor/data identity checks and fail closed during any cross-service partial window. Other jobs and runs continue. A later push may replace the failed target, but no fleet convergence or latest-source guarantee is claimed.

The direct deployer publishes an immutable Lambda version, waits for SnapStart optimization where required, smokes that exact version, moves the profile's `candidate` alias with an optimistic revision, smokes the public Function URL, publishes that profile's content-addressed registry record, and restores only the prior alias if the post-promotion work fails.

The release report is a content-addressed aggregate derived from the exact registry, build eligibility, dependency lock, fixture manifests, runtime definitions, benchmark evidence files, and cost-control definitions. It distinguishes `defined-not-deployed` from live `verified` evidence and distinguishes candidate memory from qualified memory. Its top-level source identifies only the demos-branch commit that built the report; it is not a fleet source claim. Each profile's deployment identity is independently authoritative, so a released aggregate can truthfully contain mixed and out-of-order generations. A checked-in pre-release report is useful because it exposes every missing identity, but it does not satisfy the final release-report task: a released report needs an immutable report-build identity, actual artifact/deployment identities for every enabled profile, benchmark evidence behind any performance-selected default, qualified memory evidence, live alarms/budgets/Telegram evidence, and executable rollback coordinates.

OpenSpec retains the substantive implementation and live-evidence tasks, but
ordinary demo delivery does not generate or verify a separate readiness ledger.

### 13. Merge deployment is deliberately small

Each target job performs:

1. a clean checkout at the exact demo SHA and installation of the pinned toolchain/dependency lock;
2. one target-local build whose output digest is recomputed before upload;
3. assumption of only that target's exact OIDC deployment role;
4. immutable candidate upload/version publication;
5. bounded CORS preflight, health, descriptor identity, one allowed exemplar, one denied exemplar, and mutation-denial smoke through the exact public target;
6. per-profile alias/registry publication or exact prior-alias rollback.

No ordinary job awaits formal verification, full semantic conformance, browser/accessibility suites, fault injection, load/memory sweeps, data seeds, migrations, or another profile. Those tools may remain available for diagnosis and material-change testing, but they cannot gate demo deployment.

Full HTTP semantics, bounded workloads, browser/accessibility, and bundle
isolation remain locally runnable diagnostics. HTTP diagnostics accept only
loopback or the exact alias-qualified Function URL from the closed catalog and
produce redacted reports; they own no GitHub workflow, staging route,
publication gate, alias transition, or readiness record. Durable generation
and seed workflows remain separate because they mutate state, not because demo
deployment awaits certification.

### 14. GitHub settings favor safe speed and AWS OIDC

`demos` is the default and deployment branch. It has no classic branch protection or repository ruleset, so an EACL lock update can be committed and pushed directly. Separate environments such as `demo-production-static` and `demo-production-<profile>` accept only `demos` and have no reviewer or wait timer. Each environment still gives its deployment role a distinct OIDC subject without serializing the jobs.

Repository Actions permissions default to read-only. Deploy jobs request `contents: read` and `id-token: write`; permissions are not broadened for the entire workflow. The 2026-08-26 public audit reconfirms owner ID `1011676`, repository ID `1345904214`, creation after GitHub's 2026-07-15 immutable-subject cutoff, and the current default prefix `repo:theronic@1011676/eacl-demo@1345904214`. It is metadata evidence, not a substitute for the still-required allowlisted claim capture from a live job; the JWT itself is never printed, uploaded, or retained.

GitHub makes the OIDC request bearer available to the entire job once
`id-token: write` is granted; placing dependency installation before
`configure-aws-credentials` does not isolate it. The ordinary workflow accepts
that exposure to keep each demo update to one direct job, while constraining the
resulting AWS session to the exact workflow, `demos` ref, target environment,
and target-specific deployment role. Checkout credentials are not persisted,
actions are commit-pinned, server installs ignore package lifecycle scripts,
and AWS credentials are configured only after a successful build. Manual
stateful authorities retain their dependency-free claim-capture bootstrap.

The desired repository-wide subject template is exactly `[repo, ref, workflow_ref, environment, event_name, runner_environment]` with immutable subjects enabled. A deployment subject therefore binds the immutable repository prefix, `refs/heads/demos`, the top-level workflow path at that ref, one role-specific environment, the `push` event, and `github-hosted` execution without wildcards. Manual authorities instead bind `workflow_dispatch`. These jobs are not reusable workflows, so `job_workflow_ref` is not required in trust. GitHub's 2026-08-27 live top-level tokens nevertheless exposed at least one `job_workflow_*` claim; the capture validator therefore accepts such a compatibility alias only when `job_workflow_ref` is identical to the already validated `workflow_ref` and, when present, `job_workflow_sha` is identical to `workflow_sha`. A different called-workflow path or revision is rejected. A future design that actually adopts a reusable workflow must instead bind its exact called-workflow identity deliberately. Current AWS documentation exposes direct GitHub conditions for `repository_id`, `repository_owner_id`, `repository`, `ref`, `workflow`, and `environment`, but not `workflow_ref`, `event_name`, or `runner_environment`, so the policy requires all supported direct claims with `StringEquals` and also requires the exact custom `sub` carrying those remaining values. This reconciles AWS's May 2026 claim-key expansion with GitHub's lagging AWS-specific statement that custom claims are unavailable.

Because subject customization affects the whole repository, the authority manifest covers the five ordinary deployment roles and the retained stateful-maintenance roles. Parked Jank has no ordinary production authority or GitHub environment; those are added only if it is explicitly unparked. Migration updates every AWS trust before changing GitHub's template, may temporarily accept only two exact recorded subjects, verifies every job, and then removes the old subject. The static site and each active profile use separate least-privilege deployment roles/stacks; ordinary role variables and permission scopes are disjoint from seed and maintenance authorities.

No AWS access key, Telegram token, or cross-repository dispatch credential is stored in GitHub. Non-secret region/account/role identifiers use environment variables. If a dependency repository proves it needs credentials in a clean locked-revision build, only that scoped credential is entered through the requested Chrome UI after its need and least privilege are demonstrated; no speculative dependency secret is created.

### 15. Cost controls precede DynamoDB and temporary compute

DynamoDB uses on-demand mode with per-table maximum read/write request units. The seed phase uses a bounded forecasted write maximum; after cutover, write access is removed from serving and unexpected writes alarm. Read maximums derive from qualified peak plus declared margin.

CloudWatch publishes one-minute consumption alarms at 70%/90% of configured bounds, throttle/max-throughput alarms, nonzero serving writes, system errors, and profile health. AWS Budgets provide 50%/80%/100% actual notifications against the forecast-plus-contingency seed/monthly envelopes; forecast notifications are used only when history exists. Both budgets and the custom Cost Anomaly Detection monitor are scoped to active `Project`/`Workload` cost-allocation tags so unrelated account activity cannot page the demo Telegram destination. Tag activation is a deployment precondition, while throughput caps and direct metrics remain primary because billing/tag data is delayed.

Alarm actions feed a shared SNS topic and a generalized version of the tested Datahike Telegram notifier. Genuine recoveries use a same-account/name-scoped EventBridge filter for only `ALARM`→`OK`; per-alarm `OKActions` are forbidden because CloudWatch would execute them on the initial `INSUFFICIENT_DATA`→`OK` evaluation and spam Telegram during provisioning. The notifier reuses the retained AWS Secrets Manager token rather than copying it to GitHub or creating another secret. SNS alarm content is non-sensitive and does not require customer-managed KMS. DynamoDB uses AWS-owned encryption and S3 uses SSE-S3. Durable-table publication uses a guarded alarm-only transition phase: zero-write detection is active before writer/cap changes, cap-drift alarms are removed only for the intentional cap transition, and serving drift alarms are installed immediately afterward.

Server runtimes emit one closed `eacl-demo.runtime-telemetry.v1` JSON/CloudWatch
EMF record per request and one per initialization outcome. Metric dimensions are
limited to stable `ProfileId` and `FunctionName`; deployment/request identity,
operation, outcome, and a closed error code remain structured log fields rather
than high-cardinality dimensions. Request bodies, response data, raw paths,
storage identifiers, exception messages/stacks, and credentials are forbidden.
Records are byte-bounded, telemetry failure cannot change the request or
initialization result, and log groups use bounded retention. The closed signal
set is requests, errors, duration, initialization, restore, throttles, timeouts,
OOM, and storage access. Datahike, Datomic, and Datalevin publish only
AWS-optimized SnapStart versions and measure their first restored health and
representative storage request in deployment smoke.

Production demo functions use the account's unreserved concurrency pool. The
runtime retains bounded request work and per-environment bulkheads, while cost
alarms remain the spend guard. No runtime template sets reserved concurrency,
so parallel cold requests cannot fail with
`ReservedFunctionConcurrentInvocationLimitExceeded` because of a function-level
reservation.

Each enabled server profile requires seven exact-profile/function alarms
(duration, errors, health, initialization, OOM, throttles, and timeouts) feeding
the shared topic, while one consolidated dashboard prevents per-profile
dashboard proliferation. Sustained noisy signals use two-of-three one-minute
windows, missing data is non-breaching, and health, initialization, and OOM are
immediate. Initial enablement remains fail-closed until health, bootstrap, and
the frozen allow exemplar pass through the exact direct Function URL and a
content-addressed readiness record binds those results, the dashboard, alarms,
retention/redaction audit, runbook, deployment identity, and data identity.
Local JVM and Jank source integration and artifact evidence does not satisfy
that deployed readiness gate. The enabled JVM profiles now have ordinary
deployment smoke and operational telemetry wiring; current full direct
qualification, release observation, and Jank native fatal-OOM behavior remain
separate open gates. The telemetry, retention, alarm, dashboard, and canonical
synthetic definitions are complete independently of those gates.

The user has authorized both table seeds and temporary EC2 compute for seeds, the Datomic transactor, or a Jank AL2023 build if required. The implementation still records exact tables/instance/roles, forecast/caps, and cleanup. Temporary instances have no inbound SSH, scoped instance profiles, IMDSv2, expiry tags/watchdog, and termination in cleanup by resolved instance ID. Completion proves no matching instance/volume/address remains billable; overdue cleanup sends critical Telegram notification.

### 16. Foundation, profiles, data, and retirement remain separate

Infrastructure units prevent a profile deploy from replacing shared DNS/static or another dataset. Stateful resources use retention/deletion protection and appropriate backups/exports. Per-profile alias promotion is coherent but there is no fleet-atomic registry move.

Ordinary delivery updates static objects or one profile candidate/alias and does not change DNS. The accepted canonical CloudFront target and tested legacy fallback remain rollback coordinates. Any future DNS mutation requires fresh explicit authorization, while legacy EC2/S3/Lambda/DNS/log/backup/certificate retirement resolves exact IDs, recovery evidence, costs, and receives separate approval.

## Risks / Trade-offs

- **[A UI deploy reaches an older profile]** → Maintain N/N-1 descriptor compatibility on stable root operation paths, fail incompatible bootstrap handshakes, and show actual source identities.
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
- **[Telegram notification fails]** → Cap asynchronous retries and event age; retain both SNS-subscription and notifier-invocation failures in an AWS-managed-encryption SQS queue; alarm on queue depth without attaching it as an event source; keep logs/errors redacted; and run an explicitly approved acceptance test before seed/deployment. Telegram cannot independently report its own total outage, so AWS queue/alarm inspection remains part of the gate.
- **[Budgets alert too late]** → Primary on-demand maximums plus one-minute consumption/throttle/write alarms.
- **[Temporary EC2 is orphaned]** → Expiry watchdog, critical Telegram alarm, `finally` termination by exact ID, and post-run absence/billing-resource verification.
- **[No Chrome connection prevents GitHub settings changes]** → Keep repository code/config work separate; do not substitute another UI surface when Chrome is explicitly required, and complete settings after the extension is connected.

## Migration Plan

1. Reconcile and strictly validate this OpenSpec change.
2. Establish clean initial commits in `theronic/eacl-demo`, create `demos`, and import shared behavior without modifying dirty sibling worktrees.
3. Implement contracts, backend/storage/execution selector, fixtures, static entries, and profile packages locally.
4. Connect Chrome; configure GitHub rules, environments, variables, and Actions permissions; add no CI secret unless a clean locked-dependency build proves one is required.
5. Reauthenticate the AWS profile; deploy OIDC provider/trust and separate static/profile/seed roles plus Telegram/cost-control foundation.
6. Adopt Datahike/S3 and qualify each new topology/storage using separate initial workflows.
7. Install throughput caps/alarms/budgets/anomaly/Telegram tests before durable seeding; seed Datahike/DynamoDB and Datomic/DynamoDB; terminate and verify temporary compute.
8. Benchmark comparable Datahike storages and publish the evidenced default.
9. Implement the fast `eacl-demo:demos` workflow for the active Datahike, Datomic, Datalevin, DataScript/static scope with the pinned EACL revision, maximum-parallel target jobs, bounded smoke, per-job rollback, and actual-identity reporting, without GitHub concurrency management; keep parked Jank out of the fan-out.
10. Qualify exact published candidate versions and the deployed static surface, then rehearse independent rollback without requiring a shared fleet-staging phase.
11. Preserve the accepted canonical CloudFront/DNS target and tested legacy fallback; require fresh explicit authorization for any future DNS mutation and complete the production observation window.
12. Reconcile/retire legacy resources only through separately approved destructive batches.

## Confidence Assessment

- **High:** backend/storage/execution selector isolation; fixed-value Datomic read-only semantics; Jank cannot use SnapStart and must target Linux; single-branch uncoordinated GitHub deployment and OIDC mechanics; DynamoDB AWS-owned encryption; budget-delay implications.
- **Moderate until measured:** fastest comparable Datahike storage, full 1769/4096 MiB Datahike qualification, full Datalevin Lambda/EC2 load and headroom, Jank cold-start latency, and cost envelopes.
- **Unknown until external execution:** manual-workflow OIDC authority migration, current-generation complete direct qualification, live rollback rehearsal, the full observation window, and clean Linux Jank builder success.

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
