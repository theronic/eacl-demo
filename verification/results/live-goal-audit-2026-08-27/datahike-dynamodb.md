# EACL demo qualification report

Overall result: **PASS**

## Identity

| Field | Value |
| --- | --- |
| profileId | `datahike-dynamodb` |
| demoSha | `6d258e75c8fceeb6017aa77b7f73a79bc0542afd` |
| eaclSha | `8dc3b16498788dd822b68e1c4fe25b37a8e8879f` |
| artifactSha256 | `7bbbc21e2aa6bd4fc70f442da413dfcd06f6c7d80cd2e61437f605db4c9631a6` |
| deploymentId | `demos:6d258e75c8fceeb6017aa77b7f73a79bc0542afd:datahike-dynamodb` |
| dataManifestSha256 | `718ab977cb401db80329e560723e181578469d6ae360641ef3ea620ab370cfb0` |

## Contract cases

Passed: **17** · Failed: **0** · Unsupported: **1**

> Unsupported means the profile did not advertise the capability. It is not a failed behavior check.

| Status | Category | Case | Duration (ms) | Reason |
| --- | --- | --- | ---: | --- |
| passed | identity | bootstrap-identity | 801.824 | — |
| passed | contract | health-ready | 755.951 | — |
| passed | authorization | authorization-direct-owner-allow | 268.432 | — |
| passed | authorization | authorization-direct-owner-deny | 285.694 | — |
| passed | authorization | authorization-platform-arrow-relation-allow | 344.314 | — |
| passed | authorization | authorization-team-arrow-permission-allow | 291.141 | — |
| passed | authorization | authorization-vpc-relation-allow | 273.847 | — |
| passed | authorization | authorization-recursive-parent-allow | 323.239 | — |
| passed | authorization | authorization-cycle-allow-terminates | 268.363 | — |
| passed | authorization | authorization-cycle-deny-terminates | 279.036 | — |
| passed | relationship | relationship-filter-and-shape | 324.24 | — |
| passed | relationship | reverse-relationship-discovery | 281.158 | — |
| passed | pagination-cursor | pagination-cursor-scope | 27976.47 | — |
| passed | cache | cache-semantic-equivalence | 795.079 | — |
| passed | consistency | advertised-consistency-modes | 270.324 | — |
| passed | consistency-failure | unsupported-consistency-rejection | 241.321 | — |
| passed | failure-redaction | validation-failure-redaction | 241.264 | — |
| unsupported | cleanup | cancellation-cleanup | 0 | This transport does not expose an initial-qualification cleanup probe. |

