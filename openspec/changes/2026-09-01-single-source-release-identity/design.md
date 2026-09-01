# Design — complete edit inventory and sequencing

All facts below were verified against the working tree at 32cadc22 (origin/main)
in the prior session. Re-verify anything marked (check) before editing.

## D1. Core identity derivation (replaces the lock)

New `scripts/lib/eacl-core.mjs`:
- `parseEaclCore(depsEdnText)` → `{repository, sha, modules}`. Contract it
  must assert: every `dev.eacl/eacl*` coordinate in `deps.edn` (across all
  aliases) carries `:git/url "https://github.com/theronic/eacl.git"` (single
  canonical url), all `:git/sha` values are equal and 40-hex, `modules` =
  sorted unique `:deps/root` values. Any violation throws with the offending
  alias — this preserves the lock's old "all pins move together" guarantee.
- `readEaclCore(root)` reads `<root>/deps.edn` and parses.
- Committed-identity variant: parse `git show <demoSha>:deps.edn` output
  (deployer + checked-out-identity need the committed file, not the worktree).

Rewire (dependency order):
1. `scripts/lib/checked-out-identity.mjs` — today: HEAD==GITHUB_SHA, clean
   diffs, working lock bytes == `git show <sha>:dependencies/eacl-core.lock.json`,
   validates schema/repository/sha, returns `{demoSha, eaclSha}`. New: compare
   working `deps.edn` bytes vs committed, derive eaclSha via parse.
2. `scripts/deploy-live-demo.mjs` `eaclSha()` — today parses
   `git show ${demoSha()}:dependencies/eacl-core.lock.json`; switch to
   committed-deps.edn parse. `demoSha()` (env `EACL_DEMO_SHA`, 40-hex) is
   already the `$GIT_SHA`-at-build-time model — keep.
3. `scripts/lib/prepare-eacl-core.mjs` — reads lock for sha/repository;
   switch to `readEaclCore`. Unchanged: cache checkout at
   `target/eacl-core-source/<sha>` (init/fetch --depth=1/checkout FETCH_HEAD),
   browser-bundle presence check, class-major check (Java 25 → major 69),
   `clojure -T:build prep` with `EACL_JAVA_RELEASE=25`.
4. `scripts/upgrade-eacl.mjs` — oldSha from `readEaclCore` instead of lock;
   drop lock write; drop `build-release-report` step (dies in D2); replace the
   `rg`-based stale sweep with `git grep --fixed-strings <oldSha>` — **`rg` is
   a shell-function shim on this machine, not spawnable from node** (crashed
   the 2026-09-01 run after all rewrites completed).
5. `scripts/lib/deployment-manifest.mjs` — `validateCoreLock(lock)` with
   exactKeys [schema,repository,sha,modules] → validate the derived identity
   object instead; `scripts/generate-deployment-manifest.mjs` lockPath → derive.
   `schemas/deployment-manifest.v1.schema.json` references the lock (check —
   published schema? If live-published, version the change).
6. `scripts/audit-jank-source.mjs` (:25) and `scripts/build-jank-memory.mjs`
   (:31) — `json("dependencies/eacl-core.lock.json")` used only to compare SHA
   vs `dependencies/jank-engine-port.v1.json` (which STAYS) → compare vs
   derived identity.
7. `scripts/lib/jvm-build-identity.mjs` (check usage), `deployment-manifest.test.mjs`.
8. Delete `dependencies/eacl-core.lock.json`. Optional small policy test:
   deps.edn Core pins are uniform (the parse contract enforces this anyway).
9. Docs: DEPLOY.md §1 notes, README.md, apps/explorer-datascript/README.md,
   docs/datomic-lambda-artifact.md, docs/dependency-locks.md (rewrite: deps.edn
   is the sole Core pin; "derived at build time from the committed deps.edn"),
   docs/openspec-reconciliation.md, docs/release-identity.md,
   docs/operator-runbook.md preflight step 2.

## D2. Registry removal

Delete: `registry/profile-registry.v1.json`, `registry/release-report.v1.json`,
`registry/data-manifests/datahike-s3-legacy.v1.json`,
`registry/benchmark-evidence/README.md`; `scripts/build-profile-registry.mjs`,
`scripts/build-release-report.mjs`, `scripts/lib/release-report.mjs`
(PROFILE_IDS/PROFILE_INPUT constants — deployer must not lose anything it
needs; check imports), `scripts/release-report.test.mjs`,
`docs/release-report.md`, `schemas/release-report.v1.schema.json` (check it is
not live-published before deleting), package.json entries `build:registry`,
`build:release-report`, `verify:release-report` (+ any publish-evidence entry).

Deployer rework (`scripts/deploy-live-demo.mjs`): today
`import baseRegistry from "../registry/profile-registry.v1.json"` is used ONLY
at publishProfile (~:654): `baseRegistry.profiles.find(id)` merged with
`{state:"enabled", deployment:{...}, lastOutcome:{...}}` → uploaded to live S3
`registry/profiles/<id>.json` + CloudFront invalidation. Replace base with
`packages/contracts/profiles.v1.json` (already imported as
`profileDefinitions`) — but contracts profiles have `{id,backend,storage,apiOrigin}`
and NO `route` (registry had route "/" or "/datascript/"). Either extend
contracts/profiles.v1.json + its schema with `route`, or a small route map in
the deployer. Preserve the exact published JSON shape —
`packages/explorer-state` validates it (validateProfileEntry); run
`test:explorer-state` against the new construction.

Registry consumers to prune/retarget:
- `scripts/datahike-comparability-policy.test.mjs` — reads data-manifests +
  profile-registry + evidence README; rewrite against remaining sources or
  delete if its policy dies with the manifests (judgment call; the
  datahike-s3-legacy data manifest is part of the deletion).
- `scripts/publish-benchmark-evidence.mjs` — arg regex forces repo path
  `registry/benchmark-evidence/...json`; retarget input dir (e.g.
  `verification/benchmark-evidence/`) while keeping the live S3 target keys.
- `packages/explorer-state/benchmark-publication.test.mjs` — :14 reads
  `../../registry/profile-registry.v1.json` + contracts profiles; :80 uses the
  live path string `registry/benchmark-evidence/datahike-storage-example.json`
  (live path = keep string, change the repo-file read to contracts profiles).
- KEEP (live-path references only, verify each): `apps/explorer-main/src/App.tsx`,
  `packages/explorer-state/src/{profile-registry,benchmark-publication}.mjs`,
  `packages/explorer-state/{profile-publication,profile-registry}.test.mjs`,
  `verification/**/*.spec.ts`, `schemas/profile-registry.v1.schema.json`,
  `schemas/benchmark-evidence-index.v1.schema.json`,
  `scripts/generate-runtime-validators.mjs`,
  `packages/contracts/src/runtime-validation.mjs` (schema ids + live URLs).
- Docs: backend-storage-catalog.md, fastest-storage-evidence.md,
  release-identity.md, operator-runbook.md (delete the whole "Release report"
  section; prune preflight step 4's "profile registry state" wording to the
  live registry), DEPLOY.md.

## D3. Branch model (main = dev, production = deploy)

Repo edits (safe to merge to main — **a push event evaluates the workflow file
at the pushed SHA**, so the commit that changes the trigger cannot itself fire
the old trigger):
- `.github/workflows/deploy-demos.yml`: `on.push.branches: [main]` →
  `[production]`. Keep `EACL_DEMO_SHA: ${{ github.sha }}` and environment
  names `demo-production-*`.
- `scripts/deploy-live-demo.mjs`: deploymentId literal
  `` `main:${demoSha()}:${profileId}` `` → `production:...`; alias description
  `` `main:${demoSha()}:${artifactSha}` `` → `production:...`; lastOutcome
  message "The main-branch build and bounded live smoke passed." →
  production-branch wording. (Check for other `main:` literals.)
- OIDC trust templates: `infra/deployment/static-deploy-role.yaml` (:53 ref
  condition, :57 sub), `server-profile-deploy-role.yaml` (:38/:43/:48 subs),
  `live-ci-role.yaml` (:33 sub) — every `ref:refs/heads/main` and
  `workflow_ref:...@refs/heads/main` → `refs/heads/production` for the five
  ordinary deployment roles. `infra/deployment/github-oidc-authorities.v1.json`
  `deploymentRef` → `refs/heads/production`. Regenerate
  `infra/deployment/generated/github-oidc-trust-policies.v1.json` via
  `scripts/github-oidc-policy.mjs` (check for hardcoded main + its test).
- Policy tests pinning main: `scripts/static-deploy-role-policy.test.mjs:11`,
  `scripts/server-deploy-role-policy.test.mjs:15`,
  `scripts/stateful-workflow-policy.test.mjs:138` (asserts deploy-demos
  trigger exactness — read carefully, direction matters),
  `scripts/ordinary-workflow.test.mjs:43` (trigger regex `branches:\n      - main`),
  `scripts/capture-github-oidc-claims.test.mjs`, `scripts/github-oidc-policy.test.mjs`.
- OPEN DECISION (flag to user, do not decide silently): the three stateful
  workflows (`stateful-datahike-dynamodb.yml`, `stateful-datomic-dynamodb.yml`,
  `stateful-datomic-seed.yml`) are workflow_dispatch jobs **ref-restricted to
  main** via their OIDC subs, and
  `infra/data/authorized-initial-stateful-operations.v1.json` +
  `packages/data-lifecycle/authorization.mjs` (+ test) record
  `refs/heads/main` authorization identities. Recommendation: future stateful
  authorities move to `production` (the operational branch); historical
  authorization RECORDS must not be rewritten if they are append-only evidence
  — inspect authorization.mjs semantics first. `scripts/lib/release-manifest.mjs`
  + `schemas/release-manifest.v1.schema.json` +
  `packages/contracts/src/generated/runtime-validators.mjs` (regenerate, don't
  hand-edit) also carry refs/heads/main (check each).
- Docs: DEPLOY.md §3 (ship = merge to main, then fast-forward `production`),
  docs/demo-delivery.md ("A push to `main` starts five jobs" → production),
  docs/operator-runbook.md (§Ordinary deployment; §preflight 5 "A `main` push
  is never a seed..." wording), infra/deployment/README.md example subject.

Live cutover (operator, blocked on AWS auth — session was expired 2026-09-01,
`aws login` needed):
1. Merge the repo change to `main` (nothing deploys; main is now dev).
2. Update the live IAM role trust stacks from the updated templates BEFORE any
   production push (roles: static deploy, server profile deploy ×3 subs,
   live CI). They are CloudFormation — resolve exact stack names via
   `aws cloudformation list-stacks` / `scripts/capture-aws-estate.mjs`; follow
   infra/deployment/README.md. Until then a production push fails at
   configure-aws-credentials (harmless but red).
3. `git push origin main:production` at the validated head → five jobs run —
   this is the end-to-end validation of the reworked deployer.
4. Verify live (health/bootstrap + explorer origins), then
   `git push origin :demos`.
5. No protections exist to remove (verified: main 404, demos protected:false).
   Optionally ask user whether `production` should gain protection.

## D4. Validation battery (after D1+D2, again after D3 repo edits)

`npm ci` (if package.json changed), `npm run verify:secrets`,
`test:contracts`, `test:explorer-state`, `test:ui`, `test:fixtures`,
`verify:fixture-golden`, `verify:determinism`, plus every `node --test`
script file touched above run directly. Clojure per DEPLOY.md §2 (nREPL
port 7888; `EACL_NREPL_PORT=7888 npm run test:clojure`). One
`npm run upgrade:eacl -- 9e0105f2` no-op/idempotency run to prove the
reworked upgrade path (should rewrite nothing, sweep clean via git grep).
