# Operator runbook

This runbook is the control surface for builds, qualification, deployment,
stateful data, cost review, rollback, and incidents. Commands that contact AWS
or GitHub are operator actions: do not run them merely to validate source.
Always resolve the exact account, Region, commit, stack, table, function,
instance, and data generation before changing external state.

Before treating the change as release-ready, run
`npm run verify:change-readiness`. The fail-closed ledger is documented in
`docs/completion-readiness.md`; it must cover every unchecked OpenSpec task
exactly once and must have no remaining gate before task 16.10 can close.

## Universal preflight

1. Work from a clean `theronic/eacl-demo` commit, not a branch name or dirty
   worktree. Record `git rev-parse HEAD` as `demo-sha`.
2. Read `dependencies/eacl-core.lock.json`; verify its exact Core commit is
   reachable and use that value as `eacl-sha`. Never substitute Core `HEAD`.
3. Confirm the intended AWS account and Region independently before assuming a
   role. Stop on any mismatch.
4. Read the target profile registry state. `unavailable`, `qualifying`, and
   `disabled` are not deployment authorization.
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
audit is not a deployable runtime artifact. Never change a profile from
unavailable to enabled without the profile's remaining artifact and
qualification gates.

Clojure source tests use the persistent nREPL procedure in
`docs/clojure-nrepl-workflow.md`, including `:reload` after source edits.

## Qualification

Full qualification is manual and independent of ordinary merge deployment.

- `.github/workflows/qualify-explorer.yml` runs the principal browser and
  accessibility suite against a local build or the trusted staged CloudFront
  origin, then exercises the direct DataScript runtime and proves the main entry makes
  no DataScript network request.
- `.github/workflows/qualify-profile.yml` runs the full HTTP profile suite only
  when supplied the exact profile, source pair, artifact, deployment, data
  manifest, and staged CloudFront route.
  The route origin must equal the trusted `STAGED_CLOUDFRONT_ORIGIN` GitHub
  variable; a dispatch input cannot designate itself as staging.
- `.github/workflows/exercise-profile-runtime.yml` runs one explicitly confirmed
  `load`, `memory`, or `fault` campaign. Load is capped at 500 requests and eight
  workers, defaults to 100 requests at concurrency two, and accepts zero
  request failures. It stops scheduling new requests after the first failure;
  at most the selected concurrency can remain in flight. Fault uses only the
  six closed protocol/cancellation probes, starts the cancellation request
  before aborting it, applies a ten-second per-request deadline, and proves
  health/bootstrap recovery.
  Memory invokes only an exact immutable numeric Lambda version, verifies its
  code digest, and derives headroom from each invocation's bounded Lambda
  `REPORT` tail. Its evidence target is the direct Lambda version ARN rather
  than a staged-CloudFront target; the runtime and architecture must match the
  closed profile platform. It stops after the first failed sample and does not
  enable provisioned concurrency.
- `.github/workflows/exercise-profile-transition.yml` rehearses `migration` or
  `rollback` only on the dedicated `exercise` Lambda alias. It verifies the
  starting identity through staged CloudFront, moves the alias with its exact
  revision precondition, requires a higher numeric target for migration or a
  lower numeric target for rollback, runs the five-case smoke against the target identity,
  and restores only the observed alias revision in `always()` cleanup before
  rechecking the original identity. It can never name the `live` alias.
- `.github/workflows/stateful-datahike-dynamodb.yml`,
  `.github/workflows/stateful-datomic-dynamodb.yml`, and
  `.github/workflows/stateful-datomic-seed.yml` retain separately confirmed
  generation, publication, seed, and cleanup paths. Their existence is not
  seed authorization and does not mean an open profile-specific seed task has
  passed.
- Jank's repetitions, latency limits, memory headroom, and cleanup controls are
  closed in `verification/jank-memory/qualification.v1.json`.
- Load, memory, fault, migration, initial topology, and rollback exercises must
  remain manual dispatches. Their evidence is not a `demos` merge gate.

Store reports under `verification/results/` or the profile's evidence
directory. Evidence must distinguish not-run, unsupported, failed, and passed;
it must bind immutable source, artifact, runtime, and data identities.

## Ordinary deployment

The only automatic deployment trigger is a push to
`theronic/eacl-demo:refs/heads/demos`. It must check out the triggering commit,
resolve Core solely from the committed lock, and fan out static plus one job per
server profile. Jobs may finish out of order and one failure must not stop a
sibling. See `docs/demos-branch-delivery.md` for the closed CI contract.

Each profile uses an unprivileged build job and a separate deploy job. The
build uploads a content-addressed artifact without OIDC; only its matching
deploy job may download and digest-check it, request OIDC, deploy an immutable
candidate, run the bounded health/bootstrap/identity/allow/deny/mutation-denial
smoke, and promote that profile's coherent alias/descriptor. The credentialed
job must not install dependencies or rebuild. On failure it retains or restores
that profile's prior alias. It must not create data, seed, migrate, start EC2,
run load or memory sweeps, or retire anything.

The merge-smoke report must name `staged-cloudfront`, the exact candidate
staging origin and canonical profile path, the candidate's
demo/Core/artifact/deployment/data identity, start/completion timestamps, and
the content-addressed five-case result. A local, direct-origin, production-live,
stale, tampered, partial, or identity-drifted pre-promotion report cannot
authorize promotion. After moving only that profile's live alias, recheck
health/bootstrap through the production CloudFront path and require the same
identity before publishing status. If that recheck fails, restore only the
recorded prior alias revision.

Promotion and publication are two ordered per-profile phases. Before moving the
alias, record its exact version and `RevisionId`, then prepare the alias-only
plan with `npm run prepare:alias-promotion -- <request.json>`. That plan accepts
only a sealed candidate staging smoke, uses the recorded alias revision as an
optimistic precondition, and names the prior version as rollback. Capture the
new `RevisionId` returned by promotion.

After the production health/bootstrap recheck passes, generate the gated
`eacl-demo.profile-publication.v1` record. Record the current versioned S3
status object's ETag, version ID, and publication ID, then prepare the
status-only plan with
`npm run prepare:profile-publication -- <request.json>`. Its `activeAlias` must
be the candidate version with the captured post-promotion revision; its
`rollbackAlias` is the pre-promotion record. The plan may write only
`registry/profiles/<same-profile>.json` and carries executable rollback
coordinates for both services. Use S3 `If-Match`/`If-None-Match`; never restore
an alias that no longer has the candidate version or overwrite a status object
whose condition changed. The status object is JSON with `Cache-Control:
no-cache, max-age=0, must-revalidate` and `Content-Type: application/json`.

Lambda alias and S3 status updates are not one atomic transaction. After both
writes, re-read the alias/status and run the production descriptor handshake.
During or after a partial update, source/artifact/data mismatch must leave the
profile unavailable; do not weaken the identity check to make it selectable.
If reconciliation cannot restore a coherent pair using the recorded exact
coordinates, stop that profile and alert rather than touching siblings.

At present, do not operate an automatic deployment workflow until its AWS OIDC
trusts, GitHub environments and variables, per-profile stacks, candidate
promotion, and rollback paths have all passed their still-open OpenSpec tasks.
This statement prevents a workflow scaffold from being mistaken for production
readiness.

## Release report gate

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

Before enabling repository-wide OIDC subject customization, follow
`infra/deployment/README.md`. Verify the checked-in policy bundle, update every
AWS trust before changing GitHub's template, capture only allowlisted decoded
claims without printing or retaining a token, verify all published manual jobs,
and remove the temporary exact default-subject alternatives. Never customize
the subject for only the future deployment roles: the same change affects the
existing stateful and qualification jobs.

For each manual run, download its one-day
`oidc-claims-<authority>-<run>-<attempt>` artifact and require
`signatureVerified: true`, the exact authority ID, the expected claim allowlist,
and the migration phase's expected subject mode. Do not proceed if the capture
step fails. Treat any `npm install`, `npm ci`, `npm run`, package-manager cache,
non-pinned action, or persisted checkout credential in an `id-token: write` job
as a credential-exposure regression, even when it appears before
`configure-aws-credentials`.

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
