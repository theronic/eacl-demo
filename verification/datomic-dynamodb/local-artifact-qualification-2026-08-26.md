# Datomic/DynamoDB local artifact qualification — 2026-08-26

The Datomic serving and seed artifacts were each built twice in the pinned
Amazon Linux 2023 x86_64 image using Node 24.19.0, Eclipse Temurin
25.0.4.1+1-LTS, and Clojure CLI 1.12.5.1664. Each pair was byte-identical.

The serving JAR is
`7d7a18b3db2433040b7ddd90cfbd1f08c1b8e29395727cad9c5b60950f1ff964`
at 35,120,357 bytes. Its sorted content-addressed artifact source closure is
`e405fbccc1d7033444b37309d85a216de7a6d4f3c2f5c421a6ff90d5f2ef5f83`.
The separate seed JAR is
`c2430a634786f64960bc31237494db0e992628ff0e471834f2879a5067fe6eaa`
at 35,098,046 bytes. Both packaged audits ran in the same environment, verified
the EACL kernel at Java 25 classfile major 69, and loaded it successfully. The
serving audit also retained the fixed-current, `read-only=true`, no-`d/sync`,
no-serving-write checks; the seed audit retained its deliberately separate
writable maintenance boundary.
The serving audit also requires the closed EMF telemetry source. It emits
redacted request/error/duration/throttle/timeout/OOM/storage metrics plus cold
initialization with `Restore=0`, matching the disabled SnapStart claim.

This is local artifact evidence only. It does not create or qualify a Datomic
database, prove the million-resource/history requirements, exercise AWS IAM or
storage, run the artifact in Lambda, select memory, or qualify a staged route.
`deploymentEligible` therefore remains false. The disposable build container
was removed and no AWS endpoint was contacted.
