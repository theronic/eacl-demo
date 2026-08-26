# Datahike S3 versus DynamoDB benchmark

This benchmark answers one narrow question: which qualified storage profile is
faster for the same Datahike backend under the deployed explorer workload? It
does not rank Datahike against another backend and does not compare the
10,000-resource in-memory profiles with million-resource durable profiles.

## Comparability gate

Both candidates must bind the same demo SHA, EACL Core SHA, dependency locks,
schema/exemplar/generator identities, million-resource manifest, region,
`explorer.v1` revision, Java 25 managed runtime, arm64 architecture, a common
qualified SnapStart mode, memory, timeout, ephemeral storage, service configuration, request
schedule, cache lane, concurrency, and measurement harness. The chosen memory
is the larger of the two independently established lowest-qualified values so
neither candidate is disadvantaged. Only the closed storage configuration and
storage-specific AWS resource identity may differ.

The initial comparison uses `SnapStart=None`, matching both current runtime
templates. AWS platform availability is not qualification: a later switch to
`PublishedVersions` requires both published arm64 profiles to pass their restore
lifecycle and semantic tests, then invalidates and reruns the benchmark.

Every candidate must already report the exact canonical fixture digest
`sha256:102bb7c51779bb66ab343dabff42019af95f99bded708e214b13fd56ab3bf33c`
and 1,000,000 logical resources. Existing legacy million-server data is not an
equal fixture unless its canonical mapping has passed separately.

## Execution

Each 100-request wave contains exactly the operation weights in
`workload.v1.json`. Copies are ordered by sorting SHA-256 of
`seed NUL wave NUL operation-id NUL copy-ordinal`, with the operation ID and
copy ordinal as deterministic tie breakers. The same materialized wave is sent
to each profile in deterministic interleaved ABBA order.

Warm lanes have 30 measured waves at concurrency 1 and 8 after their declared
prewarm. The primary lane disables the EACL result cache in identical
benchmark-only aliases so it measures storage-backed execution. The enabled
cache lane records realistic repeated behavior but cannot decide the storage
winner by itself.

The cold/restore lane accepts 30 first `bootstrap` responses from 30 distinct
CloudWatch log streams whose reports prove initialization or SnapStart restore.
A burst that reuses a warm environment is not silently labeled cold. SnapStart
and provisioned concurrency are not mixed.

No measured request is silently retried. Timeouts, throttling, non-2xx replies,
contract failures, basis/identity mismatches, and invalid waves remain in the
evidence. An infrastructure-invalid wave may be repeated only as an additional
wave with both the original and replacement reported.

## Winner rule and uncertainty

The primary score is the exact operation-weighted service p95 in the
cache-disabled lane, with concurrency 1 and 8 weighted equally. Client,
CloudWatch duration, cache-enabled, cold/restore, error, throttle, and cost
measurements are also published.

Paired run-level scores use 10,000 deterministic bootstrap resamples for a 95%
interval. A primary winner requires complete comparability, all qualifications,
all sample counts, acceptable errors, an interval favoring one candidate, and
at least a 5% effect. Within the declared uncertainty/tolerance, lower verified
cold/restore first-result p95 is the first tie breaker and lower projected
monthly cost is second. If those gates cannot choose truthfully, the evidence
reports a tie and the registry makes no comparative speed claim.
