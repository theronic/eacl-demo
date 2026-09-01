# Tasks

Prior work already shipped (context, not tasks): EACL bump to 9e0105f2 via
`npm run upgrade:eacl`, PR #68 merged (32cadc22), deploy run 33552891362 all
five jobs success, live demos verified, DEPLOY.md runbook added.

## 1. Core identity from deps.edn (D1)

- [ ] 1.1 Add `scripts/lib/eacl-core.mjs` (parse contract per design D1) with a
      `node --test` file covering: uniform-sha pass, mixed-sha throw,
      wrong-url throw, module extraction, committed-text parse.
- [ ] 1.2 Rewire `scripts/lib/checked-out-identity.mjs` (committed deps.edn
      bytes compare + parse; keep HEAD/clean checks).
- [ ] 1.3 Rewire `scripts/deploy-live-demo.mjs` `eaclSha()`.
- [ ] 1.4 Rewire `scripts/lib/prepare-eacl-core.mjs`.
- [ ] 1.5 Rework `scripts/upgrade-eacl.mjs`: oldSha from deps.edn, no lock
      write, no release-report step, `git grep` sweep replacing `rg`.
- [ ] 1.6 Rework `scripts/lib/deployment-manifest.mjs` +
      `generate-deployment-manifest.mjs` + `deployment-manifest.test.mjs`
      (+ check `schemas/deployment-manifest.v1.schema.json`,
      `scripts/lib/jvm-build-identity.mjs`).
- [ ] 1.7 Retarget `scripts/audit-jank-source.mjs` + `scripts/build-jank-memory.mjs`
      SHA comparison to the derived identity.
- [ ] 1.8 Delete `dependencies/eacl-core.lock.json`; `git grep eacl-core.lock`
      must return only openspec/docs history references you intend to keep.
- [ ] 1.9 Update docs listed in D1 step 9 (dependency-locks.md is a rewrite).

## 2. Registry removal (D2)

- [ ] 2.1 Rework `deploy-live-demo.mjs` publishProfile base: contracts
      profiles + `route` (extend `packages/contracts/profiles.v1.json` + its
      schema, or deployer route map); published JSON shape byte-compatible
      where explorer-state validates it.
- [ ] 2.2 Delete registry/ (4 files), builder/report scripts + lib + test,
      docs/release-report.md, package.json entries (per D2 list).
- [ ] 2.3 Retarget `publish-benchmark-evidence.mjs` input path; fix
      `packages/explorer-state/benchmark-publication.test.mjs` repo reads.
- [ ] 2.4 Rewrite-or-delete `scripts/datahike-comparability-policy.test.mjs`
      (decide, record rationale in implementation notes).
- [ ] 2.5 Verify every KEEP item in D2 still passes untouched
      (`test:contracts`, `test:explorer-state`, verification specs list).
- [ ] 2.6 Update docs (operator-runbook Release-report section removed, etc.).
- [ ] 2.7 Prune `docs/openspec-reconciliation.md` / other lock+registry
      stragglers found by `git grep`.

## 3. Branch model repo edits (D3)

- [ ] 3.1 deploy-demos.yml trigger → `production`.
- [ ] 3.2 deploy-live-demo.mjs `main:` deploymentId/alias/message literals →
      `production:` wording.
- [ ] 3.3 infra templates + authorities JSON + regenerate
      generated/github-oidc-trust-policies.v1.json; check
      github-oidc-policy.mjs for hardcoded refs.
- [ ] 3.4 Update the six policy/oidc tests pinning main (D3 list).
- [ ] 3.5 ASK USER, then apply: stateful workflows'/authorities' ref →
      production for FUTURE authorities only (do not rewrite historical
      authorization records; inspect data-lifecycle/authorization.mjs first).
      Check release-manifest.mjs/schema + regenerate runtime-validators.
- [ ] 3.6 Update docs (DEPLOY.md ship section, demo-delivery.md,
      operator-runbook.md, infra README example).

## 4. Validate, merge, cut over

- [ ] 4.1 Full battery per D4 (node suites + nREPL Clojure + upgrade-eacl
      no-op run). Record results in implementation-notes.md.
- [ ] 4.2 Commit on this branch, push, open PR; merge to main after review.
      Confirm NO deploy fires on the merge (trigger already `production` at
      the pushed SHA).
- [ ] 4.3 OPERATOR (needs `aws login`): update live IAM trust stacks from the
      updated templates (resolve stack names first; follow
      infra/deployment/README.md). BLOCKS 4.4.
- [ ] 4.4 `git push origin main:production`; `gh run watch` all five jobs
      green; spot-check live health/bootstrap + explorer.
- [ ] 4.5 `git push origin :demos` (delete legacy branch); confirm main/
      production protection state with user (none exists today).
- [ ] 4.6 Update memory + archive this change via `/opsx:archive`.
