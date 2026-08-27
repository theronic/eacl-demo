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
3. Datalevin in-memory mode uses native resources and takes about 21 seconds to rebuild its packaged fixture in a fresh Lambda environment. Managed Java 25 supports SnapStart, so the candidate realizes the immutable reader during Lambda initialization, snapshots only a quiescent ready database, and is publishable only when AWS reports `OptimizationStatus=On` and the restored candidate passes the bounded operation smoke.
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
- Historical or at-exact-snapshot support from the Datomic read-only Lambda; a future non-read-only EC2 demo owns that problem.
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

### 2. The UI selects backend and storage separately

The first selector is a stable backend ID. The second is filtered by enabled registry entries:

| Backend | Storage options in this change | Runtime | Dataset |
| --- | --- | --- | --- |
| Datahike | S3, DynamoDB | managed Java arm64 Lambda; SnapStart disabled until a storage-specific restore lifecycle qualifies | exactly 1,000,000 for both |
| Datomic | DynamoDB | managed Java Lambda, read-only Peer | exactly 1,000,000 |
| Datalevin | in-memory LMDB | managed Java 25 arm64 Lambda; preinitialized published-version SnapStart | exactly 10,000 |
| Jank | bundled in-memory Datomic-like store | Linux x86_64 `provided.al2023` ZIP | exactly 10,000 |
| DataScript | browser memory | direct ClojureScript page runtime | exactly 10,000 prebuilt |

The internal key remains a composite profile ID such as `datahike-dynamodb`; routes, IAM, aliases, cursors, caches, and evidence stay profile-scoped. The canonical URL uses separate `backend` and `storage` parameters. Datahike is the neutral landing backend because a global speed comparison across unequal datasets/topologies is invalid.

The checked-in registry is a fail-closed catalog/bootstrap record, not a mutable fleet pointer. Each profile job publishes only `/registry/profiles/<profile-id>.json`, a closed content-addressed record containing that profile's exact demo SHA, locked EACL SHA, artifact, data-manifest digest, deployment ID, gate evidence, state, and last attempt. The shell fetches all allowlisted records concurrently from its own HTTPS origin with bounded no-store requests, validates each record and digest against the closed route mapping, and composes a view without requiring every sibling. A missing, redirected, oversized, duplicate, tampered, wrong-route, or wrong-profile record disables only that profile. An embedded enabled fallback is never selectable without a verified independent record.

This per-profile layout is required for uncoordinated fan-out: no profile job writes a shared aggregate object and the static job does not overwrite server status keys. Mixed generations are therefore ordinary state, not a failed fleet transaction. Comparable benchmark evidence has its own content-addressed index and raw-file loader. The browser checks the exact active deployment/data identities before applying a result and otherwise falls back without a speed claim.

Changing either selector is one client state transition: increment client epoch, cancel old requests, clear profile-owned bases/cursors/pages/cache/error state, validate portable semantic intent, and start the new profile from page one.

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
alias-qualified Lambda Function URL origin. The browser appends the unchanged
logical `/api/v1/<profile-id>/<operation>` path and calls that Function URL
directly. It never sends server API traffic to `demo.eacl.dev`, and CloudFront
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
their distinct exact generation tables, Datalevin to one versioned lifecycle
metadata object, and Jank to one pre-created log group. Serving roles attach no
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

Independent rollout means the shell may be N while one profile is N-1. Contract additions are optional/capability-discovered for one compatibility window. Incompatible semantics introduce `/api/v2` and dual support; they do not require a fleet-atomic release. The selector visibly reports each actually deployed source pair and its last deployment outcome.

Only portable semantic intent enters URLs/history. Cursors, basis tokens, revisions, request IDs, cached values, and seed state never do.

### 6. The fixture is deterministic and data lifecycles are separate

One fixture package defines stable IDs/schema/relationships/exemplars, a 10,000-resource prefix, and a 1,000,000-resource target. Each physical backend records achieved counts/digests. In-memory profiles rebuild and verify at initialization.

Durable seed jobs are private, idempotent, resumable, bounded, and observable. They are never called by the public API or ordinary merge workflow. Datahike and Datomic use different DynamoDB tables, roles, lifecycles, and recovery identities.

### 7. Adopt Datahike/S3 and repair Datahike/DynamoDB before enabling it

The existing S3 dataset/reader are adopted after source/config/store/basis/read-only/common-contract evidence. The store is not reseeded for consolidation. The local replacement artifact is an architecture-neutral JVM uber-JAR with an AWS `RequestStreamHandler`, a custom existing-store-only Konserve facade that preflights the existing marker without invoking upstream `konserve-s3`'s marker-writing connect path, a writer implementation that denies dispatch/create/delete, deny-all blob/store mutation methods, an exact `GetObject`/`HeadObject` SDK membrane, one immutable snapshot per admitted request, a request-basis-bound bootstrap descriptor, a closed explorer operation map, and no ClojureScript/Closure compiler closure. The runtime candidate adds exact-prefix `s3:GetObject` IAM with no list/write/admin permission. Generic dependencies still contain upstream write-capable symbols; the claim is no reachable serving write path, backstopped by the SDK membrane and IAM, not physical absence of every write class. A local MinIO regression proves upstream physical-format compatibility and unchanged object hashes across open/query, but does not qualify the live store. The JAR also passes an exact pinned-AL2023 double-build and Java 25 kernel-load audit. SnapStart remains disabled and explicitly unqualified. These local properties do not qualify the live store or staged Lambda; the profile remains unavailable until task 8.4's external evidence passes.

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
physical absence of every upstream write class. SnapStart remains disabled and
unqualified. Current source/package/fake-reader audits, the refreshed DynamoDB
Local run, and the exact pinned-AL2023 double-build/Java 25 kernel-load audit
are local-only; full stored database initialization, actual Lambda execution,
and current real-AWS behavior remain open.

A disposable real AWS table exercises publication, throttling, permissions,
timeouts, partial batches, corruption/missing distinction, cancellation, and
load. Only then is the dedicated table seeded to one million and benchmarked
against S3.

### 8. Datomic Lambda serves only one captured current value

Provisioning uses a temporary private transactor/EC2 lifecycle to create the database, install history-preserving schema, seed exactly one million resources, verify indexes/manifest/exemplars/final basis, record recovery identity, then stop the transactor and terminate compute. Relevant authorization attributes do not set `:db/noHistory true`; the qualification records multiple seed bases and proves normal-Peer `d/as-of` and history behavior before teardown.

Serving calls `d/connect` with `read-only=true`, captures `fixed-db = d/db(conn)` once per environment, and constructs direct EACL Datomic snapshots over `fixed-db`. The UI exposes only the meaningful minimize-latency label for that one executable path; the wire may retain `current` as a backwards-compatible input alias but does not present it as a separate semantic choice. It rejects fully-consistent, at-least-as-fresh, at-exact-snapshot, history-date, and live refresh before the generic source operations; instrumentation proves serving never calls `d/sync` or transact.

The table/database is immutable after publication. Data refresh is blue/green per profile: qualify a new data identity and function version, then move only that alias/descriptor. Retaining storage history does not change the Lambda's fixed-current public contract. The future live/history-capable Datomic EC2 serving deployment is outside this change.

The separate Datomic serving and seed JARs pass exact pinned-AL2023
double-builds and Java 25 kernel-load audits. That closes only the artifact
boundary; provisioning, seeding, history proof, actual Lambda execution,
memory selection, and staged publication remain open.

### 9. Datalevin is an ephemeral SnapStarted in-memory Lambda

The active artifact is a Java 25/arm64 ZIP built from the pinned maintained
fork commit `a7e29c25` and the pinned AL2023-compatible native JAR whose ABI
audit caps required glibc at 2.34. It opens Datalevin with a `nil` directory,
which selects native in-memory LMDB; it has no remote server, EFS, S3,
DynamoDB, WAL, or durable LMDB serving path. Its data exists only in one Lambda
execution environment's memory and disappears with that environment.

Each cold environment parses the packaged 10,000-resource NDJSON fixture,
installs the schema, and writes 10,080 objects plus 38,613 relationships. The
original consolidation performed roughly one hundred 500-record transactions;
the active implementation uses bounded 5,000-record batches (three object and
eight relationship transactions). After object publication it scans the
`:eacl/id` index once and resolves every relationship endpoint from that local
map, instead of crossing the native LMDB boundary roughly 77,000 times. The
two non-SnapStart deployment measurements remained 21.8 and 21.3 seconds, so
the endpoint-index optimization is not represented as a material startup win.

The Java handler now forces the otherwise lazy immutable reader during Lambda
initialization and the function enables SnapStart only on published versions.
CI waits for the exact version to become active, requires AWS to report
`OptimizationStatus=On`, then invokes the restored alias through health,
bootstrap, allow, deny, and mutation-denial smoke before publishing its profile
record. The first restored health wall time is printed on every deployment.
Published version 39 in deployment run `33024147774` was AWS-optimized, reported
SnapStart enabled through its restored bootstrap descriptor, passed the complete
bounded smoke, and returned the first restored health response in 2,076 ms.
The data remains native in-memory LMDB; SnapStart changes startup lifecycle,
not storage or durability. Broader repeated restore/eviction/load evidence can
still harden the topology later, but formal verification is not a merge gate
for this demo.

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

`theronic/eacl-demo:demos` is the only deployment trigger. Its commit contains the exact EACL Core dependency lock, so a run needs no second branch lookup or cross-repository event. Once at least one ordinary target is eligible, a trigger starts one explicit build/deploy pair for static and each independently eligible active-track server profile, without a global build artifact, eligibility, or success barrier. Every unprivileged `build-<target>` job runs in parallel, has no OIDC permission, and uploads a content-addressed artifact through a commit-pinned action. Its matching `deploy-<target>` alone depends on that artifact, verifies its digest, requests OIDC, and deploys without installing dependencies or rebuilding. No target waits for a sibling; any remaining matrix uses `fail-fast: false` and no `max-parallel`. The static build produces main and DataScript entries together to avoid conflicting S3-prefix writes. The closed build registry records `deploymentTrack` and `ordinaryDeploymentTarget` separately from `deploymentEligible`: every active unit assigned to one target must qualify that target, each qualified target enters ordinary delivery independently, shared infrastructure remains outside merge deployment, and a parked unit remains catalogued and fail-closed without gating or being queued.

There are deliberately no GitHub concurrency groups, cancel-in-progress settings, latest-head guards, or cross-run ordering. Every job deploys the exact `demo-sha` and locked `eacl-sha` checked out for that run. If two pushes overlap, either run may finish last for a profile. That user-approved trade-off maximizes speed and simplicity; descriptors always reveal the actually deployed identities.

If a job fails, it retains/restores that profile's last coherent alias/descriptor and records the failed update in only that profile's status object. Profile publication plans use the exact alias version/revision and exact versioned status-object ETag/version as rollback coordinates; a rollback may touch neither a sibling key nor a newer alias revision. Because Lambda alias and S3 object updates cannot form one atomic AWS transaction, the browser and every operation still perform descriptor/data identity checks and fail closed during any cross-service partial window. Other jobs and runs continue. A later merge or explicit retry may replace it, but no fleet convergence or latest-source guarantee is claimed.

The alias and public status cannot use one precomputed plan: the production recheck evidence exists only after alias promotion. An alias-only plan therefore consumes the sealed staging smoke and the pre-promotion alias revision. After promotion, the job captures the new revision, runs the production health/bootstrap recheck, creates the composite-gated publication, and prepares a status-only conditional write plan that retains both the old alias version and old status-object version. Any failed production recheck restores the alias before a failed-outcome status is prepared.

The release report is a content-addressed aggregate derived from the exact registry, build eligibility, dependency lock, fixture manifests, runtime definitions, benchmark evidence files, and cost-control definitions. It distinguishes `defined-not-deployed` from live `verified` evidence and distinguishes candidate memory from qualified memory. Its top-level source identifies only the demos-branch commit that built the report; it is not a fleet source claim. Each profile's deployment identity is independently authoritative, so a released aggregate can truthfully contain mixed and out-of-order generations. A checked-in pre-release report is useful because it exposes every missing identity, but it does not satisfy the final release-report task: a released report needs an immutable report-build identity, actual artifact/deployment identities for every enabled profile, benchmark evidence behind any performance-selected default, qualified memory evidence, live alarms/budgets/Telegram evidence, and executable rollback coordinates.

The OpenSpec checklist has a separate fail-closed completion ledger. It groups
every unchecked task exactly once by its current evidence or authorization
gate, records the safe action while that gate is open, and is verified against
the authoritative checklist. An omitted, duplicated, prematurely checked, or
stale task makes local verification fail. This ledger reports blockers only;
it cannot turn a local definition into live evidence or complete the final
release report.

### 13. Merge deployment is deliberately small

Each target pair performs:

1. an unprivileged clean checkout at exact SHAs, dependency-cache restore, build/package, cheap artifact/configuration/read-only guards, digest creation, and content-addressed artifact upload;
2. a separate exact-environment deploy job that downloads and verifies only that artifact before requesting/using AWS credentials, with no dependency installation or build tool invocation;
3. immutable candidate upload/version publication;
4. bounded CORS preflight, health, descriptor identity, one allowed exemplar, one denied exemplar, and mutation-denial smoke through the candidate's exact direct Function URL;
5. per-profile live-alias promotion followed by a bounded production health/bootstrap identity recheck, or rollback/failure alert.

The single same-target build-to-deploy edge is an artifact handoff, not GitHub concurrency management or fleet coordination. Neither job awaits formal verification, full semantic conformance, browser/accessibility suites, fault injection, load/memory sweeps, data seeds, migrations, or other profiles. Initial enablement/material topology changes use separate manual qualification workflows. Formal workflows may continue independently but cannot gate demo deployment.

Those manual paths are concrete and fail closed. Full HTTP and
browser/accessibility qualification retain their own dispatches. A bounded
runtime dispatch covers staged load (at most 500 requests/eight workers with
zero accepted request failures and immediate stop after the first decisive
failure), a closed protocol/cancellation fault campaign with per-request
deadlines, a started-then-aborted client request, and recovery, or exact numeric
Lambda-version memory sampling whose direct-version ARN, runtime, architecture,
code digest, and per-invocation `REPORT` peak must match. Memory sampling also
stops once a passing report is no longer possible and never claims the direct
invocations traversed CloudFront. Report validation recomputes the closed case
set and measured outcome rather than trusting caller-supplied labels. Migration
and rollback rehearsal can move only a dedicated
`exercise` alias with an optimistic revision, prove both identities through
their exact direct Function URLs, require forward numeric version movement for migration and
backward movement for rollback, and restore the exact original version in
`always()` cleanup;
it cannot name `live`. Durable generation and seed workflows stay separate and
cost-gated. Source/workflow validation proves these paths remain available, not
that any external qualification, seed, or transition has run.
All staged qualification/transition URLs must match a separately configured
exact alias-qualified Function URL origin and exact `/api/v1/<profile>` path;
the input URL cannot make itself authoritative merely by being labeled staged.

### 14. GitHub settings favor safe speed and AWS OIDC

`main` remains the development default; `demos` is the deployment branch. Rulesets block force-push/deletion and require pull-request merge with no required approval count. Separate environments such as `demo-production-static` and `demo-production-<profile>` accept only `demos` and have no reviewer or wait timer. This gives each deployment role a distinct OIDC subject without serializing the jobs. Head branches auto-delete after merge.

Repository Actions permissions default to read-only. Deploy jobs request `contents: read` and `id-token: write`; permissions are not broadened for the entire workflow. The 2026-08-26 public audit reconfirms owner ID `1011676`, repository ID `1345904214`, creation after GitHub's 2026-07-15 immutable-subject cutoff, and the current default prefix `repo:theronic@1011676/eacl-demo@1345904214`. It is metadata evidence, not a substitute for the still-required allowlisted claim capture from a live job; the JWT itself is never printed, uploaded, or retained.

GitHub makes the OIDC request bearer available to the entire job once
`id-token: write` is granted; placing dependency installation before
`configure-aws-credentials` does not isolate it. All current manual OIDC jobs
therefore use only commit-pinned actions, disable checkout credential
persistence, install no packages, enable no package-manager cache, and call
their dependency-free checked-in Node entrypoints directly. Before AWS
configuration, a dedicated capture entrypoint requests an STS-audience token,
verifies RS256 against GitHub's fixed JWKS endpoint, checks every exact
registered claim and either exact migration subject, rejects reusable-workflow
identity for these top-level jobs, and uploads for one day only the closed
non-secret allowlist. It excludes the JWT/signature/request bearer and all
actor, run, SHA, token-ID, and time claims. Future ordinary deploy jobs inherit
the same bootstrap constraint in addition to their stronger unprivileged-build
artifact handoff.

The desired repository-wide subject template is exactly `[repo, ref, workflow_ref, environment, event_name, runner_environment]` with immutable subjects enabled. A deployment subject therefore binds the immutable repository prefix, `refs/heads/demos`, the top-level workflow path at that ref, one role-specific environment, the `push` event, and `github-hosted` execution without wildcards. Manual authorities instead bind `workflow_dispatch`. These jobs are not reusable workflows, so `job_workflow_ref` is absent and MUST NOT be required; it becomes the exact called-workflow condition only if a future design actually adopts a reusable workflow. Current AWS documentation exposes direct GitHub conditions for `repository_id`, `repository_owner_id`, `repository`, `ref`, `workflow`, and `environment`, but not `workflow_ref`, `event_name`, or `runner_environment`, so the policy requires all supported direct claims with `StringEquals` and also requires the exact custom `sub` carrying those remaining values. This reconciles AWS's May 2026 claim-key expansion with GitHub's lagging AWS-specific statement that custom claims are unavailable.

Because subject customization affects the whole repository, the authority manifest covers the five active future ordinary deployment roles and every local manual qualification, transition, and stateful role intended for publication. Parked Jank has no ordinary production authority or GitHub environment; those are added only if it is explicitly unparked. The 2026-08-26 remote audit found `main` and `demos` both at `858e11a807668c17b00345e89da90bc276b60126` with no workflow files; therefore no local OIDC workflow or generated policy is claimed live. Migration after publication updates every AWS trust before changing GitHub's template, may temporarily accept only the two exact recorded old/new subjects, verifies every job, and then removes the old subject. The static site and each active profile use separate least-privilege deployment roles/stacks; ordinary role variables and permission scopes are disjoint from seed and maintenance authorities.

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
OOM, and storage access. Datahike and Datomic emit initialization rather than
restore signals. Datalevin publishes only an AWS-optimized SnapStart version
and measures its first restored health request in deployment smoke.

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
that deployed readiness gate; Datalevin telemetry integration and Jank native
fatal-OOM behavior are also still open. The telemetry, retention, alarm,
dashboard, and canonical synthetic definitions are complete independently of
those runtime and deployed-evidence gates.

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
- **[Telegram notification fails]** → Cap asynchronous retries and event age; retain both SNS-subscription and notifier-invocation failures in an AWS-managed-encryption SQS queue; alarm on queue depth without attaching it as an event source; keep logs/errors redacted; and run an explicitly approved acceptance test before seed/deployment. Telegram cannot independently report its own total outage, so AWS queue/alarm inspection remains part of the gate.
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
9. Implement the fast `eacl-demo:demos` workflow for the active Datahike, Datomic, Datalevin, DataScript/static scope with the pinned EACL revision, maximum-parallel target jobs, bounded smoke, per-job rollback, and actual-identity reporting, without GitHub concurrency management; keep parked Jank out of the fan-out.
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
