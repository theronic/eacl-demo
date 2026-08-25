# Existing-source disposition

This record completes OpenSpec task 1.3. It classifies every existing UI, service, fixture/data, infrastructure, and backend-dependency source area that can affect the consolidated demo. The immutable Git identities and exact dirty manifests are in `source-state-2026-08-25.json`; classifications apply to that captured state, including uncommitted files, and are not release provenance by themselves.

## Classification meanings

- **adopt** — retain the existing deployed resource or implementation substantially intact after provenance and focused qualification; a compatibility wrapper is allowed.
- **extract** — deliberately port selected behavior/tests into a new canonical package; do not copy the entire dirty worktree or preserve its repository identity.
- **replace** — build a new implementation for the consolidated contract/topology; the old area is evidence only.
- **dependency-only** — consume an immutable, reachable, locked upstream artifact/source revision; do not vendor the working tree into `eacl-demo`.
- **retire** — keep only as a tested fallback until cutover observation and separately approved destructive retirement.

An area with useful material and an obsolete delivery path is classified by what enters `eacl-demo`; its eventual legacy disposition is stated separately. Nothing marked retire is authorized for deletion by this document.

## EACL Core and backend dependencies

| Source area | Kind | Classification | Canonical treatment and gate |
| --- | --- | --- | --- |
| `core/modules/eacl/src` and generated runtime used by public operations | service dependency | dependency-only | Pin one reachable Core commit in the `eacl-demo` lock and record it as `eacl-sha`. Do not publish dirty local-root source. Current Core tests have five failures, so the captured checkout is not yet a release lock. |
| `core/modules/eacl-datahike/src` | backend adapter | dependency-only | Consume the exact locked adapter revision. DynamoDB support remains disabled until the adapter-specific real-AWS gates pass. |
| `core/modules/eacl-datomic/src` | backend adapter | dependency-only | Consume the exact locked adapter revision, but bypass generic `d/sync`-requiring paths in the fixed-current Lambda boundary. |
| `core/modules/eacl-datalevin/src` | backend adapter | dependency-only | Consume only with the exact maintained Datalevin fork/native closure and clean remote-consumer evidence. |
| `core/modules/eacl-datascript/src` | browser adapter | dependency-only | Compile only into the `/datascript/` entry/worker from the pinned current Core revision. |
| `core/formal`, formal workflows, and formal evidence | verification dependency | dependency-only | Retain as independent assurance input. It cannot gate or trigger ordinary `demos` deployment. |
| `datalevin/src`, native resources, `doc/read-snapshots.md`, and `doc/write-policy.md` | backend/runtime dependency | dependency-only | Pin the maintained fork commit/artifact and Linux arm64 native closure. Never release against the dirty sibling path. |

## Datahike demo

Captured source: `/Users/petrus/code/eacl/eacl-datahike-demo` at the identity recorded as `datahike-demo`.

| Source area | Kind | Classification | Canonical treatment and gate |
| --- | --- | --- | --- |
| `client/src/components/**`, `format.ts`, and accessible presentation styles | UI | extract | Port backend-neutral explorer presentation and permission-detail behavior into shared UI packages; remove backend-name branching. |
| `client/src/state.tsx`, `api.ts`, `types.ts`, `preferences.ts`, and `App.tsx` | UI state/transport | replace | Implement the two-step selector, profile registry, `explorer.v1`, client epochs, aborts, portable URL state, and N/N-1 behavior in canonical packages. Preserve only characterized UX behavior. |
| `server/src/eacl_datahike_demo/reader.clj`, `lambda_adapter.clj`, `lambda_handler.clj`, `read_only_writer.clj`, and immutable snapshot handling | S3 read service | adopt | Reuse for `datahike-s3` after exact artifact/store/basis/read-only evidence. Add the common route/envelope/identity boundary without reseeding the store. |
| `server/src/eacl_datahike_demo/api.clj`, `contracts.clj`, `runtime.clj`, `http.clj`, and `system.clj` | service contract/runtime | extract | Port bounded request/error semantics and tests, then normalize them behind the new versioned dispatcher. Legacy public route shape is not canonical. |
| `server/src/eacl_datahike_demo/data.clj`, `storage_gc.clj`, cache persistence, schema/seed/write code, and development main | fixture/maintenance | replace | Move durable schema/seed/repair to private stateful workflows. The public artifact contains no writer, GC, setup, seed, or cache-persistence mutation route. |
| Current one-million-resource S3 store and recorded serving basis | durable dataset | adopt | Reuse without in-place mutation or duplicate reseed after count/digest/exemplar/provenance verification. Blue/green replacement is separate. |
| `infra/lambda-cloudformation.yaml`, Lambda artifact guards, alias activation/rollback, and serverless reader runbooks | runtime infrastructure | extract | Use the proven Java arm64/SnapStart/read-only patterns in a dedicated profile stack; replace hard-coded legacy paths and shared-stack ownership. |
| `infra/monitoring-cloudformation.yaml`, notifier code, SNS tests, and `docs/monitoring.md` | observability | extract | Generalize the tested SNS→Lambda→Telegram behavior. Reuse the AWS-held `demo/eacl/datahike/telegram` token metadata; never copy its value to GitHub. |
| Existing alarm SNS topic and Telegram secret | deployed operations resource | adopt | Retain as the notification foundation until a separately qualified replacement exists. Add DynamoDB-specific alarms before seeding. |
| `infra/serverless-domain-cloudformation.yaml` and current serverless static bucket/distribution behavior | static delivery | replace | Build the canonical private-S3/CloudFront foundation with main and isolated DataScript entries. Keep the current distribution as a fallback during migration. |
| `infra/cloudformation.yaml`, Caddy/systemd/SSH/capacity scripts, EC2 deployment scripts, and the running instance | legacy EC2 infrastructure | retire | Preserve `demo.eacl.dev/datahike/` as a tested fallback through cutover. Stop/delete only after an exact retirement report and separate approval. |
| Legacy store replacement/deletion scripts and old-bucket retirement scripts | destructive maintenance | retire | Do not import into ordinary deployment. Preserve as audited legacy recovery evidence until separate retirement approval. |

## Datomic SolidJS demo

Captured source: `/Users/petrus/code/eacl/eacl-datomic-solidjs` at the identity recorded as `datomic-demo`.

| Source area | Kind | Classification | Canonical treatment and gate |
| --- | --- | --- | --- |
| `client/src/components/**`, `format.ts`, and permission-detail presentation | UI | extract | Port the useful EACL v8 permission and explorer behavior into shared components. |
| `client/src/state.tsx`, `api.ts`, `types.ts`, `preferences.ts`, and `App.tsx` | UI state/transport | replace | Use the canonical selector/registry/contract state machine instead of a Datomic-specific shell. |
| `server/src/eacl_solidjs/api.clj`, `contracts.clj`, `benchmark_stats.clj`, and normalized read tests | service semantics | extract | Port bounded read behavior and exemplars into the common dispatcher/qualification suite. |
| `server/src/eacl_solidjs/data.clj`, `system.clj`, `main.clj`, and startup schema/seed/transact behavior | mutable service topology | replace | Split into a private temporary transactor/seed workflow and a public read-only Peer Lambda that captures one `d/db` at initialization. |
| Current in-memory development fixture and identifiers | fixture | extract | Preserve semantic exemplars and expected results, but regenerate them from the canonical deterministic fixture manifest. |
| Absent deployment infrastructure | infrastructure | replace | Add independent Datomic DynamoDB data, seed-compute, read-only runtime, IAM, observability, cost-control, and rollback stacks. |

## Datalevin SolidJS demo

Captured source: `/Users/petrus/code/eacl/eacl-datalevin-solidjs` at the identity recorded as `datalevin-demo`.

| Source area | Kind | Classification | Canonical treatment and gate |
| --- | --- | --- | --- |
| `client/src/**` | UI | extract | Port useful common presentation only; this tree is a partially renamed Datahike fork and is not a canonical application boundary. |
| `server/src/eacl_datahike_demo/api.clj`, `contracts.clj`, `eacl_adapter.clj`, and lifecycle experiments | service semantics | extract | Preserve explicit read-snapshot ownership/lifecycle tests and supported operation behavior in a Datalevin-named service package. |
| `server/src/eacl_datahike_demo/system.clj`, `runtime.clj`, `main.clj`, `storage_gc.clj`, and copied Datahike topology | service topology | replace | Implement one true in-memory Datalevin environment per Lambda, immutable readiness, platform-thread ownership, exact-once release, and qualified SnapStart restore strategy. |
| `server/src/eacl_datahike_demo/data.clj` and copied fixture | fixture | replace | Generate the canonical deterministic 10,000-resource fixture and bind lifecycle/watermark identity. |
| `server/deps.edn` local-root Core dependency | dependency linkage | replace | Use immutable remote coordinates/locks. The current build fails because `clojure.core.async` is absent from the declared closure. |
| `infra/**` copied EC2/Datahike stacks, Caddy/systemd, seed, bucket, and monitoring scripts | infrastructure | retire | Do not deploy these copied resources. Retain only as source evidence; create an independent managed Java Lambda/SnapStart profile stack. |

## Jank demo

Captured source: `/Users/petrus/code/eacl/eacl-jank`, which is unborn and therefore has no immutable repository commit.

| Source area | Kind | Classification | Canonical treatment and gate |
| --- | --- | --- | --- |
| `modules/eacl/**`, `modules/eacl-datomic-memory/**`, and `modules/eacl-runtime-jank/**` | native service/runtime | extract | Import the reviewed Jank/EACL closure into a canonical service package or immutable dependency only after an initial Jank repository commit exists. Preserve the bundled in-memory conformance-store label and limitations. |
| `compat/**`, native tests, source audit, schema/crypto/toolchain checks, and golden fixtures | fixture/qualification | extract | Port the applicable deterministic fixture, ABI, artifact, and runtime guards into the Linux x86_64/AL2023 qualification path. |
| `dev/eacl_jank/demo_server.jank`, `demo/proxy.mjs`, `bin/demo*`, and LAN verification | development service | retire | Do not expose LAN proxy, setup, raw benchmark, or development routes in Lambda. Keep only as local diagnostic evidence. |
| `client/src/**` | UI | extract | Port shared explorer behavior; discard the separate Jank shell once the canonical UI serves the profile. |
| Current macOS arm64/Homebrew toolchain manifest and built artifacts | build infrastructure | replace | Establish a digest-pinned Linux x86_64 Amazon Linux 2023-compatible builder and ZIP root `bootstrap`. Current host build passes but cannot run on Lambda. |
| `.github/workflows/certification.yml` | verification infrastructure | extract | Keep deep certification independent/manual. Ordinary `demos` CI performs only build/package/deploy/bounded smoke. |

## Legacy DataScript explorer

Captured source: `/Users/petrus/code/eacl-explorer` at the identity recorded as `datascript-explorer`.

| Source area | Kind | Classification | Canonical treatment and gate |
| --- | --- | --- | --- |
| `src/eacl/explorer/core.cljs`, `explorer.cljs`, and `state.cljs` Rum application | UI | retire | Replace with the shared SolidJS explorer at `/datascript/`; extract only characterized browser-local behavior and navigation semantics. |
| `src/eacl/explorer/seed.cljs`, `resource_macros.clj`, and `resources/eacl/explorer/default-schema.zed` | fixture/schema | extract | Reconcile stable IDs, schema, exemplars, and local seed behavior into the language-neutral canonical fixture. |
| `deps.edn` EACL v7-era pinned Git dependencies | dependency linkage | replace | Pin the current reachable EACL v8 Core and `eacl-datascript` adapter through the canonical repository lock. |
| Browser database/client execution in the main CLJS thread | service/worker boundary | replace | Move DataScript, EACL client, DB, cursors, cache, and cancellation lifecycle into a dedicated validated Web Worker. |
| `resources/public/**` legacy HTML/CSS/graph assets | static UI | extract | Port only useful graph/accessibility behavior; build new content-hashed DataScript-only assets. |
| `.github/workflows/deploy-pages.yml`, `script/build-pages.sh`, `CNAME`, and GitHub Pages hosting | infrastructure | retire | Preserve `explorer.eacl.dev` compatibility during migration, then retire only after observation and separate approval. The current compile also lacks a declared/installed React dependency. |

## Canonical ownership result

`eacl-demo` owns all new UI/state/contract/fixture/service/infrastructure/workflow/runbook source. Existing deployed Datahike S3 data, the qualified reader, and the AWS-held Telegram notification secret/path are the only planned adoptions. Everything else is either selectively extracted, consumed as an immutable dependency, replaced for the new topology, or retained as an explicitly non-destructive retirement candidate.
