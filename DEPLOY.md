# DEPLOY — bumping EACL and shipping the live demos

This is the short path from "a new EACL Core commit exists" to "every live
demo serves it". The authoritative contracts live in
[docs/demo-delivery.md](docs/demo-delivery.md) (delivery),
[docs/operator-runbook.md](docs/operator-runbook.md) (operations, rollback,
incidents), and [docs/dependency-locks.md](docs/dependency-locks.md)
(lock policy); this file sequences them.

## 1. Bump the EACL Core lock

One command rewrites every pinned SHA, refreshes
`dependencies/eacl-core.lock.json`, stages the locked Core source and its
generated kernel classes under `target/eacl-core-source/<sha>/`, regenerates
the release report, and fails if the old SHA survives anywhere in current
source:

```sh
npm run upgrade:eacl -- <eacl commit, branch, or tag>
```

Notes:
- Requires ripgrep (`rg`) on PATH for the final stale-SHA sweep.
- The reference is resolved against `https://github.com/theronic/eacl.git`;
  the commit must be pushed there first.
- Never hand-edit SHAs: `deps.edn`, `build.clj`, Lambda handler tests, the
  jank engine port manifest, and the release registry all carry the pin and
  must move together (the script enforces this).
- `dependencies/eacl-core.lock.json` is the sole product-version lock; demos
  build and deploy from exactly that Core commit — never Core `HEAD`.

## 2. Verify locally

```sh
npm ci
npm run verify:secrets
npm run test:contracts
npm run test:explorer-state
npm run test:ui
npm run test:fixtures
npm run verify:fixture-golden
npm run verify:determinism
```

Clojure tests run through the persistent-nREPL procedure in
[docs/clojure-nrepl-workflow.md](docs/clojure-nrepl-workflow.md):

```sh
clojure -M:test:nrepl --port 7888
```

```sh
EACL_NREPL_PORT=7888 npm run test:clojure
```

Run the profile-specific guards for anything the bump plausibly touches
(for example `verify:datomic-artifact-determinism`,
`verify:datahike-s3-artifact-determinism`).

## 3. Ship: PR, then push to `main`

Commit the bump on a branch, open a PR, and merge. The **only** automatic
deployment trigger is a push to `theronic/eacl-demo:refs/heads/main`
(`.github/workflows/deploy-demos.yml`). It fans out five independent
build-and-deploy jobs — static + DataScript, Datahike/S3,
Datahike/DynamoDB, Datomic/DynamoDB, Datalevin/memory — each building the
triggering commit, resolving Core solely from the committed lock,
publishing one immutable artifact, and running its bounded smoke. Jobs are
independent: one failure neither stops nor rolls back a sibling.

Watch it:

```sh
gh run watch --repo theronic/eacl-demo
```

## 4. After the deploy

- Spot-check the explorer at the live origin and one server profile's
  health/bootstrap handshake (docs/demo-delivery.md describes the routing
  and origins).
- A `main` push is **never** a seed, migration, table creation, or
  temporary-compute authorization — stateful work stays behind the
  separately dispatched, confirmation-token workflows
  (`stateful-*.yml`).
- Rollback and incident procedures: docs/operator-runbook.md §Rollback.
  Deployment is by immutable versions and aliases, so rolling back a
  profile is an alias move, not a rebuild.
