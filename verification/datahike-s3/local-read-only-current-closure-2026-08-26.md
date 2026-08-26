# Datahike/S3 read-only current-closure qualification — 2026-08-26

The current local serving closure closes a mutation loophole in the upstream
connector. `konserve-s3` writes the store marker during connect, so the Lambda
now dispatches to a project-owned backend that requires the existing marker,
uses a no-op internal create hook, denies every blob/store write and maintenance
method, and places an exact `GetObject`/`HeadObject` membrane around the SDK.
The candidate runtime policy grants only `s3:GetObject` on the selected
`${StoreId}_*` object prefix; it cannot list or mutate the bucket.

The complete Datahike/S3 suite passed through a persistent nREPL with `:reload`:
21 tests and 134 assertions. A separate disposable MinIO test used the rejected
upstream writer to create a tiny physical-format fixture, then opened and
queried it through the production reader. All 3 assertions passed and the
sorted object-key/content-SHA-256 map was identical before and after the
serving open/query. The temporary bucket, nREPL, and MinIO container were
removed; pre-existing local containers were untouched and no AWS endpoint was
contacted.

The tested foundation source digest is
`0bce501a594ea7513d53c184e7a11d00bfc8cdbdaf5469a667b43e9f5e17b403`,
computed over the sorted content-addressed artifact source closure.
The rebuilt Lambda JAR digest is
`1c72c9637d9a55fccde48d50fccb70dc075a81178e141af3d6bdd22d268cf039`
at 26,260,415 bytes. Two clean builds were byte-identical in the pinned AL2023
x86_64 image with Node 24.19.0, Eclipse Temurin 25.0.4.1+1-LTS, and Clojure CLI
1.12.5.1664. The packaged audit ran in that environment, verified classfile
major 69, and loaded both the Lambda handler and `EaclKernel.__default`.
The packaged audit also requires the closed EMF telemetry source. It emits
redacted request/error/duration/throttle/timeout/OOM/storage metrics plus cold
initialization with `Restore=0`, matching the profile's disabled SnapStart claim.

This evidence is deliberately local-only and keeps `deploymentEligible` false.
It does not attest the adopted AWS store, real IAM/S3 behavior, canonical
million-resource equivalence, actual Lambda execution, memory, staged origin,
CloudFront, or production behavior. Task 8.4 therefore remains open, and no
deployment or external setting was changed.
