## 1. Preserve source state and establish authority

- [x] 1.1 Record the exact HEAD, branch, dirty/untracked manifest, dependency locks, build status, and remote for EACL core and every existing demo without modifying unrelated user work.
- [x] 1.2 Record the current AWS account, region, demo resources, DNS, certificates, functions, tables, buckets, alarms, backups, and public health identities with secrets redacted.
- [x] 1.3 Classify each existing UI, service, fixture, and infrastructure source area as adopt, extract, replace, dependency-only, or retire.
- [x] 1.4 Preserve immutable baseline screenshots and machine-readable health/bootstrap responses for each reachable legacy demo.
- [x] 1.5 Verify theronic/eacl-demo is the canonical product repository and its origin is https://github.com/theronic/eacl-demo.git.
- [x] 1.6 Define a deployment manifest that binds one immutable eacl-demo SHA and the exact reachable EACL Core SHA pinned by that repository revision.
- [x] 1.7 Create and push the reviewed initial eacl-demo main commit without importing unrelated sibling-worktree changes.
- [x] 1.8 Create or verify the demos deployment branch in theronic/eacl-demo without creating a coordinated Core deployment branch.
- [x] 1.9 Document that local-root dependencies, dirty checkouts, and mutable branch names cannot be release identities.

## 2. Workspace and reproducible build foundations

- [x] 2.1 Create clear app, package, fixture, service, infrastructure, verification, and documentation boundaries in eacl-demo.
- [x] 2.2 Pin Node, package manager, Java, Clojure, ClojureScript, Jank, native compiler, infrastructure, formatter, and test tool versions.
- [x] 2.3 Add independently callable builds for the main explorer, DataScript entry and worker, each Lambda artifact, fixture manifests, and infrastructure plans.
- [x] 2.4 Add isolated dependency locks or reproducible resolution records for JVM, JavaScript, native, and infrastructure dependencies.
- [x] 2.5 Generate artifact digests and a closed release-manifest format containing both repository SHAs, fixture identity, contract version, and deployment identity.
- [x] 2.6 Add deterministic clean-build checks and record any unavoidable nondeterministic fields.
- [x] 2.7 Add secret scanning that proves static bundles, source maps, logs, and manifests contain no credentials, connection strings, Telegram tokens, or signing material.
- [x] 2.8 Document and automate the required nREPL-based Clojure test workflow, using namespace reload after source changes.

## 3. Backend/storage selector and profile registry

- [x] 3.1 Define the closed backend list and the storage choices supported by each backend.
- [x] 3.2 Define stable profile IDs for Datahike/S3, Datahike/DynamoDB, Datomic/DynamoDB, Datalevin/memory, Jank/memory, and DataScript/browser-memory.
- [x] 3.3 Implement the first selector for backend and a dependent second selector for storage.
- [x] 3.4 Make Datahike the initial backend while allowing a canonical URL to override that initial selection.
- [x] 3.5 Implement enabled, disabled, qualifying, and unavailable states with a specific reason for every non-selectable choice.
- [x] 3.6 Define the capability vocabulary for operations, consistency, snapshot behavior, cache behavior, mutation locality, limits, dataset identity, and limitations.
- [x] 3.7 Define the fastest-storage evidence record with fixture digest, operation mix, region, runtime, memory, repetitions, date, and result.
- [x] 3.8 Select fastest only among qualified storage choices tested on the same fixture and benchmark method.
- [x] 3.9 Fall back to the sole qualified storage choice when no comparable benchmark exists and show no unsupported speed claim.
- [x] 3.10 Implement the profile registry as independently publishable data with actual deployed demo/core SHAs, artifact identity, and last deployment outcome, without a latest-source or convergence claim.
- [x] 3.11 Implement profile switching with request cancellation, monotonically increasing client epochs, backend-state release, descriptor identity checks, and first-page restart.
- [x] 3.12 Test rapid switches, late success and error responses, unavailable options, missing small-fixture objects, worker teardown, and mixed deployment generations.
- [x] 3.13 Implement canonical URL parsing and serialization with allowlisted bounded semantic fields and no cursor, token, basis, request ID, or secret values.
- [x] 3.14 Test direct links, canonical normalization, malformed and oversized inputs, browser back/forward navigation, and backend/storage replacement semantics.

## 4. Versioned explorer contract and shared service boundary

- [x] 4.1 Define closed explorer.v1 schemas for objects, relationships, page information, counts, authorization decisions, schema, cache information, basis metadata, health, bootstrap, success, and failure.
- [x] 4.2 Define stable error codes for validation, method and route rejection, cursor failures, unsupported consistency, cancellation, deadline, overload, throttling, unavailable dependencies, corrupt or missing storage, and internal failure.
- [x] 4.3 Define bounded request and response limits for bodies, strings, arrays, pages, counts, cursors, diagnostics, and total output.
- [x] 4.4 Implement /api/v1/{profile-id} routing and the equivalent DataScript worker message contract.
- [x] 4.5 Implement runtime boundary validation for client, server, worker, fixture, descriptor, registry, and release-manifest data.
- [x] 4.6 Implement common success and error envelopes carrying request, profile, deployed demo SHA, deployed core SHA, artifact, and data identities.
- [x] 4.7 Implement identity-checked health/bootstrap descriptors and reject route, artifact, or registry mismatches before normal use.
- [x] 4.8 Implement closed method, route, content-type, query, path, and body allowlists.
- [x] 4.9 Implement deadlines, cancellation propagation, admission bounds, response-size limits, and deterministic cleanup.
- [x] 4.10 Implement the shared read-only logical operations and exclude schema writes, seeds, setup, benchmarks, arbitrary transactions, cache eviction, and administration from public dispatchers.
- [x] 4.11 Implement scoped, tamper-evident cursors that cannot cross profile, query, lifecycle, or incompatible contract identity.
- [x] 4.12 Implement N/N-1 contract compatibility and require a new API route version for incompatible changes.
- [x] 4.13 Add redaction and route-table tests proving failures cannot expose secrets and unlisted requests cannot reach mutating or expensive handlers.
- [x] 4.14 Add a reusable Lambda Function URL event and response contract suite for JVM and custom runtimes.

## 5. Canonical fixture and comparable storage benchmark

- [x] 5.1 Reconcile the current EACL v8 schemas, quick subjects, counts, permission examples, and stable ID conventions into one fixture decision record.
- [x] 5.2 Implement a deterministic generator with a fixed algorithm version and seed for 10,000- and 1,000,000-resource cut points.
- [x] 5.3 Prove the 10,000-resource fixture is a semantic prefix or subset of the million-resource fixture.
- [x] 5.4 Define exact logical subject, resource, schema, relationship, and permission counts separately from backend physical counts.
- [x] 5.5 Define allowed and denied direct, relationship-arrow, permission-arrow, cyclic, duplicate, reverse-discovery, filter, count, and pagination exemplars.
- [x] 5.6 Produce language-neutral fixture and manifest formats usable by Clojure, ClojureScript, Jank, and TypeScript.
- [x] 5.7 Implement streaming or batched durable seeds and bounded browser or in-memory generators.
- [x] 5.8 Verify fixture digests and invariants for partial batches, duplicates, dangling relationships, schema drift, and wrong cut points.
- [x] 5.9 Add cross-language golden tests for stable IDs, schema digest, counts, exemplars, and fixture digest.
- [x] 5.10 Define the one-million-resource Datahike S3 versus DynamoDB benchmark, including identical operation mix, region, runtime, memory, cache states, repetitions, and uncertainty reporting.
- [x] 5.11 Publish benchmark evidence to the registry and prevent incomparable datasets or configurations from determining a fastest default.
- [x] 5.12 Document immutable blue-green fixture publication and prohibit mutation of an accepted data manifest.

## 6. Shared SolidJS explorer and DataScript entry

- [x] 6.1 Inventory and reconcile the current Datahike, Datomic, Datalevin, and Jank explorer components, state, API types, preferences, and styles.
- [x] 6.2 Implement a backend-neutral explorer state package and mock transports for every advertised capability combination.
- [x] 6.3 Extract accessible shared header, selector, status, error, loading, pagination, object, relationship, schema, cache, consistency, and metadata components.
- [x] 6.4 Render capability and limitation text from descriptors rather than backend-name conditionals.
- [x] 6.5 Implement bounded subject paging, resource lookup, escalating bounded counts, cursor paging, relationship expansion, reverse lookup, schema view, and authorization result details.
- [x] 6.6 Implement cold or restore startup state, retry and cancel controls, partial panel failure isolation, and accessible live announcements.
- [x] 6.7 Implement light and dark themes, reduced motion, visible focus, durable async focus, and responsive layouts.
- [x] 6.8 Add component and state tests for capabilities, unavailable profiles, validation failures, stale responses, and selector changes.
- [x] 6.9 Add accessibility and principal desktop/mobile browser qualification outside the ordinary merge deployment gate.
- [x] 6.10 Build /datascript/ as a separate SolidJS entry with a dedicated ClojureScript worker and EACL v8 DataScript adapter.
- [x] 6.11 Implement bounded worker validation, request IDs, client epochs, cancellation, late-reply suppression, deterministic fixture generation, progress, and cleanup.
- [x] 6.12 Prove DataScript authorization and fixture data remain browser-local and public network calls are not made for its operations.
- [x] 6.13 Prove DataScript, ClojureScript worker, and DataScript-only dependencies are absent from the main server-profile bundle.
- [x] 6.14 Build the main and DataScript static entries into one static artifact in the same unprivileged job so they never race on the static bucket prefix.

## 7. Qualification harness and fast merge smoke

- [x] 7.1 Implement a qualification runner for local transports, authorized staged origins, and the staged CloudFront domain while retaining exact source, artifact, data, and profile identities.
- [x] 7.2 Implement common contract, authorization, relationship, pagination, cursor, cache, consistency, failure, cleanup, redaction, and identity cases.
- [x] 7.3 Implement representative cold, restore, and warm workloads with explicit dataset, cache, concurrency, latency, error, and memory-headroom criteria.
- [x] 7.4 Produce machine-readable and human-readable reports that distinguish unsupported features from failed behavior.
- [x] 7.5 Keep a profile disabled until its initial production-path qualification evidence is complete.
- [x] 7.6 Create a minimal merge smoke suite limited to health, bootstrap identity, one allowed authorization example, one denied example, and one expected mutation denial.
- [x] 7.7 Assert ordinary demos-branch deployment has no dependency on formal verification, full conformance, full browser suites, load tests, memory sweeps, fault injection, seeds, or migrations.
- [x] 7.8 Ensure the EACL formal workflow does not gate or trigger as part of ordinary demos-branch deployment, preserving any unrelated existing workflow edits.
- [x] 7.9 Retain initial/manual workflows for full qualification, browser, accessibility, load, memory, fault, seed, migration, and rollback exercises.

## 8. Datahike storage profiles

- [x] 8.1 Resolve the existing Datahike/S3 reader's exact fixture, schema, counts, selected basis, source, artifact, runtime, configuration, and storage provenance without mutating its store.
- [x] 8.2 Adopt the S3 reader behind the common prefix, descriptor, envelope, cancellation, admission, and immutable request-snapshot boundary.
- [x] 8.3 Preserve truthful S3 consistency and cache claims and exclude mutation, setup, benchmark, and administration routes.
- [ ] 8.4 Qualify the one-million-resource S3 profile, publish an immutable Lambda alias and descriptor, and enable it only after staged smoke passes.
- [x] 8.5 Pin the Datahike, Konserve, and DynamoDB adapter dependency path and turn known broad-exception, eventual-read, partial-batch, and destructive-delete findings into regression tests.
- [x] 8.6 Repair or wrap missing-item handling so absence cannot mask throttling, authorization, timeout, transport, corrupt data, or unexpected failures.
- [x] 8.7 Use strongly consistent publication-critical reads or prove an equivalent safe publication protocol.
- [x] 8.8 Implement bounded jittered retry that preserves deadline, cancellation, and error classification.
- [x] 8.9 Fully handle unprocessed batch keys within bounds or remove the affected batch path from qualified serving operations.
- [x] 8.10 Exclude destructive store deletion and all write or administration paths from the serving artifact.
- [ ] 8.11 Qualify the repaired adapter first with DynamoDB Local and then with a disposable real AWS table covering publication, consistency, throttling, IAM denial, partial batches, missing or corrupt nodes, cancellation, and concurrency.
- [ ] 8.12 Provision a dedicated blue-green production Datahike DynamoDB table with AWS-owned encryption, on-demand billing, deletion protection, point-in-time recovery, tags, and separate serving and seed roles.
- [ ] 8.13 Seed and verify the immutable one-million-resource Datahike fixture through the explicit stateful workflow after alarms and request caps are active.
- [ ] 8.14 Obtain separate explicit authorization, then provision, seed, verify, and publish a distinct canonical one-million-resource Datahike/S3 blue-green generation without mutating or relabeling the adopted store.
- [ ] 8.15 Sweep Datahike S3 and DynamoDB Lambda memory independently, then use the larger independently passing minimum as the shared comparison/production memory while a speed claim is active; start with SnapStart disabled on both.
- [ ] 8.16 Run the comparable storage benchmark only after both profiles bind the exact canonical fixture, then make the evidenced fastest qualified Datahike storage the default.
- [ ] 8.17 Publish and enable Datahike/DynamoDB only after adapter, real-AWS, IAM, cost-control, seed, runtime, and staged checks pass; until comparable S3 exists, use the deterministic qualified fallback with no speed claim.

## 9. Datomic DynamoDB current-snapshot profile

- [x] 9.1 Pin Datomic Peer 1.0.7622 or later, its storage-client dependencies, the accepted EACL v8 Datomic adapter, licenses, and dependency convergence.
- [x] 9.2 Separate database creation, transactor, schema, and seed code from the public reader and prove no write path is initialized by the serving artifact.
- [ ] 9.3 Provision a dedicated blue-green Datomic DynamoDB database and table with AWS-owned encryption, on-demand billing, deletion protection, point-in-time recovery, tags, and separate serving and temporary writer roles.
- [x] 9.4 Implement an idempotent resumable million-resource seed with bounded batches, multiple recorded bases, history-preserving schema, final indexing or publication wait, and digest verification.
- [ ] 9.5 Launch any required temporary EC2 transactor or seed machine without inbound SSH, with a scoped role, IMDSv2, expiry tags, watchdog, and exact instance identity.
- [ ] 9.6 Terminate the exact temporary instance in success and failure cleanup and verify that no instance, volume, or address remains.
- [x] 9.7 Configure the serving connection with datomic:ddb and read-only=true, capture d/db once during initialization, and serve that fixed value for the full Lambda environment lifetime.
- [x] 9.8 Route supported current or minimize requests directly through the captured database value without calling d/sync.
- [x] 9.9 Reject authoritative, at-least, exact, historical date, and other synchronization requests before generic EACL source traversal or cache work.
- [x] 9.10 Test that the public artifact contains no serving transactor dependency, cannot write, never invokes d/sync, and keeps one fixed current basis until environment replacement.
- [x] 9.11 Verify the serving role contains only documented Datomic read actions and denies writes, administration, and cross-profile table access.
- [ ] 9.12 Sweep non-SnapStart memory first and treat SnapStart as an optional optimization that cannot block deployment.
- [ ] 9.13 Publish immutable function, fixed-basis data, descriptor, and evidence identities and enable the profile only after staged qualification passes.
- [ ] 9.14 Prove with the temporary normal Peer that relevant attributes do not use :db/noHistory true and that recorded prior bases support expected d/as-of and history results.
- [x] 9.15 Document the future non-read-only Datomic EC2 demo as a separate out-of-scope serving deployment that may use the retained history rather than broadening this Lambda profile.

## 10. Datalevin memory profile

- [ ] 10.1 Verify the maintained fork release, explicit read-snapshot API, EACL adapter, clean remote-consumer install, and Linux arm64 native packaging.
- [ ] 10.2 Define and qualify the ephemeral Lambda source lifecycle and watermark across concurrent environments, rebuild, deployment, rollback, and lifecycle rotation.
- [ ] 10.3 Build the Java Lambda with true Datalevin memory mode and no remote, HA, WAL, EFS, or durable LMDB serving path.
- [ ] 10.4 Generate the deterministic 10,000-resource fixture at the qualified lifecycle point and freeze public data, schema, and relation writes after readiness.
- [ ] 10.5 Instrument snapshot ownership and exact-once release plus heap, direct, native, RSS, handle, and lifecycle state.
- [ ] 10.6 Qualify both the quiesced pre-checkpoint and after-restore rebuild strategies, including repeated restores, simultaneous environments, eviction, stale handles, cancellation, failures, and load.
- [ ] 10.7 Select a SnapStart lifecycle only from passing evidence and validate incompatibilities such as provisioned concurrency, EFS, container or OS-only runtimes, and ephemeral storage above supported limits.
- [ ] 10.8 Sweep memory and publish the smallest passing Java SnapStart configuration and immutable descriptor.

## 11. Jank Amazon Linux x86_64 profile

Parked by user direction: these tasks remain open and Jank remains registered
and unavailable, but none of them gates the active Datahike, Datomic,
Datalevin, DataScript, or static rollout. Re-entry requires an explicit unpark
decision as well as the existing qualification evidence.

- [x] 11.1 Pin a reproducible Linux x86_64 Amazon Linux 2023-compatible Jank builder, compiler/runtime revision, C++ toolchain, and native dependency policy.
- [ ] 11.2 Run the build in a pinned x86_64 AL2023-compatible environment on the upstream-tested x64 Linux runner, or on an exactly tracked temporary x86_64 AL2023 builder if needed, and reject Mach-O, arm64-only, or Homebrew-linked output.
- [ ] 11.3 Build the accepted Jank and EACL source closure as a native Linux x86_64 executable and package it as the root bootstrap of a ZIP custom runtime.
- [ ] 11.4 Target Lambda runtime provided.al2023 and architecture x86_64, with the minimal compatible shared-library, resource, and license closure.
- [ ] 11.5 Verify the artifact on a clean AL2023-compatible filesystem and bind builder, source, native closure, adapter, and artifact digests into its manifest.
- [x] 11.6 Implement the Runtime API and Function URL adapters with bounded input/output, deadlines, cancellation, and the common read-only dispatcher.
- [x] 11.7 Generate and verify the immutable 10,000-resource in-memory fixture and exclude LAN server, setup, mutation, raw benchmark, and debug routes.
- [x] 11.8 Label the in-memory Datomic-like conformance store accurately and deny Datomic Pro, durability, Datalog, distribution, and production claims.
- [x] 11.9 Explicitly disable SnapStart for Jank and reject configurations or documentation that claim SnapStart support.
- [ ] 11.10 Measure repeated native cold starts, warm requests, timeouts, errors, process memory, and workload headroom to select the smallest fitting Lambda memory.
- [ ] 11.11 Run the minimal production-transport semantic smoke without making formal verification a build or deployment prerequisite.
- [ ] 11.12 Publish an immutable custom-runtime function alias and descriptor and enable it only after Linux artifact and staged runtime qualification pass.
- [x] 11.13 Treat any future arm64 target as a separate migration that must qualify the Jank compiler, every native dependency, the AL2023 package, Lambda behavior, and price/performance before changing architecture.

## 12. AWS foundation, least privilege, and observability

- [ ] 12.1 Implement independently deployable foundation, static, per-profile runtime, per-profile data, seed compute, observability, and legacy compatibility stacks.
- [x] 12.2 Configure a private versioned static S3 bucket with public-access block, AWS-owned encryption, lifecycle policy, and CloudFront origin access control.
- [x] 12.3 Configure demo.eacl.dev CloudFront behaviors for main static assets, DataScript assets, and ordered non-cached profile API paths.
- [ ] 12.4 Configure IAM-protected Lambda Function URL origins and prove direct unauthenticated origin access fails.
- [x] 12.5 Add infrastructure checks for behavior order, normalized paths, methods, bodies, query and header forwarding, API cache disablement, HTTPS, and descriptor identity.
- [x] 12.6 Create per-profile least-privilege serving roles and separate stateful maintenance roles with automated wildcard and cross-profile denial checks.
- [x] 12.7 Use AWS-owned DynamoDB encryption and avoid customer-managed KMS keys unless a later explicit requirement justifies their cost.
- [x] 12.8 Define structured redacted logs, bounded retention, request/error/latency/cold/restore/throttle/OOM metrics, dashboards, and canonical synthetic checks.
- [x] 12.9 Require observability and health/bootstrap checks before any profile is publicly enabled.
- [ ] 12.10 Keep static foundation, each profile alias, each data generation, and legacy retirement independently deployable and reversible.

## 13. DynamoDB cost controls, Telegram, and stateful workflows

- [x] 13.1 Define conservative on-demand maximum read and write request-unit caps for each Datahike and Datomic table before table creation or seed.
- [x] 13.2 Create one-minute CloudWatch alarms for 70% and 90% cap utilization using correct per-second-limit versus per-period metric normalization, read or write throttles, and unexpected writes from serving paths.
- [x] 13.3 Create project seed and monthly budgets with 50%, 80%, and 100% notifications plus cost anomaly detection, while documenting their delayed nature.
- [x] 13.4 Generalize the existing SNS-to-Lambda Telegram notifier and reuse the existing retained AWS Secrets Manager bot token without copying it to GitHub.
- [x] 13.5 Store only the Telegram chat identifier and non-secret routing configuration where required and keep the bot token out of GitHub Actions.
- [ ] 13.6 Route alarm, budget, anomaly, applicable deployment-failure, and overdue temporary-compute notifications to Telegram.
- [x] 13.7 Send and verify a synthetic Telegram alarm before creating or seeding durable DynamoDB data.
- [x] 13.8 Implement explicit dispatch-only workflows for table creation, seed, verification, backup, data publication, and temporary compute.
- [ ] 13.9 Ensure ordinary demos-branch workflows cannot invoke stateful workflows and do not receive seed or maintenance roles.
- [x] 13.10 Encode the user's authorization for initial DynamoDB seeding and temporary seed, transactor, or Jank-build EC2, while retaining exact-target previews and noninteractive cleanup checks.
- [x] 13.11 Add expiry-tag enforcement and a watchdog that emits a critical Telegram notification and terminates overdue temporary seed, transactor, or build compute.
- [ ] 13.12 Verify after every temporary-compute run that applicable tables respect caps and alarms, temporary roles are no longer active, EC2 is terminated, and no orphan volume or address remains.
- [ ] 13.13 Transition from seed-phase write alarms and caps to immutable-serving write alarms and caps without suppressing unexpected writes after publication.

## 14. GitHub settings, OIDC, and maximum-parallel deployment

- [ ] 14.1 Reverify owner/repository IDs; make every OIDC job dependency-install-free with pinned actions, no persisted checkout credential, and signature-verified allowlisted non-secret claim capture that never retains a token; capture each distinct active eacl-demo workflow/environment; configure the immutable `[repo, ref, workflow_ref, environment, event_name, runner_environment]` subject template; and configure every active ordinary/manual role trust with exact custom subject plus AWS-supported direct audience, immutable repository, demos ref, workflow-name, and environment conditions; require `push` for ordinary deployment, `workflow_dispatch` for manual authorities, `github-hosted` execution, and `job_workflow_ref` only for an actual reusable workflow, migrate all trusts before the repository-wide template change, and remove exact legacy-subject alternatives after verification. Do not create an ordinary Jank authority while that profile is parked.
- [ ] 14.2 Configure separate eacl-demo static and active per-profile deployment environments with demos-branch restrictions, no manual reviewers or wait timer, read-only default token permissions, and job-scoped id-token write; create no ordinary Jank environment while it is parked.
- [ ] 14.3 Configure branch rules so a merge to theronic/eacl-demo:demos triggers deployment and required fast build/package checks cannot be bypassed accidentally.
- [ ] 14.4 Perform GitHub settings changes through the user's connected Chrome session and record a redacted settings audit.
- [ ] 14.5 Add no CI secrets speculatively; if a clean build of the pinned EACL revision proves a dependency credential is required, add only that scoped credential through Chrome.
- [ ] 14.6 Store immutable GitHub identity, AWS account, region, role identifiers, distribution IDs, and non-secret deployment coordinates as GitHub variables rather than secrets.
- [ ] 14.7 Assert GitHub contains no AWS access-key, Telegram bot-token, or cross-repository dispatch secret.
- [ ] 14.8 As soon as any active ordinary target is deployment-eligible, build one workflow triggered only by pushes to eacl-demo:demos that verifies the pinned EACL SHA is reachable and fans out explicit unprivileged build plus credentialed deploy pairs for every independently eligible target among static/DataScript, Datahike/S3, Datahike/DynamoDB, Datomic/DynamoDB, and Datalevin/memory. Ineligible active targets remain visible but unqueued and non-gating. Registered parked Jank/memory remains unavailable, unqueued, and non-gating until explicitly unparked.
- [ ] 14.9 Give each deploy job only a digest-verified same-target artifact dependency; add no sibling/global barrier, and for any matrix set fail-fast false and omit max-parallel; add no GitHub concurrency group, cancel-in-progress setting, latest-head guard, or cross-run ordering dependency.
- [ ] 14.10 Build and package without OIDC, upload a content-addressed artifact through pinned actions, download and verify it in a separate exact-environment OIDC job without installing/building, deploy a candidate, run only the minimal merge smoke, promote that run's healthy profile alias, and roll back only that profile on failure.
- [ ] 14.11 Allow mixed and out-of-order profile generations and publish the exact deployed demo SHA, locked EACL SHA, artifact identity, and last outcome without claiming latest-source convergence.
- [ ] 14.12 Prove one profile failure neither cancels nor rolls back successful sibling jobs.
- [ ] 14.13 Prove ordinary merge deployment cannot create tables, seed data, start EC2, migrate data, retire resources, or run the full qualification suites.

## 15. Initial deployment, independent updates, and rollback

- [x] 15.1 Reauthenticate the petrus-prod AWS profile and verify exact account and region before making AWS changes.
- [ ] 15.2 Deploy non-stateful foundation and observability first, then verify static delivery, origin restriction, security headers, route isolation, and synthetic checks.
- [ ] 15.3 Create cost controls and verify Telegram notification before provisioning or seeding Datahike or Datomic DynamoDB.
- [ ] 15.4 Execute the approved stateful workflows to create, seed, verify, back up, and publish immutable Datahike and Datomic data generations.
- [ ] 15.5 Qualify and deploy each profile independently; leave any failing profile disabled without blocking healthy profiles.
- [ ] 15.6 Publish the main explorer, DataScript entry, and current profile registry to staging and verify two-step selection, mixed-generation handling, and bundle isolation.
- [ ] 15.7 Rehearse static rollback, each enabled Lambda alias rollback, data-generation selection rollback, and DNS fallback without deleting state.
- [ ] 15.8 Assign existing infrastructure a tested fallback hostname and verify its certificate, routing, and health independently.
- [ ] 15.9 Obtain explicit approval immediately before changing the production demo.eacl.dev DNS alias.
- [ ] 15.10 Cut demo.eacl.dev over to the accepted CloudFront distribution and run immediate health, identity, allow, deny, mutation-denial, selector, and browser checks.
- [ ] 15.11 Restore the affected alias, registry entry, static manifest, or prior DNS target if its defined threshold fails; do not perform a fleet-wide rollback.
- [ ] 15.12 Merge subsequent approved changes to demos and verify each completed job reports the exact run's demo/EACL identities while any failed job visibly retains its prior healthy deployment.

## 16. Documentation, legacy compatibility, and completion audit

- [x] 16.1 Publish user documentation for the backend/storage selector, fastest evidence, unequal dataset scales, consistency and cache differences, current-only Datomic behavior, DataScript privacy, and Jank limitations.
- [x] 16.2 Publish operator runbooks for build, qualification, deployment, seed, Telegram tests, temporary EC2 cleanup, data publication, rollback, cost review, and incidents.
- [x] 16.3 Document the single GitHub demos-branch flow, pinned-source manifest, OIDC roles, variables, absence of long-lived AWS secrets, absence of GitHub concurrency management, and deliberately small merge gate.
- [ ] 16.4 Publish a release report listing enabled and disabled profiles, exact source and artifact identities, storage default evidence, fixture identities, memory settings, alarms, budgets, and rollback coordinates.
- [x] 16.5 Reconcile sibling OpenSpec changes and identify prerequisites, adopted evidence, superseded demo deployment, and still-independent work.
- [ ] 16.6 Observe production health, deployed source identities and outcomes, latency, errors, throttles, cost, Telegram delivery, and orphan-resource checks through the agreed window.
- [ ] 16.7 Resolve exact legacy resources and dependencies and produce a retirement impact, recovery, backup, and cost report.
- [ ] 16.8 Obtain separate explicit approval for each material legacy stop, delete, or overwrite batch; DNS cutover approval does not authorize retirement.
- [ ] 16.9 Perform only approved retirement actions, prefer reversible phases, and record what changed and how long recovery remains possible.
- [ ] 16.10 Close the change only after `npm run verify:change-readiness` has no remaining gates, strict OpenSpec validation, deployed behavior, demos-branch CI execution, stateful cleanup, cost controls, Telegram notifications, documentation, and evidence are complete.
