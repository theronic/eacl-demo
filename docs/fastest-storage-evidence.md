# Fastest-storage evidence

`eacl-demo.fastest-storage-evidence.v1` is a content-addressed comparison, not a
free-standing speed claim. Its ID is recomputed over canonical evidence content
with only `evidenceId` omitted.

An accepted Datahike record binds both candidates to the exact deployment ID and million-resource
fixture and manifest, operation/cache-lane workload, demo and EACL SHAs,
service-code digest, `explorer.v1`, region, Java runtime, architecture, memory,
SnapStart mode, timeout, ephemeral storage, qualifying evidence and expiry.
Only profile/storage identity, artifact packaging, storage lifecycle, and
storage resource may differ. Candidate arrays, results, and all enabled choices
must have exactly the same profile set.

Memory qualification is still independent: each storage first proves its own
lowest passing value. A live comparative claim then uses the larger of those
two minima as the smallest common memory for both profiles, so compute capacity
does not decide a storage ranking. The initial method binds `SnapStart=None`
because both current Datahike templates disable it. `PublishedVersions` is
permitted only after both storage profiles separately qualify the same restore
lifecycle; changing that shared state expires and reruns the evidence.

Evidence requires 30 verified cold/restore environments, 30 warm waves per
lane, concurrency 1 and 8, 10,000 bootstrap resamples, zero correctness or
availability errors, complete sample counts, confidence intervals, cost, and
the versioned decision rule. Candidate qualification must remain passing for
the evidence's complete lifetime.

A statistically separated effect of at least 5% on the primary cache-disabled
warm score produces `claim: fastest-qualified`. Overlapping/tolerance results
use lower cold/restore p95 and then projected cost, but the resulting claim is
only `benchmark-selected`. An unresolved, missing, malformed, incomparable, or
expired result cannot choose a benchmark default.

With no current comparable result, canonical profile order supplies a stable
qualified fallback—S3 for Datahike—with `claim: null`. With one qualified
storage it is selected as `sole-qualified`; with none there is no usable
default. This preserves availability after evidence expiry without describing
an untested alternative as slower.

The adopted Datahike/S3 store is not comparable to the canonical DynamoDB
fixture: it contains one million server entities plus ancillary resources,
whereas the canonical cut point contains one million total resources. It must
retain that honest distinct identity. Comparable benchmarking remains blocked
until a separately authorized, separately costed, blue-green S3 generation is
seeded and verified from the canonical fixture. Existing DynamoDB seed approval
does not authorize that S3 operation. Until then, even if both profiles are
qualified, the browser uses the deterministic S3 fallback with no speed claim.

Published evidence JSON lives under `registry/benchmark-evidence/`. A separate
content-addressed `index.v1.json` exposes each raw file digest, content evidence
ID, timestamp, expiry, and profiles. The browser loads the index and evidence
through bounded no-store same-origin HTTPS requests, verifies both content
layers, and recomputes the decision. Evidence is immediately ineligible if
either active profile's demo SHA, EACL SHA, artifact digest, deployment ID, or
data-manifest digest differs. A summary without the exact validated evidence
file is rejected, and a partial evidence failure falls back without a speed
claim rather than disabling unrelated profiles.
