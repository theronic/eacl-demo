# Observability infrastructure

The central stack owns one shared runtime dashboard and the canonical Telegram
notification path. Deploy `profile-runtime.yaml` once per server profile with
the exact Lambda function name, profile ID, and central alarm topic ARN. Its
seven alarms use the closed `EaclDemo/Runtime` EMF namespace and never define
per-alarm `OKActions`; the central recovery rule handles only real
`ALARM`-to-`OK` transitions. Missing data is non-breaching, sustained noisy
signals use two-of-three one-minute windows, and only health, initialization,
and OOM are immediate single-event alarms.

The JVM and Jank runtime record schema is `eacl-demo.runtime-telemetry.v1`.
Metric dimensions
are limited to stable `ProfileId` and `FunctionName`; deployment ID, request ID,
operation, outcome, and a closed error code remain structured log fields rather
than high-cardinality dimensions. A health or initialization failure emits one
additional `Errors` stream scoped by closed `AlarmClass`. Inputs, response data,
messages, exception text, paths, storage identifiers, and credentials are never
logged. Current JVM profiles and the Jank OS-only runtime emit
`Initialization=1, Restore=0` on cold start because SnapStart is disabled or
unsupported; a future restore hook must replace that lifecycle claim with
qualified restore emission. Jank's source-level metrics do not qualify native
fatal-OOM capture or the deployed Linux artifact.

`template.yaml` creates the canonical unencrypted SNS alarm topic, a generalized
SNS-to-Telegram Lambda, two project-scoped budgets, and immediate project-tagged
Cost Anomaly Detection. A fresh deployment creates the custom
`user:Project=eacl-demo` monitor; an existing deployment may supply its exact
monitor ARN so the stack adopts its notifications without creating a duplicate.
The topic accepts CloudWatch alarm publications only
from same-account, same-Region alarm names beginning `eacl-demo-`. The topic
intentionally has no KMS key: AWS Budgets can use an encrypted topic only with
extra KMS policy and cost, while no alarm payload may contain credentials.

SNS-to-Lambda delivery failures, notifier invocations that still fail after
two retries within a 15-minute event lifetime, and exhausted alarm-recovery or
deployment-failure EventBridge target deliveries are retained for 14 days in
one standard SQS queue using SQS-managed encryption. A one-minute queue-depth
alarm publishes a single ALARM transition through the normal topic and an OK
transition only after the queue is deliberately drained. Recoveries use an
EventBridge rule that accepts only `previousState=ALARM` and `state=OK` for
same-account `eacl-demo-*` alarms. Per-alarm `OKActions` are forbidden, so a
new alarm's initial `INSUFFICIENT_DATA`→`OK` evaluation does not spam Telegram.
This cannot create an
unbounded loop: the failure queue has no Lambda event source and an ALARM state
does not republish merely because its depth increases. If Telegram itself is
unavailable, its alarm notification is retained in the same queue for operator
inspection; no design can report a Telegram outage through Telegram alone.

The notifier artifact is built deterministically with:

```sh
npm run build:observability-notifier
```

Upload that ZIP to a versioned foundation artifact bucket and supply the exact
bucket, key, and object version. `TelegramSecretArn` points at the retained
Secrets Manager secret. `TelegramChatId` is routing metadata, not a credential.
Never put the bot token in the template, an artifact, GitHub, or workflow logs.

The monthly budget filters `Project=eacl-demo`; the seed budget filters
`Workload=eacl-demo-seed`; and the anomaly monitor aggregates only
`Project=eacl-demo`. The default anomaly threshold is USD 5. Activate both
user-defined cost-allocation tag keys and verify that AWS reports them `Active`
before deploying this stack or relying on these controls. This deliberately
does not route unrelated account spend to the demo Telegram destination.
Budgets and anomaly detection depend on processed billing data and can be
delayed. They are secondary detection, never the gate that makes a seed safe.

Before creating a durable table, publish a synthetic message to the topic and
confirm it arrives in Telegram. The notification must contain the current AWS
account, Region, stack identity, and a random nonce so stale delivery cannot be
mistaken for the current gate. Also assert that the failure queue is empty and
its alarm is `OK`. Deliberately breaking Telegram delivery is a separately
approved acceptance exercise because it creates retries, a retained message,
and user-visible state transitions. Inspect and redact retained payloads before
manual replay; never attach the failure queue as an automatic event source.
