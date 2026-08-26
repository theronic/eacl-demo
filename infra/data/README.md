# Durable data infrastructure

`dynamodb-cap-policy.v1.json` is the reviewed initial ceiling policy. Values are
request units per second, not requests or units per CloudWatch period. Both
Datahike and Datomic start with 250 read request units/second and 200 write
request units/second while seeding. Immutable serving keeps the read cap and
sets the minimum supported write cap of 1; serving IAM still denies every write
and the first consumed write unit alarms.

`dynamodb-cost-controls.yaml` is deployable before its table exists. For each
read/write cap it computes one-minute utilization as:

```text
Consumed*CapacityUnits Sum / 60 seconds / configured per-second cap * 100
```

It alarms at 70% and 90%, on read/write throttles, on cap configuration drift,
and, while write-frozen or serving, on any consumed write. Missing utilization, throttle, and
cap-configuration telemetry is non-breaching because the alarm stack is
deliberately installed before its table. The stateful workflow reads the table
configuration directly after creation and publication, so missing metrics do
not masquerade as cap drift or send false Telegram alarms.

Alarm resources carry only `AlarmActions`. Genuine `ALARM`→`OK` recovery
events are selected centrally by the observability EventBridge rule; omitting
per-alarm `OKActions` prevents every newly created alarm from sending a false
recovery when its initial `INSUFFICIENT_DATA` state first settles to `OK`.

`datahike-dynamodb-table.yaml` creates one retained blue/green generation with
on-demand billing, maximum throughput, deletion protection, point-in-time
recovery, a seed-phase-only exact-generation writer role, and tags.
`SSESpecification` is deliberately absent: DynamoDB still encrypts the table
with the AWS-owned service key and no customer-managed KMS charge. The table's
`Key` string hash key matches the hardened Konserve reader. The serving role is
owned separately by `infra/profiles/datahike-dynamodb-runtime.yaml`; this keeps
runtime/log permissions out of the durable data lifecycle and prevents a table
workflow from mutating the live Lambda identity.

`datomic-dynamodb-table.yaml` creates the Datomic-documented `id` string hash
key with no secondary index. It applies the same retained on-demand/PITR/
deletion-protection controls and owns no compute credential. The independently
deleted `infra/compute/datomic-dynamodb-seed-role.yaml` stack creates an
EC2-trusted writer identity only for one temporary run. That writer is
restricted to one table and explicit DynamoDB data-plane operations plus
`GetObjectVersion` on exactly two immutable S3 objects, each constrained by its
exact `s3:VersionId`: the maintenance JAR and verified million-resource batch
stream. It may write only one exact SSE-S3 evidence object. Cleanup deletes the
role and instance profile after terminating the exact instance. The read-only
Lambda role remains a separate profile stack.

`.github/workflows/stateful-datomic-dynamodb.yml` is manual-only, demos-ref
restricted, and hard-bound to the single recorded green generation. It can
preview/create, verify, back up, and publish that table, installs alarms before
creation, and never starts EC2. Temporary transactor/seed compute remains a
separate explicit lifecycle with exact-instance cleanup evidence; the table
workflow cannot launch it accidentally.

Maximum on-demand throughput is a safety target, not a guaranteed billing
ceiling: DynamoDB can temporarily exceed it with burst capacity. Alarms,
least-privilege IAM, Lambda admission bounds, budgets, and manual post-seed
verification remain required. A cap increase must be an explicit stateful
change; never remove a cap with `-1`.

Publication order is strict even though ordinary demo deployments are not:

1. Deploy observability and the table's seed-phase alarm stack.
2. Confirm a nonce-bearing synthetic Telegram notification.
3. Create the retained table with the exact same seed caps.
4. Seed, verify fixture/data digests, create a backup, and stop all writers.
5. After a quiet window, enter the alarm-only `transition` phase: create the
   zero-write alarm, require it to be `OK`, and temporarily remove cap-drift
   alarms so the intentional cap change cannot create a false incident.
6. Remove writer authority and update the table to serving phase (write cap
   `1`), then immediately install serving cap-drift alarms. The zero-write
   alarm remains active throughout.
7. Verify the reported caps, alarm actions, PITR, deletion protection, serving
   write denial, and absence of active seed credentials before publication.
