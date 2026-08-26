# Canonical logical fixture counts

These are logical EACL demo counts produced by `eacl-demo-fixture-v1`. They are
independent of storage encoding. The checked-in manifests are the
machine-readable authority.

## Schema

Both cut points use exactly the same schema.

| Measure | Count |
| --- | ---: |
| Definitions | 6 |
| Relations | 13 |
| Permissions | 9 |

Definitions are `user`, `platform`, `account`, `team`, `vpc`, and `server`.
Relations and permissions are counted from their declarations, not from
compiled parser nodes or backend schema attributes.

## Objects

| Logical measure | 10,000 cut | 1,000,000 cut |
| --- | ---: | ---: |
| Subjects, total | 80 | 1,585 |
| `user` subjects | 80 | 1,585 |
| Resources, total | 10,000 | 1,000,000 |
| `platform` resources | 1 | 1 |
| `account` resources | 11 | 226 |
| `team` resources | 44 | 904 |
| `vpc` resources | 22 | 452 |
| `server` resources | 9,922 | 998,417 |
| Logical objects, total | 10,080 | 1,001,585 |

“Subject” is the fixture role of generated `user` objects. Accounts, teams,
VPCs, servers, and the platform remain resources even when one is the subject
side of a relationship tuple. An object is counted once, not once per role it
plays in authorization traversal.

## Unique logical relationships

| Relation | 10,000 cut | 1,000,000 cut |
| --- | ---: | ---: |
| `account` | 9,988 | 999,773 |
| `leader` | 44 | 904 |
| `owner` | 13 | 228 |
| `parent` | 8,690 | 873,694 |
| `platform` | 11 | 226 |
| `shared_admin` | 22 | 452 |
| `super_admin` | 1 | 1 |
| `team` | 9,922 | 998,417 |
| `vpc` | 9,922 | 998,417 |
| Total | 38,613 | 3,872,112 |

The duplicate-touch exemplar does not add a second logical relationship.
Relationship totals describe the accepted set after idempotent application.

## Canonical stream measures

| Measure | 10,000 cut | 1,000,000 cut |
| --- | ---: | ---: |
| Resource bundles | 10,000 | 1,000,000 |
| Object plus relationship records | 48,693 | 4,873,697 |
| Canonical semantic-record bytes | 6,753,401 | 690,297,485 |

The byte count excludes the one fixture header line. It describes canonical
NDJSON and is not a storage-size estimate.

## Physical backend counts are separate

A backend qualification may add a `physicalCounts` evidence document. It must
bind the profile, storage lifecycle, fixture manifest digest, data lifecycle
ID, deployment ID, native basis/revision, measurement operation, and timestamp.
Its metric names are backend-qualified, for example:

- Datomic entities, current datoms, history datoms, and index bytes;
- Datahike entities/datoms plus S3 object count/bytes or DynamoDB item count and
  table/index bytes;
- Datalevin LMDB entries/pages/mapped bytes;
- DataScript datoms and browser heap estimate; or
- Jank in-memory entities/datoms and process memory.

Physical measures must not appear in `counts.objects`, `counts.relationships`,
or a UI label claiming logical resources. They are neither expected to agree
between backends nor used to decide whether the fixture reached its cut point.
Only the manifest's logical counts and semantic digest decide that.
