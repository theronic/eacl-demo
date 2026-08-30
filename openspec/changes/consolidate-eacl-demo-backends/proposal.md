## Why

EACL's public demonstrations are split across incompatible sites, repositories, user interfaces, source revisions, and deployment processes. Consolidate them under one URL and one continuously deployed workspace so users can compare real EACL v8 backend and storage combinations without confusing deployment drift for backend behavior.

## What Changes

- Establish the public `theronic/eacl-demo` repository and local `eacl-demo` workspace as the owner of the shared SolidJS UI, compact explorer contract, direct DataScript browser runtime, deterministic fixtures, backend services, infrastructure, CI/CD, deployment manifests, and operating documentation.
- Serve `https://demo.eacl.dev` from a private S3 origin through CloudFront, with a separately built DataScript entry at `https://demo.eacl.dev/datascript/` so ClojureScript/DataScript do not inflate the main application.
- Replace a composite-profile UI control with explicit product and execution dimensions:
  1. select the EACL backend (`Datahike`, `Datomic`, `Datalevin`, `Jank`, or `DataScript`); and
  2. select one deployed storage layer supported by that backend; then
  3. select an execution platform when multiple qualified Lambda-memory, EC2, or browser variants exist.
- Keep composite profile IDs internally for routing and isolation. Datahike exposes S3 and DynamoDB across qualified Lambda memory variants; Datomic exposes fixed-basis DynamoDB readers on Lambda and the separately identified EC2 topology; Datalevin exposes embedded LMDB on Lambda and EC2; Jank exposes its bundled in-memory store; DataScript exposes browser memory.
- Default storage to the fastest qualified option for the selected backend. A performance claim is valid only between storage profiles using the same backend, fixture, production path, region, operation mix, cache states, and measurement method; unequal backends or dataset sizes are never labeled globally fastest.
- Add isolated read-only runtimes for:
  - Datahike/S3 using the existing one-million-resource store and Lambda reader;
  - Datahike/DynamoDB using a new dedicated one-million-resource table after adapter and real-AWS qualification;
  - Datomic Pro/DynamoDB using a temporary provisioning transactor, history-preserving storage, a SnapStarted Lambda read-only Peer that serves all EACL consistency selections over the fixed database value captured at initialization without synchronization, and a separately identified shared-EC2 historical-exact topology;
  - Datalevin/embedded LMDB using approximately ten thousand deterministic resources in a 1769 MiB managed Java Lambda whose ready `/tmp` database state is captured in a qualified published-version SnapStart snapshot, plus a separately identified shared-EC2 service with a durable embedded path;
  - Jank using its bundled in-memory Datomic-like conformance store in a Linux x86_64 `provided.al2023` Lambda custom runtime with no SnapStart claim or dependency; and
  - DataScript running directly in the browser page at `/datascript/`.
- Keep Jank registered and fail-closed but park it outside the active rollout. Datahike, Datomic, Datalevin, DataScript, and their shared static/data/infrastructure units SHALL become deployable without waiting for Jank; Jank re-enters ordinary deployment only after an explicit unpark decision and its existing Linux qualification gates pass.
- Make every public server profile read-only. Durable schema installation and one-million-resource seeding use private workflows and temporary compute, never public routes or ordinary merge deployment.
- Record the user's preauthorization to create the two dedicated DynamoDB datasets and temporary EC2 seed, transactor, or Jank-build compute. Each run still resolves exact resources, forecasts cost, installs alarms first, and guarantees teardown; material scope expansion requires new authorization.
- Add DynamoDB throughput caps, consumption/throttle/unexpected-write alarms, project budgets and anomaly detection. Deliver alarm transitions to Telegram by generalizing the existing tested SNS/notifier path and reusing its AWS-held bot token; do not add customer-managed KMS keys or copy the token into GitHub.
- Continuously deploy every eligible active-track target when a commit reaches `theronic/eacl-demo:main`. Each target enters the single workflow as soon as its own build-unit closure qualifies; it does not wait for every active profile. Each run uses that exact demo commit and the exact EACL Core revision pinned by it, then starts independent jobs immediately with no fleet-wide barrier, fail-fast cancellation, or atomic multi-profile rollout. Registered parked profiles remain visible and unavailable but are not queued and do not gate the workflow.
- Keep merge deployments deliberately short: one direct job per target checks out, builds, assumes only that target's OIDC role, deploys an immutable candidate, runs bounded health/bootstrap/identity/allowed/denied/mutation-denial smoke probes, then promotes or rolls back only that profile. Formal verification, full conformance, fault campaigns, load sweeps, data seeding, and stateful migrations are not merge-deployment gates.
- Configure GitHub repository rules, deployment environments, Actions permissions, and AWS OIDC roles so only `theronic/eacl-demo:main` can deploy without stored AWS access keys. Do not add GitHub concurrency groups, cancellation, latest-head guards, or cross-repository dispatch. A failed profile retains its last healthy version and reports the failed update while unrelated profiles continue.
- Require mixed-generation compatibility because the rollout is intentionally non-atomic. The UI and APIs support capability-driven N/N-1 operation. Each server profile's Function URL is its namespace and exposes only root operation names, with no `/api`, version, backend, storage, or profile path prefix.
- Reuse the existing Datahike/S3 dataset, Lambda work, UI behavior, and Telegram implementation where provenance and focused qualification prove them safe. Do not duplicate the one-million-resource S3 store merely to change the hostname.
- **BREAKING**: change `demo.eacl.dev` from the legacy EC2/Datahike application at `/datahike/` to the canonical CloudFront explorer. Preserve tested fallbacks and rollback windows; legacy deletion remains separately approved.
- Replace `explorer.eacl.dev` as the canonical DataScript destination with `/datascript/`, retaining a compatibility route during migration.

## Capabilities

### New Capabilities

- `unified-demo-shell`: Shared backend/storage/execution selection, capability-driven SolidJS presentation, portable URL state, mixed-generation behavior, accessibility, and isolated DataScript loading.
- `unified-demo-api`: One compact read-only logical contract with root operation paths such as `/lookup-resources` and `/check-permission`, response/source metadata, errors, cancellation, limits, and capability discovery.
- `datahike-storage-demos`: Adoption and comparison requirements for Datahike/S3 and qualification-gated Datahike/DynamoDB.
- `datomic-read-only-demo`: One-million-resource Datomic/DynamoDB provisioning, a transactor-free SnapStarted Lambda serving every EACL consistency selection over one fixed database value, and a separately qualified EC2 historical-exact topology.
- `datalevin-memory-demo`: Approximately ten-thousand-resource embedded Datalevin deployments: an ephemeral 1769 MiB Lambda `/tmp` database with qualified SnapStart restore and a persistent shared-EC2 database with distinct lifecycle identity.
- `datascript-browser-demo`: Direct EACL v8 DataScript browser runtime, separate static artifact boundary, deterministic local data, and exact shared explorer behavior.
- `jank-lambda-demo`: Linux x86_64 `provided.al2023` Jank custom-runtime Lambda using the bundled in-memory Datomic-like conformance store without SnapStart.
- `demo-backend-conformance`: Deterministic fixtures, locally runnable backend diagnostics, lightweight live smoke, comparable storage performance evidence, provenance, and honest limitations.
- `demo-delivery-operations`: CloudFront/S3 delivery, isolated AWS profiles, GitHub/OIDC CI/CD, parallel rollout, DynamoDB cost/Telegram controls, migration, rollback, and legacy retirement.

### Modified Capabilities

None. `eacl-demo` has no archived main specifications; sibling changes remain evidence and dependencies rather than silently modified contracts.

## Impact

- **Repositories and CI:** new public `theronic/eacl-demo` authority, one directly pushable `main` deployment branch, a pinned EACL Core revision in the repository, five parallel direct GitHub Actions jobs, deployment environments, and AWS OIDC trust. Existing incorrect/local demo remotes are not treated as release authorities.
- **Code:** shared packages and services under `eacl-demo`, incorporating the useful behavior now split across the Datomic, Datahike, Datalevin, Jank, and DataScript demos.
- **EACL dependencies:** every deployment records the exact EACL Core and demo source SHAs used. Datalevin additionally records its maintained fork/native closure; Jank records its Linux builder and native closure. Formal evidence is not required to deploy a demo.
- **AWS:** one canonical CloudFront/static foundation; isolated Lambda functions and aliases using unreserved account concurrency; separately identified shared-EC2 Datomic/Datalevin services; two new, non-shared DynamoDB datasets; temporary seed/transactor/build compute where required; least-privilege OIDC/deployment and serving roles; dashboards, throughput caps, alarms, budgets, anomaly detection, SNS, and Telegram delivery.
- **Data operations:** reproducible private seeds, exactly one million resources for both durable DynamoDB comparison profiles, declared counts for smaller profiles, immutable serving datasets, and mandatory temporary-compute teardown.
- **Rollout:** active profiles and workflow runs are intentionally uncoordinated and may expose different generations. Each descriptor exposes its actual source/deployment identity; a failed active profile keeps its previous healthy deployment rather than blocking or rolling back siblings. Parked Jank remains outside ordinary fan-out.
- **Known gates:** Both Datahike storage profiles must pass current restored-reader qualification at the declared 1769 MiB primary and 4096 MiB comparison settings, including post-restore storage access and memory headroom. Datalevin must pass full semantic/load/headroom qualification for both its 1769 MiB SnapStarted Lambda and shared-EC2 embedded variants. Datomic must complete current repeated SnapStart/direct qualification without `d/sync`; its separately advertised EC2 topology retains independent evidence. Jank is parked and, if later unparked, must build and smoke on Linux x86_64/AL2023 and cannot use Lambda SnapStart.
