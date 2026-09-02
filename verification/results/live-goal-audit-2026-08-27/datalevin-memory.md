# EACL demo qualification report

Overall result: **PASS**

## Identity

| Field | Value |
| --- | --- |
| profileId | `datalevin-memory` |
| demoSha | `6d258e75c8fceeb6017aa77b7f73a79bc0542afd` |
| eaclSha | `8dc3b16498788dd822b68e1c4fe25b37a8e8879f` |
| artifactSha256 | `317173a7c8b7b255ea235d66744d8af4fce141c31a926bfc174a8c9b906b048d` |
| deploymentId | `demos:6d258e75c8fceeb6017aa77b7f73a79bc0542afd:datalevin-memory` |
| dataManifestSha256 | `b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a` |

## Contract cases

Passed: **17** · Failed: **0** · Unsupported: **1**

> Unsupported means the profile did not advertise the capability. It is not a failed behavior check.

| Status | Category | Case | Duration (ms) | Reason |
| --- | --- | --- | ---: | --- |
| passed | identity | bootstrap-identity | 764.775 | — |
| passed | contract | health-ready | 706.064 | — |
| passed | authorization | authorization-direct-owner-allow | 267.863 | — |
| passed | authorization | authorization-direct-owner-deny | 248.133 | — |
| passed | authorization | authorization-platform-arrow-relation-allow | 303.771 | — |
| passed | authorization | authorization-team-arrow-permission-allow | 270.835 | — |
| passed | authorization | authorization-vpc-relation-allow | 262.401 | — |
| passed | authorization | authorization-recursive-parent-allow | 265.203 | — |
| passed | authorization | authorization-cycle-allow-terminates | 256.454 | — |
| passed | authorization | authorization-cycle-deny-terminates | 258.518 | — |
| passed | relationship | relationship-filter-and-shape | 707.592 | — |
| passed | relationship | reverse-relationship-discovery | 259.685 | — |
| passed | pagination-cursor | pagination-cursor-scope | 790.148 | — |
| passed | cache | cache-semantic-equivalence | 765.81 | — |
| passed | consistency | advertised-consistency-modes | 253.694 | — |
| passed | consistency-failure | unsupported-consistency-rejection | 237.941 | — |
| passed | failure-redaction | validation-failure-redaction | 248.567 | — |
| unsupported | cleanup | cancellation-cleanup | 0 | This transport does not expose an initial-qualification cleanup probe. |

