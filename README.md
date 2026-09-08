# EACL Demo

Canonical source for the consolidated EACL backend and storage demonstrations served at `demo.eacl.dev`.

The product uses two explicit selections: an EACL backend followed by a storage layer supported by that backend. The repository owns the shared explorer, `explorer.v1` contract, fixtures, profile services, and deployment infrastructure.

Deployment source is always an immutable pair:

- the exact `theronic/eacl-demo` commit being built; and
- the exact `theronic/eacl` commit pinned by the `deps.edn` committed at that demo revision.

Dirty checkouts, local-root dependencies, and branch names are not release identities. Every push to `production` rebuilds and deploys all live demos independently; `main` is an ordinary development branch.

## Upgrade EACL

One command updates the immutable EACL lock and every active demo reference,
prepares the exact Core checkout, and regenerates the release report:

```sh
npm run upgrade:eacl -- <commit-or-ref>
```

Merge the upgrade through a PR to `main`, then fast-forward `production` to the
reviewed commit. The deployment workflow builds and
smoke-tests the static, Datahike/S3, Datahike/DynamoDB, Datomic/DynamoDB, and
Datalevin/memory demos. There is no readiness ledger, qualification workflow,
or artifact-handoff gate in this path.

The v8 readers provision native UUID lifecycle values in their source configuration.
Keep each value across replicas and restarts; rotate it when replacing that
source's history. Backend source IDs remain separate. The Datalevin control-plane
JSON retains UUID strings and converts the validated lifecycle to a native UUID
at the EACL client boundary. Datalevin fixture replicas share their provisioned
lifecycle and manifest-derived source ID.

This upgrade retires previous basis tokens, pagination cursors, and cache snapshots.
Reload the browser and start fresh pagination after deployment. Preserve the
databases and Datalevin watermark; lifecycle UUIDs do not migrate relationship
storage. A rollback needs fresh old-format artifacts and must not reuse a retired
lifecycle. The candidate is pinned by Git SHA for demo testing before the separate
Core spec archival and Clojars release.

The durable profiles currently serve the older four-slot relationship layout.
Their upgrade also requires the explicit v7-to-v8 relationship migration on an
approved quiesced generation. Ordinary deployment cannot perform that stateful
operation; its candidate smoke must pass before promotion. See
[the v8 demo cutover](docs/v8-demo-cutover.md).

## Delivery topology

CloudFront serves the shared private static explorer and its conditional DataScript
entry. The shared explorer calls the selected server profile's public,
alias-qualified Lambda Function URL directly. See `docs/architecture.md` for
the exact profile, runtime, storage, and request paths.

## Local Caveats and expiry playground

The local playground uses the sibling `../core` checkout through the `:local-dev`
alias, including `eacl-caveats-jvm`. It supports writable Datomic `:dev` and
Datahike S3 backed by a dedicated MinIO container. Prepare Core's generated
runtime with `clojure -T:build prep` from `../core/modules/eacl` first.

Start these commands in three terminals, in order:

```sh
bash scripts/local-dev.sh infra
bash scripts/local-dev.sh api
bash scripts/local-dev.sh ui
```

Wait for the transactor's `System started` before starting the API. Open
[the playground](http://127.0.0.1:5176/caveats.html) and select either backend.
The Datomic distribution defaults to `~/datomic/1.0.7705`; override
`EACL_LOCAL_DATOMIC_HOME` if needed. Docker, Python 3, Clojure, Java, and the
installed npm dependencies are required.

Seeded examples give Alice unconditional access to `public`, region-qualified
access to `regional`, and a 60-second grant to `temporary`. Try region `za`,
region `us`, and an empty context. To renew a grant, delete it, set a new expiry,
and create it again. Enable repeated checks to watch expiry without a database
write. Lookup/count results include conditional entries; schema and Relationship
editors operate on the selected local backend.

Local ports are 5176 (UI), 8788 (API), 7821 (nREPL), 14334/14335 (Datomic),
and 19400/19401 (MinIO API/console). Local credentials and the Datahike store ID
are generated under ignored `target/local-dev/`; Datomic data lives there too.
MinIO data persists in the `eacl-v8-playground-minio` Docker volume. Keep the
credentials and store ID when restarting. These services bind to loopback and
do not use the deployed read-only service entry points.

Run the native integration test through the running local nREPL:

```sh
clj-nrepl-eval -p 7821 "(require 'clojure.test 'eacl-demo.local-test :reload) (clojure.test/run-tests 'eacl-demo.local-test)"
```

Stop the three terminal processes with Ctrl-C and run
`docker stop eacl-v8-playground-minio` to stop MinIO. Stopping preserves both stores.

DataScript opens at `/` with 10,000 logical resources automatically restored. Use **Add resources** to append browser-local data up to 100,000 resources. Switching away or reloading resets that session. Explicit server-backend URLs skip the DataScript runtime download. Existing `/datascript/` links remain compatible.
