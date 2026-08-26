# AWS cost-safety decision

The demo uses layered detection because no single AWS control is an absolute
cost guarantee.

| Layer | Immediate? | Role |
| --- | --- | --- |
| DynamoDB on-demand maximum throughput | Usually | Conservative target; burst capacity can exceed it temporarily |
| IAM and bounded public admission | Yes | Prevent writes and cap caller-driven work |
| One-minute utilization/throttle/write alarms | About one minute | Detect pressure and unexpected serving writes |
| Five-minute reported-cap drift alarms | About five minutes | Detect a table cap that differs from the reviewed parameter |
| Monthly and seed budgets | No | Billing-data backstop at 50%, 80%, and 100% |
| Cost Anomaly Detection | No | Immediate delivery after AWS detects a qualifying `Project=eacl-demo` anomaly of at least USD 5 by default |
| Temporary-compute expiry watchdog | At most about five minutes | Terminates only explicitly managed instances whose tags are invalid, expired, or exceed six hours from AWS launch time |
| Telegram failure queue | One minute after a permanent delivery failure | Retains failed SNS delivery or notifier invocation records for 14 days without automatic replay |
| Watchdog failure queue | One minute after a permanent delivery failure | Retains failed schedule delivery or exhausted watchdog invocation records for 14 days without automatic replay |

The initial 250 RRU/s, 200 seed WRU/s, and 1 serving WRU/s values are safety
bounds, not benchmark results. They remain until the million-resource seed and
profile qualification produce measurements. A later increase requires a
reviewed forecast, matching table/alarm parameters, and a fresh synthetic
Telegram gate.

The project monthly budget defaults to USD 25 and filters
`Project=eacl-demo`. The seed budget defaults to USD 15 and filters
`Workload=eacl-demo-seed`. The anomaly monitor also filters
`Project=eacl-demo`; it does not report unrelated account activity to this
Telegram route. Both user-defined cost-allocation tag keys must report
`Active` before this stack is deployed or either filter is treated as evidence.
Neither budget stops resources automatically, and billing ingestion can delay
alerts.

The Telegram bot token remains only in the retained Secrets Manager secret.
The notifier role can read exactly that secret; GitHub receives neither the
token nor long-lived AWS keys. The chat ID is non-secret routing configuration.

Cap-drift alarms treat missing telemetry as non-breaching because the alarm
stack is intentionally installed before its table and DynamoDB may not emit
the cap gauge until after creation. The explicit stateful workflow must call
`DescribeTable` immediately after table creation and after publication, fail
unless both on-demand caps equal the reviewed values, and only then proceed.
This avoids false Telegram incidents while retaining an ongoing drift signal
once telemetry exists. Deliberate alarm-load tests require advance notice and
a bounded notification plan; ordinary qualification uses direct metric and
configuration assertions instead of generating an alert storm.

Every managed alarm sends its `ALARM` action directly to SNS but has no
`OKActions`. CloudWatch executes the action associated with a new alarm's first
evaluated state, so attaching `OKActions` would generate a Telegram recovery
for every harmless `INSUFFICIENT_DATA`→`OK` bootstrap. One same-account,
name-scoped EventBridge rule instead forwards only real `ALARM`→`OK`
transitions. Its delivery has a 15-minute age, two retries, and the same durable
failure queue.

Publication uses a third, alarm-only `transition` phase after a six-minute
quiet-write check. It activates the zero-write alarm and requires that alarm to
be `OK` before writer removal or table-cap changes. Cap-drift alarms are absent
only during that intentional change, while direct `DescribeTable` checks and
the zero-write guard remain active; serving cap-drift alarms are installed
immediately afterward. This closes the former write-monitoring gap without
manufacturing a cap-drift notification.

The Telegram notifier retries a failed asynchronous invocation at most twice
and retains expired or permanently failed invocations in an SQS-managed-
encryption queue. SNS subscription delivery failures use the same queue. Its
depth alarm routes through the normal topic, but the queue is never an event
source: a broken Telegram path can add at most the alarm transition to the
retained backlog, not trigger an invocation cycle. The operational gate checks
the queue is empty and the alarm is `OK`; replay and deletion are explicit
operator actions after payload inspection. Telegram cannot be its own
independent fallback, so a delivery-path outage is durably observable in AWS
even when no Telegram message can arrive.

The deployment-failure EventBridge route uses the same 15-minute age, two-
retry, and durable-queue bounds as alarm recovery delivery. The five-minute
temporary-compute watchdog has its own SQS-managed-encryption failure queue:
both EventBridge-to-Lambda delivery and Lambda asynchronous execution are
bounded to 15 minutes and two retries, and exhausted events remain for 14
days. That queue is never an event source. Its depth alarm has only an
`ALARM` action, so queue creation cannot manufacture a Telegram recovery.

Initial stateful authorization is narrower than a naming pattern: it names the
single `fixture-v1-green` Datahike table and the single `fixture-v1-green`
Datomic table. A different generation is a new stateful operation and requires
new authorization. Jank build compute uses a separate content-addressed
preview. Every temporary instance must have the `Project=eacl-demo`,
`Lifecycle=temporary`, `ManagedBy=eacl-demo-temp-watchdog`, and exact owner
tags plus an authorization digest, approved purpose, and expiry. The watchdog
also compares the expiry with AWS's immutable launch time; a far-future or
malformed deadline terminates rather than bypasses cleanup.
