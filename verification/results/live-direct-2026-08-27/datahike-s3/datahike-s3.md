# EACL demo qualification report

Overall result: **PASS**

## Identity

| Field | Value |
| --- | --- |
| profileId | `datahike-s3` |
| demoSha | `c31dd870ba056c3edf89104ff444c80bfc76496c` |
| eaclSha | `8dc3b16498788dd822b68e1c4fe25b37a8e8879f` |
| artifactSha256 | `ae85e3262b31ed8377603bd9fcee88e1d2084265aa0f2dd627b6fd2321e34656` |
| deploymentId | `demos:c31dd870ba056c3edf89104ff444c80bfc76496c:datahike-s3` |
| dataManifestSha256 | `a97c5b2ecac32012bdd37963348d840c5d405ad2858c0136eb17006ba97167b8` |

## Contract cases

Passed: **16** · Failed: **0** · Unsupported: **1**

> Unsupported means the profile did not advertise the capability. It is not a failed behavior check.

| Status | Category | Case | Duration (ms) | Reason |
| --- | --- | --- | ---: | --- |
| passed | identity | bootstrap-identity | 9937.881 | — |
| passed | contract | health-ready | 767.547 | — |
| passed | authorization | authorization-direct-owner-allow | 957.957 | — |
| passed | authorization | authorization-direct-owner-deny | 295.759 | — |
| passed | authorization | authorization-platform-arrow-relation-allow | 590.006 | — |
| passed | authorization | authorization-team-arrow-permission-allow | 284.529 | — |
| passed | authorization | authorization-vpc-relation-allow | 282.432 | — |
| passed | authorization | authorization-recursive-parent-allow | 533.917 | — |
| passed | authorization | authorization-recursive-parent-deny | 331.147 | — |
| passed | relationship | relationship-filter-and-shape | 345.395 | — |
| passed | relationship | reverse-relationship-discovery | 422.107 | — |
| passed | pagination-cursor | pagination-cursor-scope | 873.121 | — |
| passed | cache | cache-semantic-equivalence | 844.757 | — |
| passed | consistency | advertised-consistency-modes | 289.435 | — |
| passed | consistency-failure | unsupported-consistency-rejection | 243.822 | — |
| passed | failure-redaction | validation-failure-redaction | 259.344 | — |
| unsupported | cleanup | cancellation-cleanup | 0 | This transport does not expose an initial-qualification cleanup probe. |

