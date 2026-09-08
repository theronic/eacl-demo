# EACL v8 demo cutover

The UUID API change and the relationship storage upgrade are separate obligations.
The browser snapshot and embedded Datalevin fixture are rebuilt from the canonical
fixture with the pinned Core revision. Durable Datahike and Datomic stores retain
their data when an application artifact is deployed.

Datalevin treats `EACL_DATALEVIN_DIRECTORY` as a fixture root and selects a child
directory using the relationship storage version and fixture manifest digest.
This also applies to the persistent EC2 host: v8 rebuilds its derived fixture
beside older data, while restarts of the same ABI and fixture reopen their existing
child directory. No old fixture directory is deleted during deployment.

The live durable readers inspected on 2026-09-08 report Core revision
`21e661e09988dca6e416454dd7a29321076c17ac`, whose relationship format uses four-slot
`eacl.v7.relationship` tuples. The new v8 readers require five-slot tuples and a
completed storage-v8 marker. They fail closed on the earlier format. The previous
application deployment also failed to initialize these newer readers; changing a
lifecycle UUID alone cannot fix that storage mismatch.

The existing durable source inventory is:

| Profile | Serving source |
| --- | --- |
| Datahike/S3 | Bucket `demo-eacl-datahike-v2-843761893873-us-east-1`, store `4e67bb31-5480-4734-bb55-9c33e35953bf` |
| Datahike/DynamoDB | Table `eacl-demo-datahike-fixture-v1-green`, store `2d692f8e-0778-49bf-aed7-241e93d63b2f` |
| Datomic/DynamoDB | Table `eacl-demo-datomic-fixture-v1-green`, database `eacl-demo` |

Before any durable migration, refresh and verify the exact source inventory using
the authorized AWS session. Follow the existing stateful runbook and its separate
authorization for a retained backup or new blue/green generation; ordinary demo
deployment grants no storage mutation privileges. Keep the current serving
generation available until the new generation passes checks. Do not mutate an
accepted immutable generation through a serving role.

On the approved writable, quiesced target, use the pinned Core maintenance entry
point: `eacl.datahike.migrations.relationships-v7-to-v8/migrate!` or
`eacl.datomic.migrations.relationships-v7-to-v8/migrate!`, with
`{:quiesced? true :batch-size 1000}`. These functions modify relationship storage;
they are not previews. Retain progress outside source control, verify completion
and relationship identities, and compare allowed/denied decisions, counts, and
complete bidirectional pagination with the old generation. Permission storage must
also satisfy Core's separate permission-format admission checks.

Bind the approved generation and its fresh lifecycle to every primary/comparison
reader, including the Datomic EC2 service. Deploy and smoke the candidate version
before changing its serving alias or publishing its registry identity. The deployer
already keeps a failed candidate off the serving alias. New tokens and fresh first
pages are required after a successful cutover.

Rollback selects the retained generation together with its compatible application
and fresh artifacts; it does not run an inverse migration or recycle retired UUID
authority. Core spec archival and the v8.0.0 Clojars release remain pending the
operator's review of the upgraded demos.
