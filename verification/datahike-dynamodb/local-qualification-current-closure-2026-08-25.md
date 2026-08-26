# Datahike/DynamoDB current-closure local qualification — 2026-08-25

The current hardened serving closure passed its DynamoDB Local phase against
the already-cached, digest-pinned 3.3.0 Linux arm64 image. The nREPL evaluation
used `:reload` and passed the 8-assertion hardened-adapter suite: immediate
strong reads, genuine absence, corrupt physical data, sparse batch reads, the
read-only Konserve backing, 320 concurrent reads, and missing-table
classification. A separate 2-assertion test wrote a small Datahike database in
the expected Konserve/DynamoDB physical format, opened it through the actual
serving reader, queried it through an immutable EACL snapshot, and released it.

The tested foundation source digest is
`b669fe8a075cb4fff9cb2e8dc2c548c1e2d7c397eeac8bd92faac99a617a44e0`,
computed over the sorted content-addressed artifact source closure.
The locally built Lambda JAR digest is
`25a01d606c395b86e5089e59a45c6eb0703bdf0d46b3346d562e03493d9ed78d`
at 20,548,229 bytes. Two clean builds were byte-identical in the pinned AL2023
x86_64 image with Node 24.19.0, Eclipse Temurin 25.0.4.1+1-LTS, and Clojure CLI
1.12.5.1664. The packaged audit ran there, verified classfile major 69, and
loaded both the Lambda handler and `EaclKernel.__default`.
The packaged audit also requires the closed EMF telemetry source. It emits
redacted request/error/duration/throttle/timeout/OOM/storage metrics plus cold
initialization with `Restore=0`, matching the profile's disabled SnapStart claim.

Cleanup completed: the unique in-memory table was deleted, `ListTables`
returned an empty list, and the temporary container was stopped and removed.
No AWS endpoint was contacted.

This remains local-only evidence. It neither replaces a newly announced
disposable real-AWS run nor enables the profile. The format-only test harness
uses the rejected upstream writer only to establish byte compatibility; it is
not a production-safe resumable seeder. IAM denial, genuine service throttling,
network behavior, the canonical million-resource workload, a production seed
implementation, actual Lambda execution, memory, and staged route qualification
remain open.
