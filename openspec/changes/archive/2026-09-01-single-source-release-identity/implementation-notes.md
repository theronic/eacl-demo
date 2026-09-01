# Implementation notes — 2026-09-02

## Delivered

- `scripts/lib/eacl-core.mjs`: single derivation of the Core identity from
  `deps.edn` (`:git/url` canonical, all `:git/sha` + embedded
  `target/eacl-core-source/<sha>` paths equal, modules from
  `:deps/root`/`:local/root`, always including `modules/eacl`). Failures name
  the offending alias/line. 8-case test file.
- Rewired: checked-out-identity (committed deps.edn bytes compare),
  deploy-live-demo `eaclSha()`, prepare-eacl-core, jvm-build-identity,
  upgrade-eacl (no lock write, no release-report step, `git grep`
  stale sweep replacing unspawnable `rg`), deployment-manifest
  (`validateCoreLock`→`validateCoreIdentity`; manifest `eacl.lock` binding →
  `eacl.pin` on `deps.edn` bytes, schema updated), audit-jank-source,
  build-jank-memory. Lock deleted.
- Registry deleted (4 files) + build-profile-registry, build-release-report,
  lib/release-report, release-report.test, docs/release-report.md,
  schemas/release-report.v1.schema.json, package.json entries
  (`build:registry`, `build:release-report`, `verify:release-report`).
- New `createBaseRegistry(profileDefinitions)` in
  `packages/explorer-state/src/profile-publication.mjs` synthesizes the
  fail-closed baseline the checked-in registry used to supply (equivalent:
  `createFailClosedRegistry` always discarded the checked-in states/reasons).
  Consumers switched: App.tsx (build-time import removed), deployer
  publishProfile (base = contracts definition + `canonicalProfileRoute`),
  explorer-state tests ×3, contracts runtime-validation test, Playwright
  specs ×2. `publish-benchmark-evidence` input moved to
  `verification/benchmark-evidence/` (live keys unchanged).
- Branch model: deploy trigger `main`→`production`; deploymentId/alias/
  message channel literals → `production:`; OIDC `deploymentRef` →
  `refs/heads/production` across authorities manifest, three CFN role
  templates, generated trust bundle (regenerated), policy generator
  (`every-main-push`→`every-production-push`); stateful workflow `if:` ref
  guards, `data-lifecycle` AUTHORIZED_REF + authorization policy JSON,
  release-manifest lib/schema/validators (regenerated); six policy tests;
  docs (DEPLOY.md, operator-runbook — Release-report section replaced by
  OIDC-boundary heading — demo-delivery, dependency-locks rewrite,
  release-identity, READMEs, backend-storage-catalog,
  fastest-storage-evidence, infra README).

## Deviations from design

- `route` was NOT added to `packages/contracts/profiles.v1.json`:
  `canonicalProfileRoute` in `packages/explorer-state/src/profile-entry.mjs`
  already code-derives it, and a contracts field would have created a new
  duplicated source of truth. Deployer and baseline both use the function.
- D3 task 3.5 resolved architecturally rather than as a split: the OIDC
  authorities manifest has ONE repository-wide `deploymentRef` used by all
  eight authorities (five ordinary + three stateful); per-authority refs would
  be new machinery. Everything moves to `production`, including future
  stateful dispatches (run them on the `production` ref). The stateful
  authorization policy JSON's `authorizedRef` is a live gate input, not a
  historical record — changing it invalidates no completed operation and any
  outstanding preview would have expired in 30 minutes anyway.
- `audit-jank-source` dropped its two checked-in-registry narrative
  assertions (profile state/reason); its substantive checks (port-lock SHA
  discipline, closure digests, builder pins) are intact and passing.
- `datahike-comparability-policy.test` kept the adoption-mismatch binding and
  the openspec authorization pins; dropped the tests that only restated the
  deleted legacy data manifest and registry/README narrative.
- Deployment-manifest schema keeps the `eacl-demo.deployment-manifest.v1` id
  with the `lock`→`pin` field rename: the manifest is produced/consumed only
  by the repo's own scripts and its schema is not live-published.

## Validation (2026-09-02, all exit 0)

- scripts: `node --test scripts/*.test.mjs` → 157/157.
- `npm run test:contracts` 59/59; `test:explorer-state` 88/88; `test:ui` 4/4;
  `test:fixtures` 23/23; `test:services` 1/1; `verify:secrets`,
  `verify:fixture-golden` (34 vectors), `verify:determinism` (11 files) pass.
- `npm run build:explorer-main` exit 0 (App.tsx compiles without the deleted
  JSON import).
- `node scripts/github-oidc-policy.mjs --check` and
  `verify:runtime-validators` confirm regenerated outputs are fresh.
- `node scripts/prepare-eacl-core.mjs` derives 9e0105f2 from deps.edn and
  no-ops against the staged checkout.
- `npm run upgrade:eacl -- 9e0105f2…` no-op run: resolves, verifies fetch,
  rewrites 0 files, prepare passes, git-grep stale sweep clean.
- Clojure suites deliberately not re-run: `deps.edn` is byte-identical to the
  state that deployed green on run 33552891362, and no Clojure source changed
  in this change-set.
- Sweeps: zero references to `eacl-core.lock`, `refs/heads/main`, or the
  checked-in registry outside `openspec/` and `docs/provenance/`.

## Live cutover state

Repo-side complete. Remaining operator steps (tasks 4.3–4.5): update the live
IAM role trust stacks from the updated templates (AWS auth required), push
`production`, delete `demos`.

## Live cutover — completed 2026-09-02

- The five deploy-role trust policies were updated in place
  (`aws iam update-assume-role-policy`) from the regenerated bundle; each live
  document verified byte-equal to `generated/github-oidc-trust-policies.v1.json`.
  Stateful roles have never been provisioned (no `AWS_STATEFUL_*` repo
  variables), so no stateful trust existed to update.
- Finding not in the design inventory: the five `demo-production-*` GitHub
  **environments carry custom deployment-branch policies**, a fourth `main`
  pin besides the workflow trigger, OIDC trust, and docs. The first production
  push (run 33567477947) failed all five jobs with zero steps executed until
  each environment's policy was switched from `main` to `production`.
- Rerun of 33567477947: all five jobs `success`. Live verification:
  `registry/profiles/datahike-s3.json` shows state `enabled`, deploymentId
  `production:e44fc3371c07b8a14d6a473f016e23c277f589a4:datahike-s3`, eaclSha
  `9e0105f2…`, gate `demo-smoke`; the Lambda runtime echoes the same
  `production:` revision in its response envelopes.
- `origin/demos` deleted. Remaining flagged cleanup (not executed — needs
  explicit approval): IAM role `eacl-demo-demos-branch-deploy` + repo variable
  `DEMO_DEPLOY_ROLE_ARN`, and the `eacl-demo-live-ci-role` CloudFormation
  stack (its `eacl-demo-main-branch-deploy` role no longer appears in IAM).
  The `eacl-demo-deploy-datahike-dynamodb` stack now has cosmetic trust drift
  (live trust updated ahead of its template); the merged template already
  matches, so the next stack update reconciles it.
