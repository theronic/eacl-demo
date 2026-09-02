# EACL demo qualification report

Overall result: **PASS**

## Identity

| Field | Value |
| --- | --- |
| profileId | `datomic-dynamodb` |
| demoSha | `6d258e75c8fceeb6017aa77b7f73a79bc0542afd` |
| eaclSha | `8dc3b16498788dd822b68e1c4fe25b37a8e8879f` |
| artifactSha256 | `3362ebce85a93479e0f15f284b2f6508044b947b281fdcb28bea0cdc12a263db` |
| deploymentId | `demos:6d258e75c8fceeb6017aa77b7f73a79bc0542afd:datomic-dynamodb` |
| dataManifestSha256 | `718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0` |

## Contract cases

Passed: **17** · Failed: **0** · Unsupported: **1**

> Unsupported means the profile did not advertise the capability. It is not a failed behavior check.

| Status | Category | Case | Duration (ms) | Reason |
| --- | --- | --- | ---: | --- |
| passed | identity | bootstrap-identity | 772.234 | — |
| passed | contract | health-ready | 687.263 | — |
| passed | authorization | authorization-direct-owner-allow | 245.791 | — |
| passed | authorization | authorization-direct-owner-deny | 238.719 | — |
| passed | authorization | authorization-platform-arrow-relation-allow | 445.476 | — |
| passed | authorization | authorization-team-arrow-permission-allow | 281.025 | — |
| passed | authorization | authorization-vpc-relation-allow | 255.336 | — |
| passed | authorization | authorization-recursive-parent-allow | 273.05 | — |
| passed | authorization | authorization-cycle-allow-terminates | 284.938 | — |
| passed | authorization | authorization-cycle-deny-terminates | 244.466 | — |
| passed | relationship | relationship-filter-and-shape | 362.751 | — |
| passed | relationship | reverse-relationship-discovery | 249.788 | — |
| passed | pagination-cursor | pagination-cursor-scope | 3055.501 | — |
| passed | cache | cache-semantic-equivalence | 721.411 | — |
| passed | consistency | advertised-consistency-modes | 278.915 | — |
| passed | consistency-failure | unsupported-consistency-rejection | 237.605 | — |
| passed | failure-redaction | validation-failure-redaction | 242.298 | — |
| unsupported | cleanup | cancellation-cleanup | 0 | This transport does not expose an initial-qualification cleanup probe. |

