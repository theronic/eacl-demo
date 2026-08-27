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
completion; if the 165/40/205 counts drift; or if the external-mutation freeze
state is internally inconsistent. Each gate records the
evidence needed to close it and the safe action while it remains open.

The ledger deliberately keeps local definitions distinct from live facts. A
CloudFormation template cannot prove that an alarm delivered to Telegram, a
Function URL rejected an anonymous request, a Lambda fit its memory setting,
or a rollback restored an exact deployed identity. Likewise, the absence of an
automatic workflow while build units are ineligible cannot prove how that
future workflow behaves. Those tasks remain open until immutable execution
evidence exists.

The earlier cost freeze was explicitly lifted by the user's later instructions
to continue, retry AWS login, and proceed with demo changes. Its inactive state
does not itself complete a task or broaden ordinary deployment; each separately
gated operation still requires its own evidence, authority, cost controls, and
cleanup requirements.
