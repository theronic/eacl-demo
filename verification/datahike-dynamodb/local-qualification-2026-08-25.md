# Datahike/DynamoDB local qualification — 2026-08-25

The hardened read adapter passed its DynamoDB Local phase against version 3.3.0
on the exact Linux arm64 image digest recorded in the adjacent JSON report. The
test created one uniquely named in-memory table, exercised strong publication
reads, real missing and corrupt items, sparse batch reads, the Konserve backing,
and 320 concurrent reads, then deleted the table. A final `ListTables` returned
an empty list.

This is deliberately not task 8.11 completion and does not enable the profile.
DynamoDB Local cannot establish real AWS IAM denial, throttling,
`UnprocessedKeys`, network behavior, or service consistency. Those checks need a
disposable real AWS table after the cost controls and synthetic Telegram alarm
required by sections 13 and 15 are active. Full Datahike initialization and the
EACL workload also remain pending.
