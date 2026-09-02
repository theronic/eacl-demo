# EACL demo qualification report

Overall result: **PASS**

## Identity

| Field | Value |
| --- | --- |
| profileId | `datahike-s3` |
| demoSha | `6d258e75c8fceeb6017aa77b7f73a79bc0542afd` |
| eaclSha | `8dc3b16498788dd822b68e1c4fe25b37a8e8879f` |
| artifactSha256 | `d93edbc098fffb6e92451f3ff922b795461412ffef25e68096d9875cf492f6a7` |
| deploymentId | `demos:6d258e75c8fceeb6017aa77b7f73a79bc0542afd:datahike-s3` |
| dataManifestSha256 | `a97c5b2ecac32012bdd37963348d840c5d405ad2858c0136eb17006ba97167b8` |

## Contract cases

Passed: **16** · Failed: **0** · Unsupported: **1**

> Unsupported means the profile did not advertise the capability. It is not a failed behavior check.

| Status | Category | Case | Duration (ms) | Reason |
| --- | --- | --- | ---: | --- |
| passed | identity | bootstrap-identity | 815.058 | — |
| passed | contract | health-ready | 742.96 | — |
| passed | authorization | authorization-direct-owner-allow | 298.364 | — |
| passed | authorization | authorization-direct-owner-deny | 284.739 | — |
| passed | authorization | authorization-platform-arrow-relation-allow | 516.298 | — |
| passed | authorization | authorization-team-arrow-permission-allow | 293.754 | — |
| passed | authorization | authorization-vpc-relation-allow | 297.782 | — |
| passed | authorization | authorization-recursive-parent-allow | 488.727 | — |
| passed | authorization | authorization-recursive-parent-deny | 291.598 | — |
| passed | relationship | relationship-filter-and-shape | 336.893 | — |
| passed | relationship | reverse-relationship-discovery | 445.592 | — |
| passed | pagination-cursor | pagination-cursor-scope | 857.87 | — |
| passed | cache | cache-semantic-equivalence | 855.94 | — |
| passed | consistency | advertised-consistency-modes | 282.684 | — |
| passed | consistency-failure | unsupported-consistency-rejection | 239.463 | — |
| passed | failure-redaction | validation-failure-redaction | 250.433 | — |
| unsupported | cleanup | cancellation-cleanup | 0 | This transport does not expose an initial-qualification cleanup probe. |

