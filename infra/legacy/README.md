# Legacy compatibility infrastructure

Fallback hostnames, redirects for portable parameters only, DNS rollback
coordinates, and separately approved retirement plans. No automatic
destructive action.

The authorized redirect below provides a deployable compatibility template.
A stale public IP or an untested DNS record is not a fallback. Before adding a
compatibility stack, evidence must bind all of the following:

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
evidence. Ordinary `main` deployment must never call it.

## Authorized legacy Datahike retirement (2026-09-08)

The operator subsequently authorized redirecting the old public hostname and
removing outdated storage unused by the consolidated v8 demos. The verified
current destination is `https://demo.eacl.dev/`; `eacl.demo.dev` does not resolve.
This explicit retirement authorization supersedes the earlier retention gate
for the resources below.

`serverless-datahike-redirect.json` updates the existing independent HTTPS/domain
stack through the manually dispatched `redirect-legacy-demo.yml` CI workflow.
It preserves the certificate and DNS aliases, returns a fixed 301 for GET/HEAD
on every path, and returns 410 for other methods. Legacy paths, query strings,
cursors and request bodies are never forwarded to the new site. CI inspects the
CloudFormation change set and rejects resource replacements or changes outside
the old distribution, edge function and retired static origin resources.

Only after public redirect checks pass may the old reader and EC2 services be
retired and their unused storage deleted. The retirement inventory identifies:

- the old store bucket `demo-eacl-datahike-v2-843761893873-us-east-1`;
- the old static bucket
  `demo-eacl-datahike-serverless-dom-staticsitebucket-m9ovhn4bfnjo`;
- the stopped instance `i-04761ff3afba454ab`, its 20 GiB volume
  `vol-0f89b55a3ce8a0b69`, and its otherwise unused network;
- the old Lambda reader and its dedicated monitoring resources.

The S3 Express cache bucket owned by the old reader stack remains in use by
current v8 Lambda profiles. Keep that resource in its existing stack while
removing the old reader resources. Likewise preserve the legacy monitoring
stack's Telegram secret if it is referenced by the current notifier. Never
print secret values when inspecting those dependencies. The current EC2 instance
`i-01f2d07f50ad1cb5d` uses a separate VPC and volume and must remain untouched.

The temporary redirect role grants only the exact domain deployment operations;
storage/service cleanup has separate, explicit resource manifests. Remove the
role and repository variable after CI completes. Record exact deletions and
post-retirement live checks under ignored `target/legacy-retirement/`.
