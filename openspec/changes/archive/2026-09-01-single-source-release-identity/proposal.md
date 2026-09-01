# Single-source release identity, registry removal, production-branch deploys

## Why

Three coupled simplifications requested 2026-09-01, after the EACL 9e0105f2 bump
shipped green (PR #68, merge 32cadc22, deploy run 33552891362: all five jobs
`success`, live demos verified serving 9e0105f2):

1. `dependencies/eacl-core.lock.json` duplicates `deps.edn`. Two sources of
   truth for the Core SHA is one too many: every consumer can derive the SHA
   from `deps.edn` (at CI build time, from the committed file at the triggering
   commit).
2. `registry/*` (checked-in profile registry, release report, data manifests,
   benchmark-evidence README) carries no value: the checked-in
   `profile-registry.v1.json` says `"never-deployed"` for every profile while
   all five deploy on every push. Structural profile facts already live in
   `packages/contracts/profiles.v1.json`. Scripts should use `$GIT_SHA`
   (`EACL_DEMO_SHA = github.sha`) at build time.
3. Branch model: `main` should be a normal dev branch (push freely, nothing
   deploys); a new `production` branch becomes the sole deploy trigger. The
   legacy `demos` branch (unwired, unprotected — verified) is deleted. There
   are no branch protections to remove (`main` protection endpoint 404s,
   `demos` reports `protected:false`).

Evidence against the "must merge to `demos` to deploy" hypothesis: the
2026-09-01 deploy fired from a push to `main`; no workflow references `demos`.

## What Changes

- Delete `dependencies/eacl-core.lock.json`; add `scripts/lib/eacl-core.mjs`
  deriving the canonical Core identity (url/sha/modules) from `deps.edn`;
  rewire every lock consumer to it.
- Delete `registry/` entirely plus its builder/report scripts and tests;
  the deployer sources structural profile facts from
  `packages/contracts/profiles.v1.json` (extended with `route`). The **live**
  S3 keys `registry/profiles/<id>.json` and `schemas/` are a site contract and
  stay unchanged.
- Retarget `.github/workflows/deploy-demos.yml` trigger `main` → `production`;
  update deployment identities (`main:` channel literal → `production:`),
  OIDC trust templates/policies/tests, and docs. Then (operator step, needs
  AWS auth): update the live IAM role trust stacks, push `production` at the
  validated `main` head, watch the deploy green, delete `demos`.

## Impact

- Affected: release-identity scripts (`scripts/lib/*`, `upgrade-eacl`,
  `deploy-live-demo`, deployment-manifest, jank audits), `registry/`,
  package.json script entries, deploy workflow, OIDC infra templates + policy
  tests, docs (DEPLOY.md, operator-runbook, demo-delivery, dependency-locks,
  release-identity).
- Not affected: live site contract (S3 `registry/profiles/*`, published
  schemas), Lambda/alias mechanics, stateful workflows' confirmation-token
  model, `packages/contracts` schema ids.
- Risk concentrated in one place: the first `production` push exercises the
  reworked deployer end-to-end; it MUST be preceded by the live IAM trust
  update or every job fails at AssumeRole (trust subs pin
  `refs/heads/main`).
