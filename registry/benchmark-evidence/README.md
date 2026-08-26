# Published storage benchmark evidence

Only complete content-addressed evidence JSON belongs here. The initial
directory contains no result because the Datahike/DynamoDB profile and equal
canonical Datahike/S3 lifecycle have not yet qualified; publishing fabricated
latencies would be worse than having no default claim.

`scripts/publish-benchmark-evidence.mjs` validates exact fixture, workload,
source, service-code, environment, cache-lane, memory, qualification, sample,
error, expiry, and decision bindings before adding a file summary and recomputed
storage decision to the public registry. The evidence ID is recomputed from
canonical content, excluding only its own `evidenceId` member.

Missing, stale, unresolved, or absent comparable evidence leaves the first
qualified profile in canonical profile order as the stable fallback with
`claim: null`. A primary statistically separated winner may carry
`fastest-qualified`; a cold/cost tie-break carries only `benchmark-selected`.
