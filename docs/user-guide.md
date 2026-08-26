# EACL demo user guide

Operators should use `docs/operator-runbook.md`; the deliberately small,
parallel `demos`-branch delivery contract is in
`docs/demos-branch-delivery.md`.

## Choose a backend, then its storage

The explorer uses two dependent choices. The first selects the EACL backend;
the second shows only storage layers supported by that backend:

| Backend | Storage choices | Profile |
| --- | --- | --- |
| Datahike | S3, DynamoDB | `datahike-s3`, `datahike-dynamodb` |
| Datomic | DynamoDB | `datomic-dynamodb` |
| Datalevin | In-memory | `datalevin-memory` |
| Jank | In-memory | `jank-memory` |
| DataScript | Browser memory | `datascript-browser-memory` |

Datahike is the initial backend unless a bounded canonical URL selects another
backend and compatible storage. A visible profile is usable only when its
registry state is `enabled`; disabled, qualifying, and unavailable choices
remain visible with a reason. The checked-in pre-deployment registry currently
has no enabled profile and therefore makes no usable-storage or speed claim.

## What “fastest” means

“Fastest” applies only to qualified storage choices for the same backend. For
Datahike, S3 and DynamoDB must be measured with the same one-million-resource
fixture, operation mix, region, Java runtime, architecture, memory, cache
lanes, concurrency, repetitions, and decision rule. Evidence is immutable,
content-addressed, expires, and is revalidated before it can choose a default.

A statistically separated result may be labelled `fastest-qualified`. A
tie-break result is only `benchmark-selected`. If there is no comparable
current result, the explorer either selects the sole qualified storage or uses
the stable qualified fallback without a speed claim. If none is qualified,
there is no default storage. See [fastest-storage-evidence.md](./fastest-storage-evidence.md)
for the complete evidence contract.

## Dataset scale is not a backend benchmark

The durable Datahike and Datomic demonstrations use the canonical
one-million-resource cut point. Datalevin, Jank, and DataScript use the
canonical 10,000-resource semantic prefix for bounded in-memory or browser
lifecycle work. Results across those unequal scales are demonstrations of
semantics and runtime behavior, not valid speed comparisons. The explorer
shows fixture and manifest identity with every profile response.

## Consistency, snapshots, and caches

Controls come from the selected profile's deployed descriptor, not from its
backend name. Unsupported controls are omitted or rejected; the UI never
silently upgrades `current` into exact or historical behavior.

- Datahike captures an immutable request snapshot. Its qualified descriptor
  states the available current/minimize/exact-style modes and whether its
  shared read-through cache was used.
- Datomic Lambda opens a read-only Peer connection, captures one current
  `d/db` during environment initialization, and serves that fixed value until
  the Lambda environment is replaced. `current` and `minimize` refer to that
  retained value. The profile does not synchronize and exposes no exact,
  as-of, historical-date, or history API. The underlying database is seeded
  without `:db/noHistory true` so a future, separate non-read-only EC2 demo can
  use retained history; that does not broaden this Lambda.
- Datalevin and Jank rebuild bounded in-memory state for a runtime lifecycle.
  Their caches are environment-local and their data is not durable.
- DataScript owns its fixture, authorization state, cache, and snapshots in a
  dedicated browser worker. Normal DataScript operations do not call a public
  profile API or transmit the authorization data. Loading the static page and
  worker assets still uses the website normally.

Every response binds the profile, deployed demo SHA, pinned EACL Core SHA,
artifact digest, deployment ID, data-manifest digest, and basis. A mismatch
between the URL, registry, health response, and bootstrap descriptor prevents
the profile from becoming ready.

## Jank limitations

The Jank artifact targets a Linux x86_64 Amazon Linux 2023 Lambda custom
runtime (`provided.al2023`) with a root `bootstrap` executable. It does not use
SnapStart: Lambda SnapStart is not available for OS-only custom runtimes, and
the native startup path is measured directly. The in-memory conformance store
is Datomic-like for the demonstrated authorization semantics; it is not
Datomic Pro and makes no durability, Datalog, distribution, or production
database claim. A future arm64 build would be a separately qualified target,
not an interchangeable rebuild.

## Privacy and safe links

Canonical links contain only bounded semantic UI choices. They never contain
cursors, basis or revision values, request IDs, credentials, tokens, or cache
state. Public server profiles expose only the closed read-only explorer
operations; seed, schema-write, transaction, setup, benchmark, cache-eviction,
store-deletion, and administration routes are unavailable.
