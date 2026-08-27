# `jank-memory`

Linux x86_64 Amazon Linux 2023 custom-runtime ZIP with executable root
`bootstrap` and the bundled immutable in-memory Datomic-like conformance store.
SnapStart is unsupported and must remain absent from Lambda configuration.
The profile is deliberately unavailable: its vendored Jank-compatible EACL
port is content-bound but still based on Core `1cbf80c7`. Its semantic-rebase
assurance evidence stops at Core `8dc3b164`, which is also older than the
repository's current required release Core. Neither assurance identity is
runtime source identity. Promotion therefore fails until the port and its
complete coverage evidence are updated to the required Core semantics and all
Linux gates pass.

The rebase is tracked as explicit semantic deltas rather than a premature SHA
rewrite. The locked-Core split between cache lookup (`:cache?`) and cache
publication (`:populate-cache?`) is implemented and exercised by a native Jank
memory-store regression: bypass dominates publication, while read-only cache
requests may hit but never install result artifacts. The remaining Core delta
is still unqualified. The locked-Core sealed-plan read-scope guard is also
ported: an independent traversal derives the permission's allowed relation
closure, and executable rules outside it are rejected before use. These
incremental proofs do not change the older runtime baseline or make the
profile deployable. Locked-Core validation identities for execution contracts,
cancellation, unsupported consistency, and permission-tree requests are also
covered by process-isolated rejection fixtures, so compiler unwinding cannot
silently turn a typed failure into passing evidence.

Completeness is fail-closed in
`dependencies/jank-core-rebase-coverage.v1.json`: all 33 runtime paths changed
between the runtime baseline and the audited `8dc3b164` assurance target are
present under a digest captured from that exact diff, and every path is
classified as verified, partial, unqualified, or not applicable with a
rationale. Any partial or unqualified entry keeps that rebase incomplete, and
the later delta from `8dc3b164` to the required release Core remains uncovered.

The compiler builder is source-pinned in
`dependencies/jank-linux-x86_64-builder.v1.json` and runs inside the exact
amd64 Amazon Linux 2023 image in
`infra/builders/jank-al2023-x86_64.Dockerfile`. Upstream currently exercises
its Linux release on an x86_64 Ubuntu 24.04 runner, but the Lambda binary is
compiled inside AL2023 so it cannot accidentally acquire a newer Ubuntu glibc
floor. The builder remains unqualified until that image is actually built and
its digest recorded; the macOS arm64 development installation is never an
accepted fallback.

Native dependency policy is closed: direct AL2023 build packages use exact
NEVRAs from the immutable repository snapshot embedded in the base image;
Jank, its fourteen Git submodules, and its LLVM 23 fork use exact commits; and
the Dockerfile builds/installs the local LLVM closure before compiling any demo
code. A published builder tag is never sufficient evidence by itself—the
workflow records and consumers pin the resulting image digest. Lambda ZIP QA
must reject non-ELF, non-x86_64, glibc newer than 2.34, unexpected `DT_NEEDED`
libraries, missing license/resource files, and any SnapStart setting.
The exact Lambda base digest already provides the three direct adapter SONAMEs
and its compatible C++ runtime; their owning NEVRAs are recorded in the lock,
so the minimal ZIP deliberately packages no duplicate shared libraries.

The reviewed compatibility source now lives under `src/` so future Linux
builds do not depend on an uncommitted sibling checkout. Its path/size/content
aggregate and the version mismatch are closed by
`dependencies/jank-engine-port.v1.json`; changing any source byte requires a
deliberate lock update. The deployed source identity will be the immutable
`eacl-demo` commit containing that tree, never the pre-import local checkout.

A future arm64 build is a separate migration. It must independently qualify
the Jank compiler, every native dependency, the AL2023 package, Lambda runtime
behavior, and price/performance before the runtime template can change.

## Runtime implementation

The custom runtime uses Lambda's Runtime API directly through the bounded
native adapter in `native/runtime_api.hpp`; it does not start an HTTP server.
Function URL payload-v2 events pass the shared five-case contract fixture and
then a production wrapper accepts only `/*`. The dispatcher
contains exactly the ten explorer read operations. Seed, setup, transaction,
cache-eviction, benchmark, debug, and LAN-server names are absent from its
handler table.

Initialization reads the canonical 10,000-resource NDJSON stream once. It
verifies schema, exemplar, manifest, fixture, and semantic digests; exact
object/subject/resource/relationship totals; duplicate identities; and all
relationship references before publishing readiness. The 10,080 catalog
objects and 38,613 relationships are then installed through two explicitly
bounded initialization-only transitions. Each relationship is represented by
the same paired forward/reverse endpoint values and relation-version stamps
used by EACL reads. Only the final immutable serving basis is retained. All 14
canonical semantic exemplars must pass before the store is exposed.

This bulk path is an implementation seam, not a public transaction API. It is
single-threaded, capped at 80,000 forms, refuses concurrent publication, and is
unreachable from the closed dispatcher. The returned client still contains a
connection internally because EACL's read API requires it; callers receive no
code-execution or mutation route through the HTTP contract.

Subject pagination uses process-local authenticated/encrypted EACL cursors
bound to the profile, operation, query fingerprint, source scope, immutable
basis, schema generation, ordering ABI, dependency proof, and lifecycle token.
Relationship pagination uses the same EACL read layer. Public request work is
bounded by the 64 KiB input, 1 MiB output, 100-row page, one-million count,
single-admission, and 10-second deadline limits.

The custom runtime emits the same closed `eacl-demo.runtime-telemetry.v1`
CloudWatch EMF signal set as the JVM services. It logs only stable
profile/function dimensions plus bounded deployment, request, operation,
outcome, and closed error identity. It never copies request bodies, response
data, raw paths, exception messages/stacks, fixture paths, or credentials.
Telemetry records are capped at 8 KiB, emission failure cannot change an
initialization or invocation result, and `Restore=0` is explicit because this
OS-only runtime does not support SnapStart. This source-level integration does
not qualify deployed alarms, native fatal-OOM reporting, or the Linux Lambda
artifact; those remain part of the external lifecycle and memory gates.

## Deterministic candidate build

`npm run plan:jank-memory` is safe on any developer host and prints the exact
platform, source identities, package closure, and current promotion blockers.
The actual build requires `EACL_JANK_BUILDER_IMAGE` in immutable
`ghcr.io/theronic/eacl-demo-jank-builder@sha256:...` form. While the lock is
unqualified, `EACL_JANK_QUALIFICATION_BUILD=1` is also mandatory and the
result is permanently labelled `qualification-only`.

The builder runs with networking disabled, compiles
`eacl-demo.jank-memory.main` using the static Jank runtime at optimization
level 3, links the exact AL2023 curl/json-c/OpenSSL adapter libraries, and
rejects a non-ELF64 or non-x86_64 result. Packaging admits only root
`bootstrap`, the five fixture/schema resources, the runtime manifest, and the
two EACL license/notice files plus a deterministic third-party license bundle
collected from the exact Jank/LLVM/submodule sources and linked AL2023 runtime
packages. The ZIP normalizer rejects duplicate paths,
path traversal, and symlinks, gives only root `bootstrap` mode `0755`, uses
fixed timestamps and stored entries, and emits a sidecar manifest binding the
archive digest to builder, source, native-adapter, runtime-manifest, and
bootstrap digests. The manifest records the vendored EACL tree and the Jank
service adapter as separate content digests in addition to the clean immutable
demo commit, so adapter changes cannot hide behind the larger repository
identity. A clean digest-pinned Lambda AL2023 image must run the
offline self-test before the script succeeds.

## Current measured status

The local macOS arm64 interpreter can validate the adapter and fixture logic,
but it is neither the candidate compiler nor a Lambda performance proxy. A
full 10,000-resource interpreted bootstrap reached semantic verification in
roughly 340–385 seconds and peaked as high as 4,495,114,240 bytes (about 4.19
GiB) RSS. The candidate
template's 4096 MiB default is therefore only an unqualified native-test
starting point, not a fit claim; interpreted macOS memory does not predict the
AOT Linux result. The template permits the full current Lambda range from 128
through 10,240 MiB in one-MiB increments so qualification can select the
smallest measured fit instead of an arbitrary preset. Repeated AL2023 x86_64
native measurements are required before choosing memory or enabling the
profile.

The exact repetitions, latency limits, memory headroom, transport smoke, and
cost/cleanup rules are closed in
`verification/jank-memory/qualification.v1.json` and explained in
`docs/jank-lambda-qualification.md`. In particular, a suppressed Lambda init
does not count as a passing fast start.

The local development compiler also failed code generation inside compiler-
generated `clojure/core.jank` C++ when lazily compiling `case` branches in the
public handler adapter. The adapter now expresses those two closed branches as
equivalent explicit predicates, and focused cursor-error/count regressions plus
the full interpreted store/handler suite pass. That compiler is commit
`434f0e7`, not the candidate Linux compiler commit `489760d`; the workaround
therefore neither qualifies nor disqualifies the candidate. The release remains
blocked until the candidate image compiles the port, clean-AL2023 artifact and
transport smoke pass, and both the runtime port and semantic-rebase coverage
are updated from their older Core identities to the repository's required
release Core semantics.

`npm run test:jank-runtime-api` is the fast merge-safe native boundary suite.
`npm run test:jank-runtime-api:store` additionally runs the slow interpreted
10k store/handler diagnostic. On the current macOS development compiler it
passes the exact catalog, all 14 initialization exemplars, the closed handler
surface, authenticated pagination, authorization, counts, stable errors, and
Function URL transport. This diagnostic is evidence only and cannot replace or
block the pinned Linux AOT qualification.
