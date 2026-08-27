## Why

EACL's public demonstrations are split across incompatible sites, repositories, user interfaces, source revisions, and deployment processes. Consolidate them under one URL and one continuously deployed workspace so users can compare real EACL v8 backend and storage combinations without confusing deployment drift for backend behavior.

## What Changes

- Establish the public `theronic/eacl-demo` repository and local `eacl-demo` workspace as the owner of the shared SolidJS UI, compact explorer contract, direct DataScript browser runtime, deterministic fixtures, backend services, infrastructure, CI/CD, deployment manifests, and operating documentation.
- Serve `https://demo.eacl.dev` from a private S3 origin through CloudFront, with a separately built DataScript entry at `https://demo.eacl.dev/datascript/` so ClojureScript/DataScript do not inflate the main application.
- Replace a composite-profile UI control with two explicit steps:
  1. select the EACL backend (`Datahike`, `Datomic`, `Datalevin`, `Jank`, or `DataScript`); and
  2. select one deployed and qualified storage layer supported by that backend.
- Keep composite profile IDs internally for routing and isolation. Datahike exposes S3 and DynamoDB; Datomic exposes DynamoDB; Datalevin and Jank expose their respective in-memory stores; DataScript exposes browser memory.
- Default storage to the fastest qualified option for the selected backend. A performance claim is valid only between storage profiles using the same backend, fixture, production path, region, operation mix, cache states, and measurement method; unequal backends or dataset sizes are never labeled globally fastest.
- Add isolated read-only runtimes for:
  - Datahike/S3 using the existing one-million-resource store and Lambda reader;
  - Datahike/DynamoDB using a new dedicated one-million-resource table after adapter and real-AWS qualification;
  - Datomic Pro/DynamoDB using a temporary provisioning transactor, history-preserving storage for the later separately qualified EC2 demo, and a Lambda read-only Peer that serves only the fixed current snapshot captured at environment initialization;
  - Datalevin/in-memory using approximately ten thousand deterministic resources in a managed Java Lambda that rebuilds ephemeral native state on a cold environment, with SnapStart disabled;
  - Jank using its bundled in-memory Datomic-like conformance store in a Linux x86_64 `provided.al2023` Lambda custom runtime with no SnapStart claim or dependency; and
  - DataScript running directly in the browser page at `/datascript/`.
- Keep Jank registered and fail-closed but park it outside the active rollout. Datahike, Datomic, Datalevin, DataScript, and their shared static/data/infrastructure units SHALL become deployable without waiting for Jank; Jank re-enters ordinary deployment only after an explicit unpark decision and its existing Linux qualification gates pass.
- Make every public server profile read-only. Durable schema installation and one-million-resource seeding use private workflows and temporary compute, never public routes or ordinary merge deployment.
- Record the user's preauthorization to create the two dedicated DynamoDB datasets and temporary EC2 seed, transactor, or Jank-build compute. Each run still resolves exact resources, forecasts cost, installs alarms first, and guarantees teardown; material scope expansion requires new authorization.
- Add DynamoDB throughput caps, consumption/throttle/unexpected-write alarms, project budgets and anomaly detection. Deliver alarm transitions to Telegram by generalizing the existing tested SNS/notifier path and reusing its AWS-held bot token; do not add customer-managed KMS keys or copy the token into GitHub.
- Continuously deploy every eligible active-track target when a commit reaches `theronic/eacl-demo:demos`. Each target enters the single workflow as soon as its own build-unit closure qualifies; it does not wait for every active profile. Each run uses that exact demo commit and the exact EACL Core revision pinned by it, then starts independent jobs immediately with no fleet-wide barrier, fail-fast cancellation, or atomic multi-profile rollout. Registered parked profiles remain visible and unavailable but are not queued and do not gate the workflow.
- Keep merge deployments deliberately short: unprivileged build/package, content-addressed handoff to a separate per-target OIDC deploy job, immutable candidate deployment, bounded health/bootstrap/identity/allowed/denied/mutation-denial smoke probes, then per-profile alias promotion or rollback. Formal verification, full conformance, fault campaigns, load sweeps, data seeding, and stateful migrations are not merge-deployment gates.
- Configure GitHub repository rules, deployment environments, Actions permissions, and AWS OIDC roles so only `theronic/eacl-demo:demos` can deploy without stored AWS access keys. Do not add GitHub concurrency groups, cancellation, latest-head guards, or cross-repository dispatch. A failed profile retains its last healthy version and reports the failed update while unrelated profiles continue.
- Require mixed-generation compatibility because the rollout is intentionally non-atomic. The UI and APIs support capability-driven N/N-1 operation; an incompatible contract change introduces a new versioned route rather than coordinating all profiles.
- Reuse the existing Datahike/S3 dataset, Lambda work, UI behavior, and Telegram implementation where provenance and focused qualification prove them safe. Do not duplicate the one-million-resource S3 store merely to change the hostname.
- **BREAKING**: change `demo.eacl.dev` from the legacy EC2/Datahike application at `/datahike/` to the canonical CloudFront explorer. Preserve tested fallbacks and rollback windows; legacy deletion remains separately approved.
- Replace `explorer.eacl.dev` as the canonical DataScript destination with `/datascript/`, retaining a compatibility route during migration.

## Capabilities

### New Capabilities

- `unified-demo-shell`: Shared two-step backend/storage selection, capability-driven SolidJS presentation, portable URL state, mixed-generation behavior, accessibility, and isolated DataScript loading.
- `unified-demo-api`: One compact read-only logical contract, server HTTP routing, response/source metadata, errors, cancellation, limits, and capability discovery.
- `datahike-storage-demos`: Adoption and comparison requirements for Datahike/S3 and qualification-gated Datahike/DynamoDB.
- `datomic-read-only-demo`: One-million-resource Datomic/DynamoDB provisioning and a transactor-free Lambda serving one fixed current database value.
- `datalevin-memory-demo`: Approximately ten-thousand-resource Datalevin in-memory Lambda, bounded cold rebuild, and honest ephemeral-storage lifecycle.
- `datascript-browser-demo`: Direct EACL v8 DataScript browser runtime, separate static artifact boundary, deterministic local data, and exact shared explorer behavior.
- `jank-lambda-demo`: Linux x86_64 `provided.al2023` Jank custom-runtime Lambda using the bundled in-memory Datomic-like conformance store without SnapStart.
- `demo-backend-conformance`: Deterministic fixtures, one-time backend qualification, lightweight merge smoke gates, comparable storage performance evidence, provenance, and honest limitations.
- `demo-delivery-operations`: CloudFront/S3 delivery, isolated AWS profiles, GitHub/OIDC CI/CD, parallel rollout, DynamoDB cost/Telegram controls, migration, rollback, and legacy retirement.

### Modified Capabilities

None. `eacl-demo` has no archived main specifications; sibling changes remain evidence and dependencies rather than silently modified contracts.

## Impact

- **Repositories and CI:** new public `theronic/eacl-demo` authority, one `demos` deployment branch, a pinned EACL Core revision in the repository, parallel GitHub Actions jobs, branch rules, deployment environments, and AWS OIDC trust. Existing incorrect/local demo remotes are not treated as release authorities.
- **Code:** shared packages and services under `eacl-demo`, incorporating the useful behavior now split across the Datomic, Datahike, Datalevin, Jank, and DataScript demos.
- **EACL dependencies:** every deployment records the exact EACL Core and demo source SHAs used. Datalevin additionally records its maintained fork/native closure; Jank records its Linux builder and native closure. Formal evidence is not required to deploy a demo.
- **AWS:** one canonical CloudFront/static foundation; isolated Lambda functions and aliases; two new, non-shared DynamoDB datasets; temporary seed/transactor/build compute where required; least-privilege OIDC/deployment and serving roles; dashboards, throughput caps, alarms, budgets, anomaly detection, SNS, and Telegram delivery.
- **Data operations:** reproducible private seeds, exactly one million resources for both durable DynamoDB comparison profiles, declared counts for smaller profiles, immutable serving datasets, and mandatory temporary-compute teardown.
- **Rollout:** active profiles and workflow runs are intentionally uncoordinated and may expose different generations. Each descriptor exposes its actual source/deployment identity; a failed active profile keeps its previous healthy deployment rather than blocking or rolling back siblings. Parked Jank remains outside ordinary fan-out.
- **Known gates:** Datahike/DynamoDB still requires real-AWS adapter evidence; Datalevin still needs a full memory/latency sweep although its pinned AL2023 native closure and cold-rebuilt demo artifact are deployed; Datomic storage retains history but its read-only Lambda supports only its fixed current snapshot. Jank is parked and, if later unparked, must build and smoke on Linux x86_64/AL2023 and cannot use Lambda SnapStart.
