# Canonical EACL demo fixture decision

Status: accepted for fixture algorithm `eacl-demo-fixture-v1`

Decision date: 2026-08-25

## Scope and authority

This record reconciles the demo sources captured in
`docs/provenance/source-state-2026-08-25.json`. It defines logical fixture
semantics only. Backend-native entities, datoms, indexes, transaction markers,
and storage metadata are not part of the logical fixture and cannot change its
identity.

The canonical fixture is generated in this repository. Legacy stores are not
declared compatible merely because their visible server count matches a cut
point. A legacy store needs an explicit mapping and a verified canonical
manifest before it can claim this fixture identity.

## Reconciled source decisions

| Concern | Datahike / Datalevin | Datomic | Jank | DataScript explorer | Decision |
| --- | --- | --- | --- | --- | --- |
| Schema | Recursive schema is installed; non-recursive preset also exists | Same core types; older seed behavior | Both presets exist, but the development server boots non-recursive | Similar non-recursive schema | Use the recursive schema below; retain no mutable schema preset in public profiles |
| Quick subjects | `super-user`, `user-1`, `user-2` | Same names | Same names | Same names | Keep all three as type `user`; default to `user-1` and permission `view` |
| Account shape | Four teams, two VPCs for large append seeds; two teams, one VPC for the small boot fixture | Four teams, two VPCs in the large seed | Two teams, one VPC in the development fixture; four/two on append | Four teams, two VPCs in benchmark mode | Use four teams and two VPCs for every complete account |
| IDs | Unpadded, zero-based `account-0-server-0` family | Same family | Same family | Padded and differently ordered IDs | Use the unpadded, zero-based family |
| Large distribution | Deterministic weighted 1..50,000 servers per account using JVM `SplittableRandom` | Fixed 2,000 servers per account | Append-sized accounts | Fixed benchmark account sizes | Preserve the documented weight bands, but use a specified language-neutral unsigned-64-bit generator |
| Recursion | Account chains of four and server chains of eight | Schema supports recursion | Recursive preset exists, boot data does not use it | No canonical recursive seed | Generate bounded chains and an early intentional cycle used by conformance tests |
| Mutation | Append-on-existing seeding | One-time seed | Public development write routes | Browser append controls | Canonical publications are immutable; normal deploys never append or repair accepted data |

The source-state capture binds the exact upstream revisions used for this
reconciliation. The consolidation repository, its generator digest, and its
manifest digest supersede implementation-local fixture assumptions.

## Canonical EACL v8 schema

```zed
definition user {}

definition platform {
  relation super_admin: user
  permission view = super_admin
}

definition account {
  relation owner: user
  relation platform: platform
  relation parent: account
  permission admin = owner + parent->admin + platform->super_admin
  permission view = admin + parent->admin
}

definition team {
  relation account: account
  relation leader: user
  permission admin = account->admin + leader
  permission view = admin
}

definition vpc {
  relation account: account
  relation shared_admin: user
  permission admin = account->admin + shared_admin
  permission view = admin
}

definition server {
  relation account: account
  relation team: team
  relation vpc: vpc
  relation shared_admin: user
  relation parent: server
  permission admin = account->admin + shared_admin
  permission view = admin + parent->view + account->view + team->view + vpc->view + shared_admin
}
```

Whitespace is normalized only by the checked-in schema artifact. Its SHA-256,
not a backend parser's internal representation, is the schema identity.

## Logical object model

The root bundle is always present and contains one resource,
`platform:platform`, three subjects, and one relationship:

- `user:super-user`
- `user:user-1`
- `user:user-2`
- `user:super-user#super_admin@platform:platform`

The cut-point count is a count of logical resources: platform, accounts, teams,
VPCs, and servers. Subjects are counted separately. Schema definitions,
relationships, seed markers, transactions, backend entities, and physical
records are not resources. Therefore “10,000 resources” and “1,000,000
resources” never mean “that many backend rows” or “that many servers.”

Every complete account contains one account, four teams, two VPCs, and its
deterministically selected server count. A cut point may end within an account;
only bundles whose resource object is in the cut are emitted. This is what makes
the 10,000-resource fixture an exact semantic prefix of the million-resource
fixture rather than a separately shaped small dataset.

## Stable IDs

All ordinals are unpadded, lowercase decimal integers starting at zero.

| Type | ID template |
| --- | --- |
| Platform | `platform` |
| Account | `account-{account}` |
| Account owner subject | `account-{account}-owner` |
| Team | `account-{account}-team-{team}` |
| Team leader subject | `account-{account}-team-{team}-leader` |
| VPC | `account-{account}-vpc-{vpc}` |
| VPC shared-admin subject | `account-{account}-vpc-{vpc}-admin` |
| Server | `account-{account}-server-{server}` |

IDs are opaque after generation. Adapters must not pad, case-fold, reorder,
hash, truncate, or substitute backend-native IDs in API responses.

## Deterministic topology

Algorithm version 1 uses seed `20260813`. The first eight accounts form a
fixed conformance prelude with 16 servers each. Subsequent account server counts
use language-neutral SplitMix64-derived integers and the existing large-fixture
weight bands: 55% in 1..2,000, 29% in 2,001..7,500, 12% in
7,501..20,000, and 4% in 20,001..50,000. The generator specification owns the
exact unsigned arithmetic and sampling rules.

Resources and their dependent subjects/relationships are emitted as atomic
logical bundles in this order: root platform, then for each account its account,
four teams, two VPCs, and servers. No relationship refers to an object outside
the selected cut point.

Ordinary account parent chains restart every four accounts. Ordinary server
parent chains restart every eight servers. The conformance prelude additionally
contains one declared two-node server-parent cycle. It is deliberate, finite,
present at both cut points, and must not be “repaired” by an adapter.

`user-1` and `user-2` receive declared early ownership relationships in addition
to each account's generated owner subject. These assignments are based on fixed
account IDs, not seed completion order or proximity to an approximate account
size. `super-user` is a platform super-admin.

## Required semantic examples

The checked-in exemplar artifact owns the exact demands and expected results.
It includes at least:

- direct allow through `owner` and direct deny without a matching relation;
- relationship/permission-arrow allows through account, team, VPC, and parent;
- safe termination and stable decisions through the intentional cycle;
- duplicate relationship input with set/idempotent semantics;
- forward and reverse discovery with stable semantic ordering;
- relationship filters and reverse-subject results;
- exact count and bounded truncation behavior; and
- multi-page traversal whose concatenation equals the unpaged semantic order.

Every exemplar references IDs present in both cut points. The expected decision
is logical and cache-independent.

## Count and digest rules

Each accepted manifest records separate exact counts for:

- subjects by type and total;
- resources by type and total;
- schema definitions, relations, and permissions;
- unique logical relationships by relation and total;
- generated record bundles and serialized bytes; and
- optional backend physical counts in a separate, backend-qualified section.

The fixture digest is computed over the canonical UTF-8 JSON Lines record
stream using LF line endings and exactly one terminal LF. The manifest has its
own canonical digest and binds the schema digest, generator source digest,
algorithm version, seed, cut point, counts, exemplar digest, and fixture digest.
Backend-native serialization is never substituted for this digest.

## Publication and migration consequences

- Accepted fixture manifests are immutable and published blue-green under a new
  data lifecycle ID.
- Partial, duplicate, dangling, schema-mismatched, wrong-cut-point, or
  digest-mismatched imports fail closed and are not made serving-ready.
- The existing Datahike/S3 million-server store remains a separately identified
  legacy lifecycle until its objects and relationships are mapped and verified.
- Normal `main` deployment jobs may verify an accepted lifecycle but cannot
  seed, append, migrate, or mutate it.
- In-memory and browser profiles rebuild from the same generator and verify the
  accepted manifest before reporting readiness.
