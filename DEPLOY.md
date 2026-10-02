# DEPLOY — bumping EACL and shipping the live demos

This is the short path from "a new EACL Core commit exists" to "every live
demo serves it". The authoritative contracts live in
[docs/demo-delivery.md](docs/demo-delivery.md) (delivery),
[docs/operator-runbook.md](docs/operator-runbook.md) (operations, rollback,
incidents), and [docs/dependency-locks.md](docs/dependency-locks.md)
(pin policy); this file sequences them.

## 1. Bump the EACL release

The demo consumes published EACL releases from Clojars. One command moves
every `dev.eacl` Maven coordinate in `deps.edn` to the new version, rewrites
the release's source commit (read from the published POMs' SCM tag) wherever
current source carries it, stages that commit's source under
`target/eacl-core-source/<sha>/` for the unpublished `eacl-datalevin` module,
and fails if the old commit survives anywhere in current source:

```sh
npm run upgrade:eacl -- <published EACL version, e.g. 8.0.0-RC-2026-10-02>
```

Notes:
- Every published module must exist on Clojars at that version and name the
  same source commit; the commit must be fetchable from
  `https://github.com/theronic/eacl.git`.
- Never hand-edit versions or SHAs: `deps.edn`, Lambda handler tests, and the
  jank engine port manifest all carry the pin and must move together (the
  script enforces this, `scripts/lib/eacl-core.mjs` fails any build where the
  `deps.edn` versions or SHAs disagree, and every build checks the published
  POM against the SHA).
- `deps.edn` is the sole source of truth for the EACL release; demos build
  and deploy from exactly that release — never Core `HEAD`.
- The DataScript runtime alias also pins EACL's `cljs-cache` Git fork, which
  Maven metadata cannot carry; keep it at the SHA the EACL README names.

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

## 3. Ship: PR to `main`, then fast-forward `production`

Commit the bump on a branch, open a PR, and merge to `main`. Pushes to `main`
deploy nothing — it is the ordinary development branch. The **only** automatic
deployment trigger is a push to `theronic/eacl-demo:refs/heads/production`
(`.github/workflows/deploy-demos.yml`):

```sh
git fetch origin && git push origin origin/main:production
```

That push fans out five independent build-and-deploy jobs — static +
DataScript, Datahike/S3, Datahike/DynamoDB, Datomic/DynamoDB, Datalevin/memory
— each building the triggering commit, deriving Core solely from the committed
`deps.edn`, publishing one immutable Lambda version, moving `candidate`
aliases, and running its bounded smoke. Jobs are independent: one failure
neither stops nor rolls back a sibling.

Watch it:

```sh
gh run watch --repo theronic/eacl-demo
```

### EC2 host changes are a separate CloudFormation update

The `production` push only replaces the jar and the release lines of
`/etc/eacl-demo-datomic.env` over SSM. It keeps the pair it replaces and
puts it back when the new release does not answer `/health` on the host
(docs/operator-runbook.md §Rollback). Instance type, JVM options
(`EACL_JAVA_OPTS`), the Datomic object cache, swap, and the CloudWatch agent
configuration live in `infra/profiles/datomic-dynamodb-ec2.yaml`, and take
effect only through a stack update, which stops and starts the instance:

```sh
aws cloudformation deploy --stack-name eacl-demo-datomic-dynamodb-ec2 --template-file infra/profiles/datomic-dynamodb-ec2.yaml --capabilities CAPABILITY_IAM --parameter-overrides InstanceType=t3.small --no-fail-on-empty-changeset
```

`deploy` keeps every parameter you do not override at its current stack
value, so pass `InstanceType` explicitly when changing it. The
`RuntimeArtifactAssociation` then re-applies the env, unit, and agent files
on the running instance and restarts the service. It derives
`EACL_RUNTIME_MEMORY_MIB` and `EACL_JAVA_OPTS` from the host's RAM (a 2 GiB
host gets the fixed 1 GiB heap and 576 MiB object cache; smaller hosts keep
the 640 MiB heap), and it never replaces a verified SSM release with the
stack's older artifact parameters, which lag behind production. Pass the
current release's `ArtifactKey`, `ArtifactVersion`, `ArtifactSha256`,
`DemoSha`, `EaclSha`, and `DeploymentId` as overrides too when you update
the stack, so a replacement instance boots the artifact that is actually
in production. Check `free -m` and the `EaclDemo/Host` memory and swap
metrics afterwards. Datahike Lambdas take their store cache size
(`EACL_STORE_CACHE_SIZE`) from `scripts/deploy-live-demo.mjs` on every
production deploy.

## 4. After the deploy

- Spot-check the explorer at the live origin and one server profile's
  health/bootstrap handshake (docs/demo-delivery.md describes the routing
  and origins).
- A `production` push is **never** a seed, migration, table creation, or
  temporary-compute authorization — stateful work stays behind the
  separately dispatched, confirmation-token workflows (`stateful-*.yml`),
  which are themselves dispatched on the `production` ref.
- Rollback and incident procedures: docs/operator-runbook.md §Rollback.
  Deployment is by immutable versions and aliases, so rolling back a
  profile is an alias move, not a rebuild.
