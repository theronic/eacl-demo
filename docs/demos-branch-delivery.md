# `demos` branch delivery contract

`theronic/eacl-demo` is the sole deployment authority. A push to the exact
`refs/heads/demos` ref queues every independently eligible active target using
the triggering `demo-sha` and the `eacl-sha` in that commit's
`dependencies/eacl-core.lock.json`. Activity in `theronic/eacl` does not deploy
the demos and no cross-repository dispatch credential exists.

## Parallel and independent jobs

The deployment workflow has an explicit build/deploy pair for static and for
Datahike/S3, Datahike/DynamoDB, Datomic/DynamoDB, and Datalevin/memory. Jank is
registered but parked, so it is neither queued nor a prerequisite. All active
build jobs start independently and have no OIDC permission.
Each deploy job depends only on its matching content-addressed artifact,
verifies its digest, and starts as soon as that build finishes. Any matrix sets
`fail-fast: false` and omits `max-parallel`.
There is no workflow or job `concurrency` key, `cancel-in-progress`, latest-head
guard, cross-run ordering test, or all-profile success barrier.

The static build produces the main and DataScript entries in one artifact so
they cannot race on the static prefix. Its deploy job does not overwrite server
status keys. Each profile deploy job owns only its content-addressed artifact,
existing function's `$LATEST` staging state, immutable version,
candidate/live aliases, one exact
`registry/profiles/<profile-id>.json` object, descriptor outcome, and rollback.
A failing job leaves its previous healthy alias in place while siblings
continue. Mixed and out-of-order deployed generations are expected; each
content-addressed status and descriptor reports what actually won, never a
latest-source or convergence claim. No job rewrites a shared aggregate
registry.

Static publication uploads only the files enumerated by the assembled static
site manifest. It never uses a bucket-wide `s3 sync`, `--delete`, or a role
capable of deleting/overwriting server-owned `registry/profiles/*` keys.
Content-addressed static assets are append-only within their retention window:
the uploader must not remove a DataScript worker or entry asset while any live
or rollback-eligible profile publication or HTML version can still reference
that digest. Revalidation documents may be replaced; immutable digest paths
are retained and lifecycle-expired only by a separate evidence-based policy.

## Small merge path

Each automatic target pair is limited to:

1. an unprivileged exact triggering-commit checkout, locked-Core reachability
   verification, dependency restoration, build/package, and cheap guards;
2. content-addressed artifact upload through a commit-pinned action;
3. a separate exact-environment deploy job that downloads and verifies the
   digest without installing dependencies or rebuilding, then requests OIDC;
4. immutable candidate upload/version publication;
5. bounded candidate staging-CloudFront health, bootstrap identity, one allowed
   example, one denied example, and one mutation-denial check;
6. per-profile live-alias promotion plus a bounded production
   health/bootstrap identity recheck; and
7. conditional publication, or restoration using the exact prior alias
   revision and versioned status-object coordinates.

Alias promotion and status publication use separate plans because the sealed
production recheck does not exist until after the alias move. The first plan is
alias-only and is gated by candidate staging smoke. The second is status-only,
requires the captured post-promotion alias revision plus the later production
recheck, and retains the original alias/status coordinates for exact rollback.
Ordinary server publication requires an existing versioned status object; the
initial status belongs to the separate qualification/enablement lifecycle. This
keeps delete-based first-publication rollback and `s3:DeleteObjectVersion` out
of every ordinary deployment role.

The one `build-<target>` to `deploy-<target>` edge is only an artifact handoff;
there is no sibling or global success barrier. Formal verification, full conformance, browser/accessibility qualification,
load, memory sweeps, fault injection, initial topology qualification, table or
bucket creation, seeding, migration, temporary compute, backups, DNS changes,
and retirement are absent from this path. They remain explicitly dispatched
workflows with their own authorization and evidence. Full profile and explorer
qualification use `qualify-profile.yml` and `qualify-explorer.yml`; bounded
load/memory/fault work uses `exercise-profile-runtime.yml`; migration/rollback
rehearsal uses only the dedicated, always-restored `exercise` alias through
`exercise-profile-transition.yml`; stateful generation/seed workflows remain
separate. None is called or awaited by ordinary deployment.

## GitHub and AWS authority

Repository Actions permissions default to read-only. Only a deployment job may
request `contents: read` and `id-token: write`. Static and each profile use a
separate GitHub environment restricted to `demos`, without reviewer or wait
timer, and a separate least-privilege AWS role.

The repository-wide OIDC subject template is exactly
`[repo, ref, workflow_ref, environment, event_name, runner_environment]` with immutable subjects enabled. Each
trust uses `StringEquals` for `aud=sts.amazonaws.com`, the custom non-wildcard
subject, repository name and immutable IDs, `refs/heads/demos`, workflow name,
and environment. AWS does not expose `workflow_ref` directly, so its exact
path-and-ref value is carried inside `sub`. The subject also requires `push`
and `github-hosted` for ordinary deployment, while published manual authorities
require `workflow_dispatch`. `job_workflow_ref` is not required for these
top-level jobs; it applies only if a job actually uses a reusable workflow. The
closed authority manifest and generated policies are under
`infra/deployment/`.

The same job-scoped rule applies to published manual qualification, transition,
and stateful authorities. Because GitHub exposes the OIDC request bearer to the
entire `id-token: write` job, none of those jobs installs dependencies, enables
a package-manager cache, or uses a package-manager script. They use only
commit-pinned actions and directly invoked dependency-free checked-in
entrypoints, disable checkout credential persistence, and capture a
signature-verified closed claim allowlist before AWS configuration. The JWT and
OIDC request bearer are never retained; only the one-day allowlist artifact is.

Subject customization affects every OIDC job in the repository. Update all
ordinary, qualification, transition, and stateful AWS trusts first, change the
GitHub template second, verify every job, then remove any temporary exact
default-subject alternative. A role for one profile cannot administer another
profile or durable dataset. Ordinary role variables and permission scopes are
disjoint from every stateful maintenance or seed role.

GitHub contains no AWS access keys, Telegram bot token, or cross-repository
dispatch secret. Account, Region, role ARNs, distribution coordinates, and
other non-secret immutable identifiers are GitHub environment variables. A
trusted `STAGED_CLOUDFRONT_ORIGIN` variable is mandatory for qualification,
manual exercises, and candidate smoke; user-entered URLs cannot self-assert
that they are the staged distribution. Production recheck likewise binds its
URL to the configured production origin. A
dependency credential is added through the requested Chrome session only if a
clean pinned build proves it is necessary and its least privilege is known.

## Branch and environment settings

The `demos` branch rejects force-push and deletion and requires pull-request
merge, with no approval count, formal check, deployment reviewer, or wait timer.
The required fast checks cover only build/package and safety guards. GitHub
settings changes and their redacted audit are performed through the user's
authenticated Chrome session; repository files alone cannot prove settings.

## Current readiness

This document defines the required flow but does not claim it is already live.
The automatic workflow, OIDC trusts, environments/variables, branch settings,
per-profile deployment stacks, smoke/promotion paths, and live execution remain
open until their individual OpenSpec tasks have direct evidence. No placeholder
workflow should be enabled with broad credentials to bypass those gates.

`scripts/render-demos-workflow.mjs` deterministically derives the exact target
set from the closed build registry. In the committed zero-eligibility state its
check mode requires `.github/workflows/deploy-demos.yml` to be absent and write
mode refuses to create it. If eligibility is changed prematurely, the renderer
also refuses a target without a deployable build or the checked-in ordinary
deployment entrypoint. The dependency-free entrypoint implements static plus
the Datahike/S3, Datahike/DynamoDB, and Datomic/DynamoDB server transactions.
The server path requires an already-enabled, versioned, status-published
profile; uploads one content-addressed JAR; updates `$LATEST` under a Lambda
revision precondition; publishes a numeric version; moves candidate and live
aliases under their exact revision preconditions; runs staged and production
CloudFront smoke; and writes the per-profile status last under the prior S3
ETag. Failure restores only the exact revisions created by that run, refuses to
overwrite a newer concurrent run, and reports a failed attempt only after the
healthy aliases are restored. Datalevin/memory remains explicitly
unimplemented because it has no qualified deployable JAR. All targets remain
deployment-ineligible, so no automatic workflow is emitted yet.

The static transaction proves the exact account, private versioned SSE-S3
bucket, ownership controls, identity tags, distribution alias/domain, and
private OAC origin before writing. It admits only content-addressed immutable
assets plus the two versioned entry documents and manifest, verifies every byte
and cache/content-type header through the trusted CloudFront origin, publishes
the versioned status object last, and restores exact prior object versions after
failed or ambiguous writes. It never syncs, deletes, uses KMS, or removes an
immutable asset. Ordinary static publication deliberately requires prior
versions of every replaceable object and status, so this executor cannot be
misused as the initial foundation publication or as a substitute for the
initial staged qualification/cutover tasks.

`infra/deployment/server-profile-deploy-role.yaml` is inactive by default and
materializes one exact profile role only after enablement is separately
authorized. It can read the two delivery distributions, update only one
function/version/alias family, append under one profile artifact prefix, and
conditionally replace one profile status key. It has no table, EC2, seed,
migration, delete, KMS, CloudFront mutation, or cross-profile permission.

The build/deploy handoff is implemented separately as a closed
content-addressed artifact manifest. It binds the exact checked-out demo commit
and its committed EACL lock, rejects tracked checkout drift, symlinks,
undeclared files, tampering, oversized payloads, and cross-target identity
reuse. The future deploy job verifies that manifest before requesting AWS
credentials. Its public structural contract is
`schemas/ordinary-artifact.v1.schema.json`; the credentialed verifier also
recomputes every file digest and the canonical aggregate digest rather than
trusting schema validation alone. A repository policy test requires the push workflow to remain
absent until at least one active ordinary deployment target is eligible; after
that it requires exactly one workflow containing every eligible target and no
ineligible or parked target. Eligibility is target-local, so blocked Datalevin
cannot hold back qualified static/DataScript, Datahike, or Datomic targets. A
`parked` unit remains visible and fail-closed but cannot block or enter that
fan-out. Jank is currently parked. Infrastructure remains a separate
initial/manual lifecycle, not an ordinary merge target. This makes the current
absence an enforced readiness state rather than a vacuous scan of zero
workflows.
