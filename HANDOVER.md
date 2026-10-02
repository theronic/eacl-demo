# Handover: EACL 8.0.0-RC-2026-10-02 upgrade

Branch `agent/upgrade-eacl-8.0.0-rc-2026-10-02`, cut from `production` at
1758634. Nothing is merged or deployed: live demo.eacl.dev still runs EACL
6982d388 (demo 1758634).

## Done

- `deps.edn`: published modules (`eacl-datomic`, `eacl-datahike`,
  `eacl-datascript`) use `{:mvn/version "8.0.0-RC-2026-10-02"}`. The staged
  formal-class paths are gone, because the published `dev.eacl/eacl` JAR
  ships the generated kernel classes (Java 25, major 69) and
  `EaclKernel.browser.js`. `:datascript-runtime` adds the `cljs-cache` Git
  fork, which Maven metadata cannot carry. `:datalevin-memory` builds
  `eacl-datalevin` from eeb1f844 source against a top-level
  `dev.eacl/eacl` RC pin. `clojure -Stree` resolves exactly one
  `dev.eacl/eacl` (the RC) in every alias.
- Pin tooling:
  - `scripts/lib/eacl-core.mjs` parses one Maven version plus the source
    SHA. The identity is still `{repository, sha, modules}`, with sha =
    eeb1f844…
  - `scripts/lib/prepare-eacl-core.mjs` checks that the published POM's
    SCM tag equals that SHA and that every class in the JAR is major 69.
    It stages only the source checkout and no longer runs the formal prep.
  - `build.clj` no longer copies checkout classes.
  - `scripts/build-datascript-runtime.mjs` uses the published JARs.
  - `scripts/upgrade-eacl.mjs` now takes a Clojars version. Tested
    idempotently and with a scratch downgrade.
  - Tests and docs are updated to match.
- SHA rewrite 6982d388 → eeb1f844 in the handler tests, mocks, the jank
  manifest and `profile.jank`, as the upgrade script does.
- Test fix: `verification/datascript/resource-first.spec.ts` "sibling
  disclosures" now waits for the footer checker's debounced first query.
  The RC runtime starts faster, which exposed a race: it passed 2 of 6 on
  the RC, 6 of 6 on the old runtime, and 16 of 16 after the fix. Responses
  and latencies are otherwise identical between the old and new runtimes.

## Verified locally (green unless noted)

- Builds plus artifact audits for every JVM jar: Datomic Lambda, Datahike
  S3, Datahike DynamoDB, both seed jars and Datalevin (built on macOS). Both
  Datahike audits fail only on two pre-existing stale source-regex
  assertions (`:writer read-only-writer/config` and a `:keys` list).
  Everything else in them passes.
- Static site plus the DataScript CLJS build. The snapshot check passes
  (87,437 datoms).
- Clojure (one nREPL with all JVM aliases): generic, Datomic, Datahike S3,
  Datahike DynamoDB and storage-v8 suites. The only errors are 2
  pre-existing Datomic seed errors: `maintenance/.../seed.clj` passes a map
  as `:source-lifecycle`, which 6982d388 already rejected.
- JS suites: contracts, explorer-state, fixtures, services,
  runtime-validators, ordinary-delivery and jvm-build-identity.
  `verify:secrets` flags `scripts/deploy-legacy-redirect.mjs`; this is
  pre-existing and not touched.
- I ran the built jars locally against the live stores, read-only:
  - Datahike/S3: `qualify:http-profile` 16/16 pass, and the extended smoke
    returns the same answers as the live old Lambda.
  - Datahike/DynamoDB: 18/18 pass.
  - Datomic, via the EC2 http-kit `-main`: 17/17 pass.
- Over the WAN, a cold count of super-user accounts with the cache off hits
  the 30 s deadline. Datomic reports it as `deadline-exceeded`. Datahike
  reports it as `internal-error`, because no `:timeout-ms` is passed to
  EACL; the old Lambda simply timed out (502).
- Playwright:
  - DataScript: 50/50 except 2 pre-existing failures, which also fail on
    the old runtime: browser-local "Backend & Storage" heading, and
    seed-retry.
  - Explorer: 33/40. Its failures also fail with the old SHA: `:245`
    (`=> true` copy) and `:73` on mobile.

## Left

1. Open or merge the PR into `production`. Merging deploys all five jobs.
2. Watch the run: `gh run watch --repo theronic/eacl-demo`.
3. Live checks. Every profile's `/health` should report `eaclSha`
   eeb1f844e42efd5a04e05372bdac3cf4774808b1. Exercise checks, lookups,
   counts and `get-schema` on the Datomic EC2, Datomic Lambda, Datahike S3
   and DynamoDB Lambdas, Datalevin EC2, and the DataScript explorer. Compare
   timings against the pre-upgrade baseline: Datomic EC2 cache-off count of
   super-user accounts took 36–551 ms server-side; Datahike S3 took 14.7 s
   cold, then 52–64 ms.
4. If the live site breaks: open a revert PR into `production` and merge it.

Live notes: before this work, the Datahike DynamoDB, Datalevin and large
Lambdas had idle (`Inactive`) SnapStart versions that return 500 until they
are reactivated. The deploy publishes fresh versions. Clojars also lists a
plain `8.0.0`.

## Next commands

```sh
gh pr ready <pr> --repo theronic/eacl-demo   # if opened as a draft
gh pr merge <pr> --repo theronic/eacl-demo --merge
gh run watch --repo theronic/eacl-demo
curl -s https://datomic.demo.eacl.dev/health -H 'origin: https://demo.eacl.dev' -H "x-eacl-request-id: browser-$(uuidgen | tr A-Z a-z)"
```

Before the first local build: `npm ci`, then `node scripts/prepare-eacl-core.mjs`.
The Datalevin build also needs the fork at `target/eacl-core-source/datalevin`
(theronic/datalevin a7e29c25) and the native jar, exactly as the workflow fetches them.
