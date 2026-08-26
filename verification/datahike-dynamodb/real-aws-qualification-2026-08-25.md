# Datahike/DynamoDB disposable real-AWS qualification

The hardened adapter passed its real-AWS qualification in account
`843761893873`, Region `us-east-1`, on 2026-08-25. Cost alarms were created
before the disposable table, and a nonce-bearing Telegram synthetic had already
been accepted by the notifier.

The normal suite passed 10 assertions with no failures or errors. It exercised
immediate strongly consistent publication reads, genuine absence, corrupt
physical data, a controlled unprocessed-key retry wrapped around real AWS batch
responses, the read-only Konserve backing, cancellation, deadline rejection,
and 480 concurrent-path equality checks.

The IAM data-plane probes proved that the exact-table role can read its table,
but cannot write or read a different table. A zero-permission role could not
read. All three denials were real `AccessDeniedException` responses.

For throttling, the alarm and table parameters were both reduced to 1 RRU/s.
A bounded 96 KiB strong-read workload passed its assertions and CloudWatch
recorded 3,282 `ReadThrottleEvents`. The 70%, 90%, and throttle alarms entered
`ALARM`; their canonical SNS actions were delivered by the Telegram notifier
with zero notifier errors. The high-volume Telegram notifications were an
operational mistake: future deliberate alarm transitions require advance user
notice and a bounded notification plan.

The unprocessed-key response was injected at the SDK response boundary because
DynamoDB has no deterministic API to force that response shape. Every retry
after injection still used the real table. The exact source, artifact, and
template hashes are in the adjacent JSON evidence.

Cleanup completed at `2026-08-25T14:33:12Z`. Both qualification stacks, the
table, probes, roles, alarms, and qualification artifact version are gone.
There are no `eacl-demo` DynamoDB tables or EC2 instances. The reusable
foundation and requested observability stacks remain; no production profile
was enabled.

This evidence was superseded for enablement when the serving path subsequently
added an exact-signature SDK membrane and native EACL read-only client
construction. Its historical adapter/IAM findings remain valid, but task 8.11
was reopened: the current closure must pass DynamoDB Local and a newly announced
disposable real-AWS run before publication. The historical run will not be
silently relabeled as qualification of code it did not execute.
