# Legacy compatibility infrastructure

Fallback hostnames, redirects for portable parameters only, DNS rollback
coordinates, and separately approved retirement plans. No automatic
destructive action.

This directory deliberately has no deployable template yet. A stale public IP
or an untested DNS record is not a fallback. Before adding a compatibility
stack, evidence must bind all of the following:

- the exact legacy target and a healthy HTTPS endpoint;
- a fallback hostname covered by the certificate actually served by that
  target;
- the exact hosted-zone, current record, proposed record, TTL, and rollback
  record values;
- a closed redirect mapping that preserves only bounded portable selector
  parameters and never forwards cursors, tokens, bases, request IDs, or other
  opaque state; and
- an independent stack boundary that owns only compatibility DNS/redirect
  resources and cannot stop, replace, or delete a legacy service or its data.

Cutover authorization may create or update only those compatibility records.
It does not authorize retirement. Retirement remains a separate exact-resource
plan with backup, dependency, cost, recovery-window, and per-batch approval
evidence. Ordinary `demos` deployment must never call it.
