# Fixture streaming and batch seeding

`packages/fixture-generator/batching.mjs` exposes three bounded paths over the
same semantic bundle iterator:

- `writeFixtureNdjson` honors writable-stream backpressure and never assembles
  the complete fixture in memory.
- `fixtureBatches` keeps every resource and its dependent subject/relationship
  records atomic while enforcing resource, record, and canonical-byte limits.
- `materializeBoundedFixture` permits the 10,000-resource browser/in-memory
  fixture under explicit resource, record, and byte ceilings and refuses the
  million-resource cut by default.

Durable seed workflows call `seedFixtureBatches` with a backend-specific
idempotent `applyBatch`. A successful batch records its deterministic digest,
idempotency key, and next resource ordinal. Resume is accepted only at one of
those batch boundaries; a mid-batch checkpoint fails closed. Cancellation is
checked before every batch write.

Application of all batches is not publication. A stateful workflow must still
read back and verify schema, logical counts, relationships, exemplars, and the
accepted manifest digest before it atomically marks the new lifecycle ready.
Normal merge deployment roles never receive `applyBatch` authority.

The Datomic maintenance path pipes `scripts/stream-fixture-batches.mjs` into
`eacl-demo.datomic-dynamodb.seed-main`. Each line contains at most one bounded
batch. The consumer recomputes canonical bytes and SHA-256, enforces exact
ordinal and idempotency identities, and commits a history-preserved checkpoint
only after replay-safe object and relationship writes. It accepts only the two
published cut points and a manifest digest supplied by the explicit stateful
workflow. This namespace lives under `maintenance/` and is audited out of the
public Lambda artifact.

The deterministic maintenance JAR bundles the accepted manifests and schemas
as classpath resources, so it does not depend on the EC2 working directory or
a mutable source checkout. The temporary role may read only the exact S3
versions of that digest-addressed JAR and the compressed verified batch stream.
Before teardown, the normal Peer verifies an earlier batch basis with
`d/as-of`, the final content/publication bases, the `:seeding` and `:ready`
history, and that no EACL attribute is configured with `:db/noHistory true`.
The maintenance consumer inserts a fixed 500 ms pause after every bounded
batch and the transactor uses write concurrency `2`. These are conservative
seed-phase pacing controls beneath the immutable DynamoDB request cap; throttle
and utilization alarms remain active rather than being silenced for the seed.
Finalization is idempotent: if the database is already `:ready` but the
evidence upload failed, an exact retry replays batch identities without the
500 ms write delay, performs no new index request or transaction, rechecks
counts/history, and emits replacement evidence for a new exact S3 version.

Before emitting its first batch, the Node producer makes a complete bounded
preflight pass. It verifies the exact generator, schema, exemplar, manifest,
fixture, semantic-record, count, and cut-point digests against the checked-in
manifest. Only then does a second deterministic pass reach the writer. This
prevents a changed generator or manifest from partially modifying even an
unpublished generation.

`packages/fixture-generator/verifier.mjs` compares a canonical stream to the
deterministic expected stream with constant expected-stream lookahead. It checks
manifest/source identities, canonical framing, object introduction before every
relationship, exact order, cut point, counts, and all three digests. Partial,
duplicate, dangling, schema-drifted, exemplar-drifted, generator-drifted, and
wrong-cut-point inputs return stable failure codes and never become ready.
