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

Commit the result and push it to `main`. The deployment workflow builds and
smoke-tests the static, Datahike/S3, Datahike/DynamoDB, Datomic/DynamoDB, and
Datalevin/memory demos. There is no readiness ledger, qualification workflow,
or artifact-handoff gate in this path.

## Delivery topology

CloudFront serves only the private static explorer and the separate DataScript
entry. The shared explorer calls the selected server profile's public,
alias-qualified Lambda Function URL directly. See `docs/architecture.md` for
the exact profile, runtime, storage, and request paths.
