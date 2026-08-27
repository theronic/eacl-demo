# EACL demo qualification report

Overall result: **PASS**

## Identity

| Field | Value |
| --- | --- |
| profileId | `datomic-dynamodb` |
| demoSha | `c31dd870ba056c3edf89104ff444c80bfc76496c` |
| eaclSha | `8dc3b16498788dd822b68e1c4fe25b37a8e8879f` |
| artifactSha256 | `0527cfc5f6304da447a4b08c7c21d8f4820f497b4b275fab2bb4aedfc97afb02` |
| deploymentId | `demos:c31dd870ba056c3edf89104ff444c80bfc76496c:datomic-dynamodb` |
| dataManifestSha256 | `718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0` |

## Contract cases

Passed: **17** · Failed: **0** · Unsupported: **1**

> Unsupported means the profile did not advertise the capability. It is not a failed behavior check.

| Status | Category | Case | Duration (ms) | Reason |
| --- | --- | --- | ---: | --- |
| passed | identity | bootstrap-identity | 778.375 | — |
| passed | contract | health-ready | 727.105 | — |
| passed | authorization | authorization-direct-owner-allow | 255.191 | — |
| passed | authorization | authorization-direct-owner-deny | 247.042 | — |
| passed | authorization | authorization-platform-arrow-relation-allow | 259.61 | — |
| passed | authorization | authorization-team-arrow-permission-allow | 247.567 | — |
| passed | authorization | authorization-vpc-relation-allow | 250.935 | — |
| passed | authorization | authorization-recursive-parent-allow | 253.284 | — |
| passed | authorization | authorization-cycle-allow-terminates | 250.411 | — |
| passed | authorization | authorization-cycle-deny-terminates | 261.196 | — |
| passed | relationship | relationship-filter-and-shape | 242.983 | — |
| passed | relationship | reverse-relationship-discovery | 249.544 | — |
| passed | pagination-cursor | pagination-cursor-scope | 848.871 | — |
| passed | cache | cache-semantic-equivalence | 817.278 | — |
| passed | consistency | advertised-consistency-modes | 490.905 | — |
| passed | consistency-failure | unsupported-consistency-rejection | 241.728 | — |
| passed | failure-redaction | validation-failure-redaction | 251.93 | — |
| unsupported | cleanup | cancellation-cleanup | 0 | This transport does not expose an initial-qualification cleanup probe. |

