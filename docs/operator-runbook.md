# Operator runbook

This runbook is the control surface for builds, deployment, stateful data,
cost review, rollback, and incidents. Commands that contact AWS
or GitHub are operator actions: do not run them merely to validate source.
Always resolve the exact account, Region, commit, stack, table, function,
instance, and data generation before changing external state.

## Universal preflight

1. Work from a clean `theronic/eacl-demo` commit, not a branch name or dirty
   worktree. Record `git rev-parse HEAD` as `demo-sha`.
2. Read `dependencies/eacl-core.lock.json`; verify its exact Core commit is
   reachable and use that value as `eacl-sha`. Never substitute Core `HEAD`.
3. Confirm the intended AWS account and Region independently before assuming a
   role. Stop on any mismatch.
4. Read the target profile registry state before changing infrastructure or
   stateful data. Ordinary deployment updates all five live targets.
5. For stateful or temporary-compute work, use only the separately dispatched
   workflow and exact reviewed confirmation token. A `demos` push is never a
   seed, migration, table-creation, or EC2 authorization.
6. Announce any deliberate alarm transition in advance. Do not create load to
   test Telegram: use one nonce-bearing synthetic notification.

## Build and local verification

Install the pinned Node/npm, Java, and Clojure toolchains described by
`toolchain.json`, `.node-version`, `.java-version`, and `deps.edn`, then run:

```sh
npm ci
npm run verify:locks
npm run verify:secrets
npm run test:contracts
npm run test:explorer-state
npm run test:ui
npm run test:fixtures
npm run verify:fixture-golden
npm run verify:determinism
```

Run profile-specific source and packaging guards for any affected profile.
Examples include `verify:datahike-dynamodb-serving`,
`verify:datahike-dynamodb-lambda-artifact`,
`verify:datomic-lambda-artifact`, `verify:jank-source`, and
`test:jank-runtime-api`. A foundation-only build or passing source/package
audit is not a deployable runtime artifact.

Clojure source tests use the persistent nREPL procedure in
`docs/clojure-nrepl-workflow.md`, including `:reload` after source edits.

## Optional deep testing

Run the browser suites against a local static build or `demo.eacl.dev` and
record every API request. Server requests must use the exact selected
`*.lambda-url.us-east-1.on.aws` origin; a request to
`demo.eacl.dev/api/v1/*` is a failure. Verify exact-origin CORS, the
health/bootstrap identity handshake, allow, deny, mutation-route rejection,
and DataScript's zero-Worker page-local execution.

Profile load, memory, fault, migration, initial-topology, and rollback exercises
remain available as local tools when useful. They are not `demos` deployment
gates. Stateful generation, seed, publication, and temporary-compute workflows
remain separately confirmed; their existence is not authorization to run them.

Store reports under `verification/results/` or the profile's evidence
directory. Evidence must distinguish not-run, unsupported, failed, and passed;
it must bind immutable source, artifact, runtime, and data identities.

## Ordinary deployment

The only automatic deployment trigger is a push to
`theronic/eacl-demo:refs/heads/demos`. It must check out the triggering commit,
resolve Core solely from the committed lock, and fan out static plus one job per
server profile. Jobs may finish out of order and one failure must not stop a
sibling. See `docs/demos-branch-delivery.md` for the closed CI contract.

The workflow contains five independent jobs: static plus DataScript,
Datahike/S3, Datahike/DynamoDB, Datomic/DynamoDB, and Datalevin/memory. Each server job builds one
content-addressed artifact, publishes one immutable Lambda version, moves only
its `candidate` alias, runs the bounded direct-invoke smoke, and publishes only
its registry document. A sibling failure does not block or roll back it.

After merge, confirm the registry identity and direct Function URL health for
each completed job. Then use a real browser network trace to prove the explorer
uses the same direct origin. CloudFront must receive no `/api/v1/*` request.

The merge path must not create data, seed, migrate, start EC2, run load or
memory sweeps, modify cost controls, send Telegram tests, or retire anything.
See `docs/demos-branch-delivery.md` for the complete current contract.

## Release report

Run `npm run build:release-report` after changing the profile registry, build
eligibility, fixture manifests, EACL lock, benchmark evidence, runtime
memory/platform templates, profile alarm template, DynamoDB cap policy,
budgets, anomaly threshold, or Telegram routing. Commit both
`registry/release-report.v1.json` and `docs/release-report.md`, then run
`npm run verify:release-report` from a clean checkout.

The checked-in report is currently `pre-release`. It must keep the demo SHA,
release identity, artifact identities, qualified memory evidence, live control
evidence, and rollback coordinates absent until the exact corresponding
deployment evidence exists. A template digest proves only what is defined in
source. It does not prove that an AWS resource exists, an alarm is `OK`, a
budget is active, Telegram delivery succeeded, or rollback was rehearsed.
Do not mark OpenSpec task 16.4 complete for the pre-release report.

Before changing repository-wide OIDC subject customization, follow
`infra/deployment/README.md`. Verify the checked-in policy bundle, update every
AWS trust before changing GitHub's template, capture only allowlisted decoded
claims without printing or retaining a token, verify all published manual jobs,
and remove the temporary exact default-subject alternatives. Never customize
the subject for only the future deployment roles: the same change affects the
existing stateful jobs.

For each stateful run, download its one-day
`oidc-claims-<authority>-<run>-<attempt>` artifact and require
`signatureVerified: true`, the exact authority ID, the expected claim allowlist,
and the expected subject mode. Do not proceed if the capture step fails.
Stateful jobs keep dependency installation and package scripts outside their
credential-bearing steps. Ordinary demo jobs intentionally build before AWS
credential configuration in the same direct deployment job. All actions remain
commit-pinned and checkout credentials remain disabled.

## Telegram notification gate

Build the notifier with `npm run build:observability-notifier` and deploy only
the immutable versioned artifact through the observability stack. The bot token
stays in its existing Secrets Manager secret; GitHub never receives it. The
chat ID is non-secret routing configuration.

Immediately before an approved durable table create or seed:

1. announce the single synthetic test;
2. generate a fresh nonce;
3. publish one message to the canonical alarm topic containing account,
   Region, stack identity, and nonce;
4. confirm that exact nonce arrived in Telegram; and
5. record the notification/message identity in the stateful preview evidence.

Do not force CloudWatch alarms into `ALARM` for this gate. If a synthetic fails,
stop before provisioning. If notifications storm, stop the deliberate load,
preserve the alarm definitions, inspect the SNS/Lambda delivery metrics, and
silence only the identified test source rather than deleting cost controls.
Managed alarms do not have `OKActions`: genuine recoveries are routed only when
the central EventBridge rule observes an `ALARM`→`OK` transition. Treat a
bootstrap `INSUFFICIENT_DATA`→`OK` Telegram message as configuration drift.
Before a stateful operation, also require the notifier failure queue to be
empty and its alarm to be `OK`; inspect/redact retained payloads before any
manual replay. There is no automatic queue consumer.

The stateful roles need read-only `ce:ListCostAllocationTags`. Every stateful
workflow fails closed unless both user-defined keys `Project` and `Workload`
are reported `Active`; an inactive tag would make the project budget/anomaly
scope incomplete and is not a reason to fall back to an account-wide Telegram
budget.

## DynamoDB generation and publication

Use only the manual, `demos`-ref-restricted workflow for the exact backend:

- `.github/workflows/stateful-datahike-dynamodb.yml`
- `.github/workflows/stateful-datomic-dynamodb.yml`

Run preview first. Creation requires the exact table/generation confirmation
token and must install its quiet seed-phase alarm stack before the table. The
table must report on-demand billing, reviewed maximum request-unit values,
deletion protection, PITR, expected key schema and tags, and no customer-managed
KMS key.

Seed through its separate explicit workflow. Verify fixture and semantic
digests, exact counts/exemplars, backup/recovery identity, and a quiet writer
window. Publication first enters the alarm-only transition phase and verifies
the zero-write alarm is `OK`; it then removes temporary writer access, applies
the immutable serving write cap, installs serving cap-drift alarms immediately,
verifies serving write denial, and publishes an immutable data identity. Never
mutate an accepted generation; create a new blue/green generation.

## Temporary Datomic compute and cleanup

`.github/workflows/stateful-datomic-seed.yml` separates preview from execution.
Execution is bound to the exact authorized preview, private subnet, no inbound
security-group rules, no public address, scoped instance profile, IMDSv2, exact
immutable input object versions, encrypted delete-on-termination volume, and
expiry/watchdog tags.

Its `always()` cleanup must resolve the exact instance from the recorded ID or
authorization ID, terminate it, wait for termination, delete the exact temporary
role stack, and verify that no matching instance, non-deleted volume, elastic
address, role, or instance profile remains. It must also re-read table caps,
alarms, and phase. Treat any failed cleanup assertion as an incident; never use
a broad recursive or wildcard deletion as a shortcut.
The watchdog schedule and exhausted asynchronous invocations have a separate
14-day failure queue with a one-minute depth alarm. Require that queue to be
empty before launching temporary compute. A non-empty queue is a cleanup-path
incident: inspect the retained event, verify the exact instance inventory, and
do not attach an automatic replay consumer.

## Rollback

Rollback is per unit, never fleet-wide:

- Static: republish the prior immutable static manifest to the existing private
  bucket/distribution; do not modify profile aliases or data.
- Runtime: move only the affected profile alias back to its prior healthy
  immutable version using the recorded revision precondition and restore only
  its exact versioned status object. If either precondition has changed, stop
  and reconcile the current identity instead of overwriting a newer run.
- Data: select the prior retained blue/green generation together with the
  runtime/descriptor that names it. Do not roll back by editing or deleting a
  generation.
- DNS: restore the previously tested target only after the separate cutover
  approval and threshold procedure. DNS approval does not authorize retirement.

After rollback, run the same bounded health, identity, allowed, denied, and
mutation-denial checks and record the exact winning identities.

## Profile incidents

For a duration, error, health, initialization, OOM, throttle, or timeout alarm,
first bind the alarm dimensions to the exact `ProfileId` and `FunctionName`.
Inspect only the structured `eacl-demo.runtime-telemetry.v1` fields: deployment
ID, request ID, operation, outcome, closed error code, duration, and closed
metrics. Do not paste raw events, environment variables, storage URIs, response
data, exception messages, or credentials into an incident record.

Compare the descriptor/deployment identity with the currently published alias
and status object. For storage or throttle signals, inspect the exact generation
or bucket named by deployment metadata and the independent native storage
alarms; do not infer a missing record from a dependency failure. For an OOM or
initialization failure, leave the candidate disabled and resume the qualified
memory sweep rather than increasing production memory without evidence. A
failing staged health/bootstrap/exemplar synthetic blocks enablement. Roll back
only the affected profile alias/status pair using its recorded revision and
conditional-write coordinates.

## Cost review and incidents

Review current DynamoDB maximum-throughput settings, consumed capacity,
throttles, Lambda errors/duration/concurrency, log retention, budgets, anomaly
subscriptions, EC2/volume/address inventory, and the canonical SNS/notifier
delivery metrics. Maximum on-demand throughput, budgets, and alarms are
detection layers, not hard spending guarantees; the interpretation is recorded
in `docs/aws-cost-safety.md`.

For an alarm or unexpected charge:

1. acknowledge the exact notification and stop any known qualification load;
2. resolve account, Region, resource, metric, alarm threshold, and recent
   workflow run without exposing credentials;
3. disable promotion or the narrow offending workload, not unrelated profiles;
4. terminate overdue temporary compute through the exact-ID cleanup path;
5. retain logs/evidence and verify cost controls still exist; and
6. record cause, impact, external changes, recovery coordinates, and follow-up.

Alarm names beginning `demo-eacl-datahike-` belong to the legacy notification
path captured in
`docs/provenance/legacy-telegram-noise-audit-2026-08-26.md`. Ten captured legacy
alarms had direct `OKActions`; do not misattribute those messages to the
undeployed consolidated stack. During a notification storm, do not force alarm
states or send a synthetic test. Refresh the live definition first and, when
authorized, remove only the identified legacy `OKActions` while preserving its
`AlarmActions` and current service. A permanent legacy stop remains a separate
decision.

Material legacy deletion, table deletion, backup deletion, or permanent service
stop requires a separate exact-target report and new explicit approval.
