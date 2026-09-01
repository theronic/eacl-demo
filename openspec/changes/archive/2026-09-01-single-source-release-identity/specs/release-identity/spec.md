# Release identity delta

## ADDED Requirements

### Requirement: deps.edn is the sole EACL Core version pin

The repository SHALL carry exactly one source of truth for the pinned EACL
Core commit: the `dev.eacl/eacl*` coordinates in `deps.edn`. Every tool that
needs the Core SHA SHALL derive it from `deps.edn` (for deploys, from the
committed `deps.edn` at the triggering commit), and the derivation SHALL fail
when the pins disagree with each other or with the canonical repository URL.

#### Scenario: Deploy derives the Core SHA from the committed deps.edn

- **WHEN** a deploy job builds triggering commit `$GIT_SHA`
- **THEN** the Core SHA used for build, manifest, and published registry
  documents is parsed from `git show $GIT_SHA:deps.edn`, and no separate lock
  file exists in the repository

#### Scenario: Divergent pins fail fast

- **WHEN** any `dev.eacl/eacl*` coordinate carries a different `:git/sha` or a
  non-canonical `:git/url`
- **THEN** derivation throws, naming the offending alias, before any build or
  deploy step proceeds

### Requirement: No checked-in deployment registry

The repository SHALL NOT check in deployment-outcome documents (profile
registry, release report, data manifests). Deployment identity SHALL be
computed at build time from the triggering commit, and live profile documents
under the site's `registry/profiles/` keys remain the only registry — written
by deploy jobs, never committed.

#### Scenario: Published profile documents are built from contracts + build identity

- **WHEN** a deploy job publishes a profile document
- **THEN** its structural facts come from `packages/contracts/profiles.v1.json`
  and its deployment facts from the build (`$GIT_SHA`, derived Core SHA,
  artifact identity), with no checked-in registry file as input

### Requirement: production is the sole deploy branch

Pushes to `refs/heads/production` SHALL be the only automatic deployment
trigger; `main` SHALL be an ordinary development branch whose pushes deploy
nothing. OIDC deployment role trust SHALL pin `refs/heads/production`.

#### Scenario: main push deploys nothing

- **WHEN** a commit is pushed or merged to `main`
- **THEN** no deployment workflow runs

#### Scenario: production push deploys all five profiles

- **WHEN** `production` is fast-forwarded to a validated `main` commit
- **THEN** the five independent build-and-deploy jobs run for exactly that
  commit and its deployment identities carry the `production:` channel prefix
