# Qualification harness

This package drives the same profile contract through local transports and each exact alias-qualified Lambda Function URL. Reports retain exact profile, demo, EACL Core, artifact, deployment, and data identities; authorization headers and credentials are never serialized.

Initial/material-change qualification is intentionally separate from the ordinary `demos` merge smoke. Unsupported descriptor capabilities are reported as `unsupported`, while advertised behavior that does not pass is `failed`.

`renderQualificationReports` produces stable JSON for machines and a Markdown summary for humans from the same validated report object. The Markdown status tables keep `unsupported` rows distinct from `failed` rows, and both formats recursively redact credential-shaped fields and local paths before publication. `writeQualificationReports` writes both forms atomically.

Initial enablement uses a fail-closed gate. A profile remains non-enabled unless a direct Function URL run covers every common qualification category, exact report/descriptor/deployment identities agree, representative workloads pass, the tested transport is released, the evidence postdates the immutable deployment, and a content-addressed observability-readiness record matches the same deployment. That record requires bounded structured/redaction-audited logs, the closed runtime signal set, profile/resource-scoped action-enabled SNS-to-Telegram alarms in `OK`, a ready dashboard and runbook, and passing health/bootstrap/exemplar synthetics. A boolean readiness flag is rejected. The gate's content-addressed evidence ID binds the deployment, qualification, workload, and observability records and never mutates the input registry.

`runObservabilitySynthetics` is the canonical bounded synthetic set. It runs
exactly health, bootstrap identity, and one frozen authorization decision through
the staged CloudFront profile route. It fails closed on route/identity drift or
semantic disagreement and returns the exact records consumed by observability
readiness; it never accepts a direct Function URL origin.

Ordinary merge smoke is deliberately bounded to five probes: health, bootstrap identity, one allowed decision, one denied decision, and denial of a public `seed` mutation route. Before live-alias promotion, the report binds the exact candidate staging CloudFront origin/path, timestamps, complete deployment/data identity, closed case set, and a content digest. A direct Function URL cannot substitute for the CloudFront path. After promotion, a separate bounded production health/bootstrap identity recheck confirms that the live alias resolves the same immutable deployment. The smoke does not invoke full qualification or load diagnostics.

The HTTP harness assigns every probe a bounded `x-eacl-request-id`, includes it in any staged-origin authorization input, and rejects a response whose request ID or operation differs. The qualification runner then requires the immutable deployment identity in every success or failure envelope. Merge authorization decisions must also echo the exact subject/resource/permission scope, so a valid boolean from another request cannot satisfy the gate.

Public status production is separate from the low-level record encoder. Initial enablement can produce an enabled publication only through the full qualification/workload/observability gate. An ordinary update requires an already-enabled profile, a sealed passing candidate staging merge-smoke report, and a later sealed passing production health/bootstrap recheck bound to the same deployment. The publication gate uses a composite content digest of both reports and the deployment. A failed attempt retains the previous deployment identity and records only the attempted immutable source/artifact identity. Publication preparation scopes the write to one exact profile key and retains prior alias revision plus S3 ETag/version coordinates for conditional rollback.

The ordinary-workflow policy rejects fleet coordination (concurrency, cancellation, `max-parallel`, reusable/cross-workflow dispatch, or cross-target `needs`) and deep or stateful test terms. It permits only a same-target `build-<target>` to `deploy-<target>` handoff: the build job has no OIDC, uploads a pinned-action artifact, and the credentialed deploy job downloads and digest-checks it without installing dependencies or rebuilding. It requires a `demos` push trigger and bounded merge-smoke invocation. A companion assertion proves the independently retained EACL formal workflow neither gates nor dispatches the demo workflow; the EACL workflow itself is left untouched.

Manual assurance remains executable but isolated from ordinary deployment.
The runtime exercise produces one content-addressed record for bounded staged
load, a closed six-case HTTP/cancellation fault campaign plus recovery, or
exact-version Lambda memory observations. Memory evidence validates the
published function version and code digest before parsing the per-invocation
Lambda `REPORT` record; no shared time-window average can hide a peak, and the
report identifies the direct immutable Lambda version rather than claiming the
samples traversed CloudFront. The runtime and architecture are bound to the
closed profile platform. Zero-error load and exact-version memory stop after
their first decisive failure, while each HTTP request retains its own deadline.
The
transition workflow uses only a dedicated `exercise` alias, an optimistic
revision precondition, staged five-case smoke for both identities, and
unconditional exact restore; migration moves to a higher numeric version and
rollback to a lower one. Seed and durable-generation workflows remain
separately typed and cost-gated. A workflow definition or local policy pass is
not evidence that any external exercise ran.
