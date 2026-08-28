# EACL demo release report

Report ID: `sha256:d32142e50b6260eba22e317d5761ad9d876a9a4f96d3c6687750cfc7ed84d76e`

Status: **pre-release**. This is an honest readiness report, not evidence that a production release exists. Local infrastructure definitions are never described as deployed or verified without live evidence.

## Report-build source identity

| Source | Status | Immutable SHA |
| --- | --- | --- |
| Demo | uncommitted | — |
| EACL Core | locked | 11114f59fa57fe87c5b7ab412b3123a9c8a1a862 |

This source pair identifies the report build, not a fleet generation. Every profile deployment below is independently authoritative and may come from a different demos-branch run.

## Profiles

| Profile | Availability | Artifact SHA-256 | Fixture resources | Memory | Alarms | Rollback |
| --- | --- | --- | ---: | --- | --- | --- |
| datahike-s3 | qualifying | — | 1,000,000 | 1024 MiB candidate; unqualified | defined-not-deployed | unavailable |
| datahike-dynamodb | unavailable | — | 1,000,000 | 1024 MiB candidate; unqualified | defined-not-deployed | unavailable |
| datomic-dynamodb | disabled | — | 1,000,000 | 1024 MiB candidate; unqualified | defined-not-deployed | unavailable |
| datalevin-memory | unavailable | — | 10,000 | 1024 MiB candidate; unqualified | defined-not-deployed | unavailable |
| jank-memory | unavailable | — | 10,000 | 4096 MiB candidate; unqualified | defined-not-deployed | unavailable |
| datascript-browser-memory | qualifying | — | 10,000 | browser-managed | not-applicable | unavailable |

Candidate memory values are template starting points only. No profile has a qualified memory setting or memory evidence ID.

## Storage defaults

| Backend | Outcome | Default profile | Evidence | Reason |
| --- | --- | --- | --- | --- |
| datahike | none | — | — | No qualified storage choice is enabled. |
| datomic | none | — | — | No qualified storage choice is enabled. |
| datalevin | none | — | — | No qualified storage choice is enabled. |
| jank | none | — | — | No qualified storage choice is enabled. |
| datascript | none | — | — | No qualified storage choice is enabled. |

No performance superlative is claimed: the benchmark evidence set is empty.

## Fixtures

| Logical resources | Manifest SHA-256 | Fixture SHA-256 |
| ---: | --- | --- |
| 10,000 | sha256:b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a | sha256:ec47ae57973bc7e9c580709410e530a7ac64acd24c01f9e3161489e8ebd58dfd |
| 1,000,000 | sha256:718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0 | sha256:102bb7c51779bb66ab343dabff42019af95f99bded708e214b13fd56ab3bf33c |

## Cost controls and notifications

DynamoDB controls: defined-not-deployed; 9 alarm definitions per table. Telegram routing: defined-not-verified. Cost anomaly threshold: $5 (defined-not-deployed).

| Budget | Default amount | Thresholds | Status |
| --- | ---: | --- | --- |
| monthly-project | $25 | 50 / 80 / 100% | defined-not-deployed |
| seed | $15 | 50 / 80 / 100% | defined-not-deployed |

## Blocking evidence

- `release-identity-unavailable`: There is no deployed release manifest with an immutable demo source and artifact set. Required evidence: A successful demos-branch deployment release manifest and its content digest.
- `profiles-not-enabled`: Every registered profile remains disabled, qualifying, or unavailable. Required evidence: Profile-specific qualification, deployment identity, and successful publication evidence.
- `live-cost-controls-unverified`: Budget, alarm, anomaly, and Telegram definitions have no live readiness evidence in this report. Required evidence: Deployed resource identities, OK alarm state, enabled actions, and a successful Telegram delivery test.
- `rollback-coordinates-unavailable`: No profile has exact prior and active publication coordinates. Required evidence: Immutable alias revisions or static prefixes plus versioned status-object rollback coordinates.
