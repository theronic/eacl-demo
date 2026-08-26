# GitHub OIDC authority boundary

`github-oidc-authorities.v1.json` is the closed source of truth for every local
job intended to request a GitHub OIDC token after publication. It includes the
five active future ordinary deployment roles and every local manual qualification,
transition, and stateful role because GitHub subject customization is
repository-wide. The remote `demos` branch contained no workflow files in the
2026-08-26 audit, so these policies are not evidence of a live authority.

The desired repository subject template is:

```json
{
  "use_default": false,
  "use_immutable_subject": true,
  "include_claim_keys": ["repo", "ref", "workflow_ref", "environment", "event_name", "runner_environment"]
}
```

For example, the Datomic deployment role requires this exact subject:

```text
repo:theronic@1011676/eacl-demo@1345904214:ref:refs/heads/demos:workflow_ref:theronic/eacl-demo/.github/workflows/deploy-demos.yml@refs/heads/demos:environment:demo-production-datomic-dynamodb:event_name:push:runner_environment:github-hosted
```

The generated AWS policies also compare the current AWS-supported `aud`,
`repository`, `repository_id`, `repository_owner_id`, `ref`, `workflow`, and
`environment` claims with `StringEquals`. AWS does not currently document a
direct `workflow_ref` condition key, so the exact path-and-ref value is carried
inside the required non-wildcard `sub`. The subject also requires `push` for
ordinary deployment, `workflow_dispatch` for every manual authority, and a
GitHub-hosted runner. `job_workflow_ref` is deliberately not required because
these are top-level workflows, not called reusable workflows.

Every current `id-token: write` job runs
`scripts/capture-github-oidc-claims.mjs` before AWS credential configuration.
The script requests a dedicated `sts.amazonaws.com` token, verifies its RS256
signature against GitHub's fixed HTTPS JWKS endpoint, validates the exact
registered authority and either exact migration subject, and writes only the
closed non-secret claim allowlist. It never prints, writes, or uploads the JWT,
its signature, request bearer, actor, run identifiers, commit SHA, token ID, or
temporal claims. The one-day artifact contains only that allowlist.

`id-token: write` is available to the whole job, not only to the AWS credential
step. Consequently every credential-bearing job uses commit-pinned actions,
checks out with `persist-credentials: false`, installs no dependency, enables
no package-manager cache, and invokes audited dependency-free checked-in Node
entrypoints directly instead of `npm run`. An AWS step appearing later in the
file is not by itself a sufficient isolation boundary.
The canonical upstream repositories and release refs for those exact action
commits are recorded in
`docs/provenance/github-action-pins-public-audit-2026-08-26.json`.

`static-deploy-role.yaml` is the concrete static ordinary permission policy. Its
`Activation` parameter defaults to `disabled`, in which case CloudFormation
creates no role or role output. It is intentionally inactive until the static target is eligible and the
trust-first migration below is authorized. Its object permissions are limited
to the two HTML entries, site manifest, static status object, and the two
content-addressed asset prefixes; it cannot touch profile publications, delete
objects, use KMS, administer the bucket/distribution, or access any database.
Its only CloudFront write is an invalidation on the exact distribution ARN.

`server-profile-deploy-role.yaml` is the fail-closed concrete server role
definition for Datahike/S3, Datahike/DynamoDB, Datomic/DynamoDB, and the future
Datalevin/memory target. `Activation` defaults to `disabled`. An enabled stack
instance binds one exact profile OIDC subject, function/qualified-version ARN,
content-addressed artifact prefix, versioned profile-status key, and staged and
production distribution ARNs. It may publish code/versions and update aliases,
but cannot create functions, alter Function URLs or permissions, invalidate or
modify distributions, access stateful data, start compute, pass roles, delete
objects, or use KMS. This local definition is not evidence that any role or
ordinary workflow is live.

Generate or verify the deterministic policy bundle with:

```sh
npm run generate:github-oidc-policies
npm run verify:github-oidc-policies
```

## Safe external migration order

Do not change the repository template first: that would immediately invalidate
every role that still trusts the current default environment subject.

1. Reverify the public repository/owner IDs and current subject configuration.
2. Capture only decoded, allowlisted non-secret claims from one test job per
   distinct workflow/environment using the checked-in capture step; inspect the
   one-day claim artifact and never print or upload the JWT.
3. Add each generated custom subject and the exact direct claim conditions to
   its corresponding AWS role. If continuity is required, temporarily accept
   both that custom subject and the recorded current immutable environment
   subject; both values must remain exact.
4. Set the repository customization through the authenticated GitHub UI/API.
5. Rerun every OIDC job, verify the expected claims and successful role
   assumption, then remove every temporary default-subject alternative.
6. Audit that only `StringEquals` remains and no trust contains `StringLike`, a
   wildcard, an unlisted workflow/environment, or a stateful role in the
   ordinary deployment class.

The checked-in final policies intentionally contain only the required custom
subject. They do not encode the temporary dual-subject migration state. No AWS
or GitHub setting is changed merely by generating these files.
