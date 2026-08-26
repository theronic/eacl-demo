# Completion readiness

`verification/change-readiness.v1.json` is the fail-closed ledger for the
unchecked tasks in the `consolidate-eacl-demo-backends` OpenSpec change. It is
not a replacement checklist and it is not evidence that an external gate has
passed. It makes the current non-completion explicit and executable.

Run:

```sh
npm run verify:change-readiness
```

The verifier parses the authoritative OpenSpec task file and requires the
ledger to cover every unchecked task exactly once. It fails if a task is
omitted, duplicated, prematurely checked, or left in the ledger after
completion; if the 125/66/191 counts drift; or if the current external-mutation
freeze is weakened without a deliberate source change. Each gate records the
evidence needed to close it and the safe action while it remains open.

The ledger deliberately keeps local definitions distinct from live facts. A
CloudFormation template cannot prove that an alarm delivered to Telegram, a
Function URL rejected an anonymous request, a Lambda fit its memory setting,
or a rollback restored an exact deployed identity. Likewise, the absence of an
automatic workflow while build units are ineligible cannot prove how that
future workflow behaves. Those tasks remain open until immutable execution
evidence exists.

The user's cost freeze currently prohibits AWS reauthentication or mutation,
GitHub/Chrome mutation, deployments, durable seeding, EC2 launches, and
Telegram tests. Read-only local verification remains permitted. Lifting the
freeze does not itself complete a task; it only allows the separately gated
operation to be considered with its exact preview, authorization, cost, and
cleanup requirements.
