# Jank Lambda qualification

The machine-readable acceptance contract is
`verification/jank-memory/qualification.v1.json`. It applies only to the exact
digest-pinned `provided.al2023` x86_64 artifact and canonical 10,000-resource
fixture. macOS interpreter or development-compiler results cannot satisfy it.

AWS currently limits normal on-demand initialization to ten seconds; when
that phase misses, Lambda retries initialization during the first invocation
under the configured function timeout. This profile therefore requires every
measured native initialization to reach the Runtime API `next` call within
nine seconds and every cold health result within ten seconds. A successful
suppressed initialization is recorded as a failure, not used to weaken the
threshold. See the [AWS execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html).

Qualification begins at a memory size with at least 20% measured RSS headroom,
then tests lower sizes. The selected setting is the smallest tested value that
passes 20 fresh environments, 100 warm requests per advertised operation, the
latency thresholds, the full semantic fixture workload, zero timeouts, and
zero errors. The selected value and the next lower tested value are repeated
to guard against a noisy boundary. Lambda supports 128–10,240 MiB in one-MiB
increments; the template does not constrain the evidence search to copied JVM
presets. See [AWS Lambda memory configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html).

The actual Function URL transport smoke is deliberately small: health,
bootstrap identity, one canonical allow, one canonical deny, and mutation
route denial. It does not run formal verification. Formal models, sanitizers,
fault campaigns, and load suites remain independent assurance work and cannot
block an otherwise passing demo build.

The manual `build-jank-builder.yml` workflow binds its expensive execution to
one content-addressed workload and one exact demo commit. Its confirmation is
`BUILD:<workload-digest-without-sha256-prefix>:<demo-sha>`. The workload digest
covers the complete builder lock; that lock in turn fixes the Dockerfile hash,
runner, action revisions, platform, immutable base images, compiler sources,
package versions, output tag, provenance, and SBOM settings. The workflow
checks a clean checkout before allocating swap or compiling.

The same run must produce more than a builder image. It builds the
qualification-only Lambda ZIP with the just-published image digest, verifies
ELF64/x86_64 and the glibc 2.34 ceiling, rejects missing or macOS/Homebrew
dependencies, binds the native/source/adapter/builder evidence digests, and
runs the exact package in the immutable `provided.al2023` x86_64 base image.
Raw ELF, `ldd`, compiler-health, license, and self-test evidence is retained for
one day. Image publication alone is never evidence that tasks 11.2–11.5 or
deployment eligibility passed.

No provisioned concurrency is permitted during initial qualification because
it creates recurring spend and changes the initialization lifecycle. External
qualification requires explicit approval, uses at most two reserved
concurrent executions, and must clean up every candidate function/version and
temporary resource. The candidate log group deletes with its stack rather than
creating a retained cost-bearing remnant. Until immutable evidence passes,
`jank-memory` remains unavailable and the 4096 MiB template value is only a
starting point.
