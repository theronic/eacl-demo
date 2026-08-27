# EACL demo qualification report

Overall result: **PASS**

## Identity

| Field | Value |
| --- | --- |
| profileId | `datalevin-memory` |
| demoSha | `c31dd870ba056c3edf89104ff444c80bfc76496c` |
| eaclSha | `8dc3b16498788dd822b68e1c4fe25b37a8e8879f` |
| artifactSha256 | `0995bd1ef4387213785b6fab46cdcba667d8ab30cc6de60784c0eccc178f894d` |
| deploymentId | `demos:c31dd870ba056c3edf89104ff444c80bfc76496c:datalevin-memory` |
| dataManifestSha256 | `b537a6755026fbbc36f68289dc0f35d09a7cd965397d67d9380a6f820963294a` |

## Contract cases

Passed: **17** · Failed: **0** · Unsupported: **1**

> Unsupported means the profile did not advertise the capability. It is not a failed behavior check.

| Status | Category | Case | Duration (ms) | Reason |
| --- | --- | --- | ---: | --- |
| passed | identity | bootstrap-identity | 774.925 | — |
| passed | contract | health-ready | 731.396 | — |
| passed | authorization | authorization-direct-owner-allow | 382.842 | — |
| passed | authorization | authorization-direct-owner-deny | 249.604 | — |
| passed | authorization | authorization-platform-arrow-relation-allow | 247.882 | — |
| passed | authorization | authorization-team-arrow-permission-allow | 245.171 | — |
| passed | authorization | authorization-vpc-relation-allow | 248.313 | — |
| passed | authorization | authorization-recursive-parent-allow | 243.054 | — |
| passed | authorization | authorization-cycle-allow-terminates | 251.784 | — |
| passed | authorization | authorization-cycle-deny-terminates | 252.122 | — |
| passed | relationship | relationship-filter-and-shape | 245.637 | — |
| passed | relationship | reverse-relationship-discovery | 240.717 | — |
| passed | pagination-cursor | pagination-cursor-scope | 754.018 | — |
| passed | cache | cache-semantic-equivalence | 822.003 | — |
| passed | consistency | advertised-consistency-modes | 246.855 | — |
| passed | consistency-failure | unsupported-consistency-rejection | 244.607 | — |
| passed | failure-redaction | validation-failure-redaction | 241.303 | — |
| unsupported | cleanup | cancellation-cleanup | 0 | This transport does not expose an initial-qualification cleanup probe. |

