# Demo delivery

`theronic/eacl-demo` is the sole deployment source. A push to `production` starts
five independent build-and-deploy jobs immediately:

- the shared explorer and conditionally loaded DataScript runtime;
- Datahike with S3;
- Datahike with DynamoDB;
- Datomic with DynamoDB; and
- Datalevin with embedded disk (LMDB; the profile ID is still
  `datalevin-memory`).

Jank is not an active deployment job. The workflow has no
concurrency group, latest-head guard, cross-run ordering rule, or fleet-wide
success barrier. A job deploys the exact demo commit that triggered it and the
exact EACL commit pinned by that revision’s `deps.edn`. Sibling failures do not roll back a
successful job.

Each job checks out once, builds its demo in the same runner, assumes only that
demo's deployment role, and invokes the live deployer. The workflow does not
upload and download its own artifacts, produce certification evidence, or wait
for a separate readiness decision.

## Static delivery

The static job builds one explorer application with a conditionally loaded
DataScript runtime. Root and legacy DataScript URLs serve the same application.
It uploads only the assembled manifest files to the private,
versioned, AWS-owned-encryption S3 bucket, then invalidates the two entry
documents. It does not delete bucket contents or touch server artifacts.

The `demo.eacl.dev` distribution has one origin: that private static bucket
through OAC. It serves the main entry and `/datascript/*`; `/datascript` is
rewritten to its entry document and the legacy `/datahike` path is rewritten to
the main entry. It has no Lambda origin, API behavior, API cache policy, origin
request policy, API signing function, or Lambda invoke permission.

`datomic.demo.eacl.dev` and `datalevin.demo.eacl.dev` are two further
distributions, both defined in `infra/profiles/datomic-dynamodb-ec2.yaml`. They
are API-only: each has one default behavior and one HTTP-only custom origin, its
own host (`datomic-origin.demo.eacl.dev` port 8080,
`datalevin-origin.demo.eacl.dev` port 8081), which accepts ingress only from
CloudFront. Both use the zero-TTL `ApiCachePolicy` and the
`ApiOriginRequestPolicy`, which forwards six viewer request headers (`Accept`,
`Content-Type`, `Origin`, `X-Eacl-Request-Id` and the two CORS preflight
headers) and no cookies or query string. Like the static topology they are
CloudFormation-owned: no deploy job changes a distribution.

The static content security policy allowlists nine exact API origins so the
browser can call them directly: seven Function URL origins (the four primaries
and the three 4,096 MiB comparison functions) and the two EC2 hostnames. It does
not permit wildcard Lambda origins.

## Server delivery

Each server job builds one content-addressed JAR and uploads it to the versioned
artifact bucket. For each Lambda function of its profile it publishes one
immutable version and moves only that function's `candidate` alias. The
corresponding alias-qualified Function URL therefore serves the version deployed
by that job. The Datahike/S3, Datahike/DynamoDB and Datomic/DynamoDB jobs deploy
two functions from the same JAR, the 1,769 MiB primary and the 4,096 MiB
comparison function; Datalevin has only the primary.

The Datomic and Datalevin jobs also release that JAR to their EC2 hosts
(`deployDatomicEc2` and `deployDatalevinEc2` in `scripts/deploy-live-demo.mjs`).
Once the profile's Lambda functions have passed their smoke, the job sends one
SSM `AWS-RunShellScript` command to the exact instance named by
`DATOMIC_DYNAMODB_EC2_INSTANCE_ID` or `DATALEVIN_EC2_INSTANCE_ID`. The command
downloads the exact artifact object version, checks its SHA-256, rewrites the
release lines of the host's environment file, installs the JAR and restarts the
service. The job then polls `https://datomic.demo.eacl.dev` or
`https://datalevin.demo.eacl.dev` for up to 15 minutes until health reports the
new release identity.

The bounded merge smoke uses direct Lambda invocation of each newly published
version for health, bootstrap, one allowed decision, one denied decision, a
two-page relationship read, rejection of the obsolete relationship-authorization
request shape, and mutation-route rejection; Datalevin adds a two-page resource
lookup. Once the alias has moved, it reads health through the public Function
URL and requires the new release identity and the `https://demo.eacl.dev` CORS
header. The EC2 release is confirmed the same way through the host's public
hostname; Datomic adds historical-date decisions and thirteen concurrent mixed
requests that must all succeed. The smoke does not run formal verification,
load tests, seed data, create tables, launch or start an EC2 instance, migrate
data, or modify cost controls. Those are separate lifecycles; the EC2 release
reaches only a host that is already running.

After smoke succeeds, and once the profile's comparison function and EC2 host,
where it has them, serve the same release, the job publishes only that
profile's registry document. The registry entry carries the actual demo SHA,
EACL SHA, artifact digest, Lambda version, deployment identity, data-manifest
digest, and outcome. Mixed profile generations are allowed and expected.

## Browser API path

The closed profile catalog maps each enabled server profile to one exact
`https://*.lambda-url.us-east-1.on.aws` origin, the profile's 1,769 MiB
function. The platform table in `packages/explorer-state/src/platforms.mjs`
adds the origins of the other platforms: a second Function URL for the
4,096 MiB comparison function of Datahike/S3, Datahike/DynamoDB and
Datomic/DynamoDB, and the EC2 origins `https://datomic.demo.eacl.dev` for
Datomic/DynamoDB and `https://datalevin.demo.eacl.dev` for Datalevin. The
browser builds `/{operation}` directly beneath the selected origin, for example
`/health` or `/check-permission`; there is no `/api/v1/{profile-id}` prefix. It
never sends server API requests to `demo.eacl.dev`:
`verification/results/direct-function-url-cutover-2026-08-27.json` records the
former same-origin `/api/v1/...` path returning 403.

The Function URLs use `AuthType: NONE` so ordinary browsers can invoke them.
Their resource policies allow only Function URL invocation and their CORS
configuration allows only `https://demo.eacl.dev`, GET/POST, and the exact
request headers used by the explorer. The EC2 origins are public too: each
host's HTTP adapter sets the same allowed origin and request headers itself and
serves the same closed route table. This public transport is not storage
authority: the service route table is read-only and every serving role lacks
storage mutation and maintenance permissions.

## Credentials and cost boundary

GitHub uses OIDC through the existing deployment role; no long-lived AWS key or
new secret is required. Ordinary deployment cannot create or seed durable
storage, launch EC2, manage KMS, send Telegram tests, or change CloudFront
infrastructure. Runtime CORS/resource policies and static CloudFront topology
are CloudFormation-owned infrastructure changes, not per-merge work.
