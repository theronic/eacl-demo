# Legacy Telegram notification audit — 2026-08-26

## Scope and confidence

This is a local, read-only analysis of
`docs/provenance/aws-estate-2026-08-25.json`. A live AWS refresh was attempted
on 2026-08-26, but the `petrus-prod` session had expired before any inventory
could be read. No AWS resource was created, updated, invoked, or deleted by
this audit. The captured state is evidence of the legacy estate on 2026-08-25,
not a claim about its current live state.

## Captured notification source

The legacy topic
`arn:aws:sns:us-east-1:843761893873:demo-eacl-datahike-alarms` invoked the
legacy notifier `demo-eacl-datahike-telegram-notifier`. Ten captured legacy
alarms sent both `AlarmActions` and `OKActions` to that topic:

- `demo-eacl-datahike-capacity-controller-failed`
- `demo-eacl-datahike-high-cpu`
- `demo-eacl-datahike-instance-unresponsive`
- `demo-eacl-datahike-low-cpu-credits`
- `demo-eacl-datahike-low-memory`
- `demo-eacl-datahike-public-health-failed`
- `demo-eacl-datahike-s3-get-cost-critical`
- `demo-eacl-datahike-s3-get-cost-warning`
- `demo-eacl-datahike-s3-put-cost-critical`
- `demo-eacl-datahike-s3-put-cost-warning`

All ten were `OK` in the capture. Their configured `OKActions` can send
recovery messages and, on newly created or replaced alarms, can also send a
harmless initial `INSUFFICIENT_DATA`-to-`OK` transition. A Telegram message
whose alarm name starts `demo-eacl-datahike-` is therefore attributable to the
legacy path, not to the undeployed consolidated `eacl-demo-*` alarm design.

The consolidated templates have no per-alarm `OKActions`. They use one
same-account, `eacl-demo-*`-scoped EventBridge rule that accepts only a previous
`ALARM` state followed by `OK`.

## Captured cost-bearing compute

The same estate capture recorded the legacy stack's `t4g.large` instance
`i-04761ff3afba454ab` as running since 2026-08-13. It is the existing Datahike
demo/fallback, not temporary compute created by this consolidation. Its stop or
termination would be a service change and is not authorized by this audit.
No new Datomic/Datahike DynamoDB generation or temporary EC2 instance has been
launched by the current local implementation work.

## Required live incident sequence

After explicit AWS reauthentication, but before any further deploy or seed:

1. refresh the exact alarm, SNS, Lambda, EC2, EBS, address, budget, and anomaly
   inventory without changing it;
2. match the received Telegram message's exact alarm/budget/anomaly identity;
3. if it is one of the legacy alarms above, remove only its `OKActions` while
   retaining its `AlarmActions`, then verify the exact post-change definition;
4. do not force alarm states or send another synthetic notification during the
   cost freeze; and
5. do not stop the legacy EC2 fallback without a separate availability and
   rollback decision.

