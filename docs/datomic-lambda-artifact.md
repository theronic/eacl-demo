# Datomic Lambda artifact boundary

The Datomic/DynamoDB Lambda uses Datomic Peer `1.0.7705` with a
`datomic:ddb:...?read-only=true` connection. Datomic documents that this form
reads one database value directly from storage, requires no running
transactor, supports only `d/db`, `d/log`, and release on the connection, and
returns the same value for every `d/db` call.

The upstream Peer JAR is not a capability-stripped reader artifact. It still
contains the public transaction vars and transactor-connector client classes.
The Lambda artifact therefore must not claim that those symbols are absent.
Its write-prevention boundary is instead layered and explicit:

1. the only constructed URI has `read-only=true`;
2. the serving source has no transaction, synchronization, database-admin,
   backup, seed, or arbitrary evaluation path;
3. the Function URL dispatcher has a closed read-only route table;
4. the exact-generation Lambda role grants only `BatchGetItem`, `GetItem`,
   `Query`, and `Scan` on one table;
5. packaged transactor key/trust resources, transactor executables,
   peer-server entrypoints, maintenance schema, and seed sources are excluded.

`npm run build:datomic-lambda` prepares the exact EACL Core commit pinned in
`deps.edn`, includes its generated formal runtime,
compiles only the small Java 17 Lambda bridge, and normalizes the JAR.
`npm run verify:datomic-lambda-artifact` cold-loads that bridge and audits the
archive. Deployment qualification must rebuild twice on the pinned Linux JDK,
compare exact bytes, and run the audit plus IAM policy tests before publishing
an immutable Lambda version.

Core currently defaults generated formal classes to Java 26, while this Lambda
targets the pinned Java 25 runtime. The demo prep step forces release 25 and
verifies every generated class at classfile major 69. The packaged audit then
checks and loads `EaclKernel.__default` as well as the Lambda bridge. The local
pinned-AL2023 double-build gate has passed; actual Lambda and staged profile
qualification remain separate gates.

This evidence proves that the serving process does not need or start a
transactor and that AWS denies storage writes. It does not prove that the
upstream Peer dependency contains no dormant write-related classes.

The separate `npm run build:datomic-seed` output is deliberately writable and
must never be deployed as the Lambda. It contains only the maintenance seeder,
the pinned EACL formal runtime classes, and the exact two fixture manifests,
schema, and history-preserving metadata schema loaded through the classpath.
It excludes the Lambda bridge/reader, serving contract resource, build source,
and packaged transactor key/trust stores. Its archive audit cold-loads every
required resource and asserts database creation, transaction, index, as-of,
history, and `:db/noHistory` verification paths.
