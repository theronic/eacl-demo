# Reproducible builds

The current JVM Lambda/seed artifacts have one exact Linux qualification entry
point: `scripts/qualify-jvm-artifacts-al2023.sh`. Run it only inside the pinned
Amazon Linux 2023 x86_64 image with the repository mounted at `/workspace`.
The script downloads Node, Temurin, and Clojure CLI over TLS, verifies every
archive checksum before extraction, double-builds each artifact, runs each
packaged audit, prints final digests/sizes, and removes its exact temporary
directory. The container itself must be launched with `--rm`; the script does
not create or contact AWS resources.

`node scripts/verify-deterministic-build.mjs` deletes only the ignored workspace
`dist/` directory, performs two source-unit manifest builds from empty output,
generates the digest index, and compares every resulting path, byte count, and
SHA-256 digest. Each source manifest uses an isolated
`dist/foundation-<unit>/` target so a standalone foundation build cannot erase
a concrete artifact. The check proves deterministic source identity and
workspace enumeration; it does not claim to compile the runtime-specific
artifacts represented by foundation-only units.

`node scripts/verify-static-artifact-determinism.mjs` is the separate material-change check for the real static deployment artifact. It builds the main Vite entry, DataScript Vite entry, advanced-compiled direct ClojureScript runtime, and assembled upload tree twice, then compares every output byte and verifies that the runtime artifact, content-addressed filename, and assembled copy carry the same digest. Both checks refuse the wrong Node version. The compiled check is manual qualification and is intentionally outside the fast ordinary `demos` deployment path.

The `verify:datomic-artifact-determinism`,
`verify:datahike-s3-artifact-determinism`, and
`verify:datahike-dynamodb-artifact-determinism` commands perform the equivalent
manual check for the JVM Lambda and maintenance JARs. Each refuses the wrong
Node, Java, or Clojure CLI, prepends the running pinned Node binary to the child
build environment, builds its normalized artifact twice, and compares exact
bytes. The ordinary merge path may run a single build and the cheaper
packaged-artifact audits after this material toolchain/topology check has
passed.

The current Datahike/S3, Datahike/DynamoDB, Datomic serving, and Datomic seed
JARs passed local double-build and packaged-audit qualification in the exact
pinned AL2023 x86_64 image with the checksum-pinned Node, Temurin 25, and
Clojure CLI archives. The retained records are under `verification/`. This
closes artifact reproducibility and Java 25 load compatibility only; it does
not substitute for actual Lambda, storage, IAM, memory, staged-route, or
production qualification.

The Datalevin native candidate has a separate arm64 entry point:
`npm run build:datalevin-native-al2023 -- --no-cache`. The locked builder uses
the exact AL2023 arm64 manifest, exact `dtlvnative` commit and submodules,
checksum-pinned JavaCPP input, fixed ZIP metadata, and a checked-in runtime-path
patch. It rejects any artifact whose three-library closure, bytes, ELF format,
`DT_NEEDED` set, runtime paths, or imported glibc versions differ from
`dependencies/datalevin-native-al2023-builder.v1.json`. It then compiles and
runs the native `MDB_INMEMORY` round-trip with networking disabled inside the
exact Lambda Java 25 arm64 image recorded by digest. Two from-scratch builds
were byte-identical. This qualifies only the unpublished native candidate; it
does not create a Maven release, prove a clean remote consumer, integrate the
Datalevin service, or qualify SnapStart lifecycle behavior.

Because the exact JDK may not exist on a developer workstation,
`.github/workflows/qualify-artifact-determinism.yml` provides a dispatch-only,
read-only Linux qualification path. It installs exact Temurin `25.0.4+101` and
Clojure CLI `1.12.5.1664`, executes all double-build checks, reruns packaged
boundary audits, and retains the resulting evidence for 14 days. It has no AWS
identity, secrets, push trigger, or role in ordinary deployment.

Artifact bytes must not contain clocks, random IDs, absolute paths, filesystem traversal order, local usernames, branch names, mutable dependency coordinates, or AWS/GitHub runtime values. Build inputs are enumerated in lexical order and file boundaries are included in source digests.

The following fields are deliberately outside reproducible artifact bytes:

- the exact GitHub Actions `runId` and `runAttempt`, which identify a deployment attempt in the release manifest;
- observation and publication timestamps in evidence/registry records;
- CloudFormation stack events and AWS-assigned physical resource, Lambda version, distribution, table, alarm, and log-stream IDs;
- runtime cold/restore timestamps, request IDs, metrics, and benchmark samples.

Those values are nondeterministic observations, not source or artifact identity. They must be recorded alongside immutable artifact/source digests and must never be fed back into compiled bytes. ZIP and JAR builders normalize entry order, ownership, permissions, and compressor settings. Non-class entries receive the fixed timestamp `2000-01-01T00:00:00`; JVM class entries receive the fixed ZIP timestamp `2000-01-01T00:00:02`, because Clojure requires an AOT `__init.class` resource to be strictly newer than its `.clj` or `.cljc` source. This deterministic two-second ordering prevents source recompilation and generated-class loader splits inside an uber-JAR. A runtime unit remains `deploymentEligible: false` until its actual deployable artifact passes a byte-for-byte double-build comparison or documents and strips a platform field that cannot be normalized. A source-unit manifest comparison is never sufficient evidence for runtime deployment eligibility.

The dispatch-only artifact qualification workflow double-builds the complete
static upload tree, both Datahike Lambda JARs, and both Datomic JARs with the
exact pinned Node, Java, Clojure CLI, and package-manager versions. It then
reruns their packaged-boundary audits. This workflow is intentionally outside
ordinary `demos`-branch deployment and has not supplied deployment evidence
until a recorded run succeeds.
