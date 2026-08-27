# `demos` branch delivery

`theronic/eacl-demo` is the sole deployment source. A push to `demos` starts
four independent jobs immediately:

- the main explorer and separate DataScript static artifact;
- Datahike with S3;
- Datomic with DynamoDB; and
- Datalevin with page-lifecycle memory.

Jank and Datahike/DynamoDB are not active deployment jobs. The workflow has no
concurrency group, latest-head guard, cross-run ordering rule, or fleet-wide
success barrier. A job deploys the exact demo commit that triggered it and the
exact EACL commit locked by that revision. Sibling failures do not roll back a
successful job.

## Static delivery

The static job builds the main explorer and DataScript from the same shared
components. It uploads only the assembled manifest files to the private,
versioned, AWS-owned-encryption S3 bucket, then invalidates the two entry
documents. It does not delete bucket contents or touch server artifacts.

CloudFront has one origin: that private static bucket through OAC. It serves
the main entry and `/datascript/*`; `/datascript` is rewritten to its entry
document and the legacy `/datahike` path is rewritten to the main entry. It has
no Lambda origin, API behavior, API cache policy, origin request policy, API
signing function, or Lambda invoke permission.

The static content security policy allowlists the exact enabled Function URL
origins so the browser can call them directly. It does not permit wildcard
Lambda origins.

## Server delivery

Each server job builds one content-addressed JAR, uploads it to the versioned
artifact bucket, publishes one immutable Lambda version, and moves only that
function's `candidate` alias. The corresponding alias-qualified Function URL
therefore serves the version deployed by that job.

The bounded merge smoke uses direct Lambda invocation for health, bootstrap,
one allowed decision, one denied decision, and mutation-route rejection. It
does not run formal verification, load tests, seed data, create tables, start
EC2, migrate data, or modify cost controls. Those are separate lifecycles.

After smoke succeeds, the job publishes only that profile's registry document.
The registry entry carries the actual demo SHA, EACL SHA, artifact digest,
Lambda version, deployment identity, data-manifest digest, and outcome. Mixed
profile generations are allowed and expected.

## Browser API path

The closed profile catalog maps each enabled server profile to one exact
`https://*.lambda-url.us-east-1.on.aws` origin. The browser builds
`/api/v1/{profile-id}/{operation}` beneath that origin. It never sends server
API requests to `demo.eacl.dev`.

The Function URLs use `AuthType: NONE` so ordinary browsers can invoke them.
Their resource policies allow only Function URL invocation and their CORS
configuration allows only `https://demo.eacl.dev`, GET/POST, and the exact
request headers used by the explorer. This public transport is not storage
authority: the service route table is read-only and every serving role lacks
storage mutation and maintenance permissions.

## Credentials and cost boundary

GitHub uses OIDC through the existing deployment role; no long-lived AWS key or
new secret is required. Ordinary deployment cannot create or seed durable
storage, launch EC2, manage KMS, send Telegram tests, or change CloudFront
infrastructure. Runtime CORS/resource policies and static CloudFront topology
are CloudFormation-owned infrastructure changes, not per-merge work.
