# EACL Demo

Canonical source for the consolidated EACL backend and storage demonstrations served at `demo.eacl.dev`.

The product uses two explicit selections: an EACL backend followed by a qualified storage layer supported by that backend. The repository owns the shared explorer, `explorer.v1` contract, deterministic fixtures, profile services, deployment infrastructure, provenance, and operating evidence.

Deployment source is always an immutable pair:

- the exact `theronic/eacl-demo` commit being built; and
- the exact reachable `theronic/eacl` commit in `dependencies/eacl-core.lock.json` committed by that demo revision.

Dirty checkouts, local-root dependencies, and branch names are not release identities. Merges to the future `demos` branch will deploy static and profile jobs independently, without a fleet-wide barrier or GitHub concurrency management.

The active implementation plan is the OpenSpec change `consolidate-eacl-demo-backends`.
