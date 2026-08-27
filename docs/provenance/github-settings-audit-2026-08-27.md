# GitHub settings audit — 2026-08-27

This is a redacted audit of the authenticated settings for
`theronic/eacl-demo`. The changes and the persisted state were inspected through
the user's connected Chrome session. No secret value, authentication token,
cookie, password, passkey, or OIDC bearer token was read or retained.

## Repository and Actions policy

- Repository: `theronic/eacl-demo`
- Immutable owner ID: `1011676`
- Immutable repository ID: `1345904214`
- Default `GITHUB_TOKEN` permission: read repository contents and packages
- GitHub Actions may create or approve pull requests: disabled
- Repository Actions secrets: none
- Environment Actions secrets for the production environments: none
- Ordinary deployment workflow: `.github/workflows/deploy-demos.yml`, triggered
  by a push to `demos`
- Workflow run 49, attempt 2, completed successfully at commit
  `2d4d5ce7511745d18911c4fb1033eb0c2922a509`; all five build jobs and all five
  independently promoted deployment jobs succeeded.

The repository variables page contains only non-secret deployment coordinates.
The audited names are:

- `AWS_DATAHIKE_DYNAMODB_DEPLOY_ROLE_ARN`
- `AWS_DATAHIKE_S3_DEPLOY_ROLE_ARN`
- `AWS_DATALEVIN_MEMORY_DEPLOY_ROLE_ARN`
- `AWS_DATOMIC_DYNAMODB_DEPLOY_ROLE_ARN`
- `AWS_REGION`
- `AWS_STATIC_DEPLOY_ROLE_ARN`
- `DEMO_DEPLOY_ROLE_ARN`
- `EACL_DEMO_ARTIFACT_BUCKET`
- `EACL_DEMO_DISTRIBUTION_ID`
- `EACL_DEMO_STATIC_BUCKET`

`AWS_DATAHIKE_DYNAMODB_DEPLOY_ROLE_ARN` was added through Chrome with the
non-secret value
`arn:aws:iam::843761893873:role/eacl-demo-deploy-datahike-dynamodb`. The failed
Datahike/DynamoDB job was then rerun without rerunning successful siblings; its
OIDC claim capture, AWS role assumption, deployment, bounded smoke, and alias
promotion all passed.

## OIDC subject

The persisted repository OIDC settings are:

- use default template: false
- use immutable subject claim: true
- immutable prefix: `repo:theronic@1011676/eacl-demo@1345904214`
- ordered custom template:
  `repo, ref, workflow_ref, environment, event_name, runner_environment`

All five ordinary deploy roles have one exact `StringEquals` trust statement
with the immutable repository and owner IDs, `theronic/eacl-demo`,
`refs/heads/demos`, `Deploy EACL demos`, their exact environment,
`sts.amazonaws.com`, and the matching immutable custom subject. Run 49's five
signature-verified allowlisted claim-capture steps passed in custom-subject mode
without retaining their JWTs. Manual qualification, transition, and stateful
authorities are not claimed complete by this audit; task 14.1 remains open until
every active manual authority is independently captured and migrated.

## Production deployment environments

Each active production environment exists separately, has no required reviewer,
has no wait timer, contains no environment secret or variable, and permits only
the `demos` branch:

| Environment | Branch policy | Reviewers | Wait timer |
| --- | --- | --- | --- |
| `demo-production-static` | selected branch `demos` | none | none |
| `demo-production-datahike-s3` | selected branch `demos` | none | none |
| `demo-production-datahike-dynamodb` | selected branch `demos` | none | none |
| `demo-production-datomic-dynamodb` | selected branch `demos` | none | none |
| `demo-production-datalevin-memory` | selected branch `demos` | none | none |

No ordinary Jank production environment exists.

## `demos` branch protection

The persisted classic protection rule applies to exactly `demos` and requires a
pull request before merging. Required approvals, required status checks, code
owner review, conversation resolution, deployments, signatures, and linear
history are disabled. Administrator bypass is disabled, and force pushes and
branch deletion are not allowed. This preserves fast, no-review merges while
preventing direct or destructive updates from bypassing the deployment branch.
