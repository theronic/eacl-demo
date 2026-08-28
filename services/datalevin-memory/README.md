# `datalevin-memory`

`datalevin-memory` is the stable deployment profile ID for the read-only
Datalevin demo. The name is retained for rollout continuity; the deployed
storage is embedded LMDB, and the public descriptor reports
`datalevin/embedded` ("Embedded disk").

## Deployed topology

- Lambda runs Java 25 on arm64 with 1 GiB memory and 512 MiB ephemeral storage.
  It creates LMDB under `/tmp/eacl-demo-datalevin` during published-version
  initialization. Lambda SnapStart captures the initialized process and the
  `/tmp` files, so restored environments do not reload the fixture.
- EC2 runs the same artifact on the shared `t3.micro` Datomic comparison host.
  Its x86_64 LMDB lives at `/var/lib/eacl-demo/datalevin` on the encrypted EBS
  root volume and survives service and instance restarts.
- Both platforms expose the same closed HTTP boundary and immutable 10,000
  logical-resource fixture. They have no public writer or remote Datalevin
  server.

The universal deployment JAR contains only the two deployed Linux native
closures: AL2023-compatible arm64 for Lambda and x86_64 for EC2. The arm64
closure is built from the exact maintained Datalevin fork recorded in
`dependencies/datalevin-native-al2023-builder.v1.json` and is rejected if it
requires glibc newer than AL2023's 2.34 baseline.

## Embedded bootstrap

The reader streams fixture records in bounded batches rather than retaining
the entire NDJSON data set in the JVM heap. It verifies the immutable header,
10,080 object records, and 38,613 relationship records. The final transaction
writes `:demo/data-manifest-sha256` to the Datalevin metadata entity.

On reopen:

- an exact manifest marker skips fixture seeding and reuses the existing LMDB;
- an absent marker retries the idempotent seed, covering interrupted startup;
- a different marker fails closed and never deletes or replaces unknown data.

The EACL schema is still reconciled before the marker check. The manifest-
derived Datalevin source UUID and revision are therefore stable across Lambda
restores, Lambda execution environments, and EC2 restarts, which also keeps
pagination cursors scoped correctly.

## SnapStart and lifecycle

`LambdaHandler` realizes the reader in its static initializer. CloudFormation
publishes an immutable version with `SnapStart: PublishedVersions`, waits for
`OptimizationStatus: On`, smoke-tests the restored version, and only then
promotes the `candidate` alias. The embedded native connection is exercised
after restore; a restore that cannot use the captured LMDB fails the health
gate instead of being promoted.

The Lambda directory remains execution/version-local and is rebuilt only when
a new published version is initialized. EC2 is the durable comparison path.
Neither platform permits runtime mutation through the demo API.

## Verification

Useful checks are:

```sh
npm run test:datalevin-runtime-policy
npm run build:datalevin-memory-lambda
npm run build:static-site
```

The Clojure reader tests use an actual temporary embedded LMDB, close it,
reopen the same directory, assert that the revision did not advance, and then
exercise page-two EACL pagination. Production health responses bind the demo
Git SHA, baked EACL Git SHA, artifact SHA-256, data manifest, and current
Datalevin basis.
