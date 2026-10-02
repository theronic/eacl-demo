# Demo architecture

As of 2026-09-08, every enabled platform uses native v8 storage. The durable
targets are `eacl-demo-datahike-v8-843761893873-us-east-1`,
`eacl-demo-datahike-fixture-v8` and `eacl-demo-datomic-fixture-v8`; see the
[migration and retirement record](storage-v8-migration.md) for exact identities.
The pre-v8 data sources and the legacy EC2 fallback have since been deleted.
`serverless-datahike.demo.eacl.dev` now redirects to `demo.eacl.dev`; the
shared cache and notification secret remain managed in their original stacks.

`demo.eacl.dev` has one shared explorer source and two delivery paths. The
browser downloads static files through CloudFront, then calls the selected
server profile's API origin directly: an alias-qualified Lambda Function URL,
or `datomic.demo.eacl.dev` or `datalevin.demo.eacl.dev` for the EC2 platform.
The `demo.eacl.dev` distribution does not proxy, sign, cache, or otherwise
mediate API requests.

```text
                                      +----------------------------+
                                      | private versioned S3 bucket|
                                      | explorer + /datascript     |
                                      +-------------+--------------+
                                                    ^ OAC read only
                                                    |
Browser -- GET demo.eacl.dev ----------------> CloudFront
   |
   +-- Datahike / S3 -------------> Lambda Function URL -> Java 25 arm64, 1,769 or 4,096 MiB
   |                                                        -> migrated v8 S3 store
   |
   +-- Datahike / DynamoDB -------> Lambda Function URL -> Java 25 arm64, 1,769 or 4,096 MiB
   |                                                        -> immutable DynamoDB store
   |
   +-- Datomic / DynamoDB --------> Lambda Function URL -> Java 25 x86_64, 1,769 or 4,096 MiB
   |                                                        -> read-only Peer
   |                                                        -> DynamoDB table
   |                            \-> EC2 t3.small, 2,048 MiB -> same read-only Peer/table
   |
   +-- Datalevin / embedded disk -> Lambda Function URL -> Java 25 arm64, 1,769 MiB
   |                                                        -> SnapStart
   |                                                        -> embedded LMDB under /tmp
   |                            \-> EC2 t3.micro, 1,024 MiB -> embedded LMDB on its EBS volume
   |
   +-- DataScript / browser memory -> /datascript static entry
                                     -> page-local ClojureScript runtime
                                     -> no Lambda and no Worker
```

The server Function URLs are `AuthType: NONE` because browsers cannot
hold AWS credentials. Each URL is bound to the `candidate` alias, accepts only
the exact `https://demo.eacl.dev` CORS origin and the demo's GET/POST headers,
and exposes a closed read-only route table. CORS controls which browsers may
read responses; it is not authorization. EACL still evaluates every
authorization request, while Lambda roles and route tables deny storage writes
and maintenance operations.

A Lambda execution environment serves one request at a time and starts with
an empty Datahike or Datomic index-node cache, so concurrent Explorer requests
fan out to separate cold environments that each re-read the same nodes from
storage. The Explorer therefore issues requests to a Lambda-executed profile
one at a time, in call order, so a browsing session keeps landing on the
environment that already holds the nodes its previous requests touched. EC2
profiles keep concurrent requests: they are one resident peer with an
admission limit. Nothing is primed; every request still pays for whatever it
touches first, and its cache status reports exactly that.

Startup is the only request with a client deadline. The health/bootstrap
handshake that identifies a profile must finish within 30 seconds, otherwise
the Explorer cancels it and offers Retry. Ordinary requests have no client
deadline because the runtimes enforce their own. EC2 profiles send health and
bootstrap together, so startup costs one round trip; Lambda profiles send them
in lane order. Both EC2 adapters answer CORS preflights with the Function URLs'
`Access-Control-Max-Age` of 86400 seconds (browsers cap it, Chrome at two
hours), so a browser reuses each preflight instead of repeating it for every
request path. For the same reason Explorer requests keep the default fetch
cache mode: Chromium skips its preflight cache for `no-store` and `no-cache`
requests, and every response's own `cache-control: no-store` already keeps it
out of the HTTP cache.

The `demo.eacl.dev` distribution has one origin: the private static S3 bucket.
Its only additional cache behavior is the separate `/datascript/*` static
artifact. `datomic.demo.eacl.dev` and `datalevin.demo.eacl.dev` are two further
distributions, both defined in `infra/profiles/datomic-dynamodb-ec2.yaml`. Each
forwards uncached over HTTP to its own host (`datomic-origin.demo.eacl.dev`
port 8080, `datalevin-origin.demo.eacl.dev` port 8081), which accepts ingress
only from CloudFront. The content security policy permits connections to the
seven exact Function URL origins and the two EC2 hostnames, not a wildcard
Lambda domain.

The exact serving resources are listed below. The two foundation bucket names
and the distribution ID are as inspected live on 2026-08-28. The API origins
are the ones in `packages/contracts/profiles.v1.json` and
`packages/explorer-state/src/platforms.mjs`, and the data sources are the
targets in `infra/data/storage-v8-migration.json`:

- static site: S3 bucket `eacl-demo-foundation-staticbucket-af4yqivd185n`
  through CloudFront distribution `E1BIWUU7H35MWG`;
- deployment artifacts only (never a public serving origin): versioned S3
  bucket `eacl-demo-foundation-artifactbucket-xxzglw0b0v6t`;
- Datahike/S3: Function URL
  `https://nkpogjjpx5wyb4imujlrefedqu0qpqwu.lambda-url.us-east-1.on.aws`,
  4 GiB comparison URL
  `https://y66owmoqebrcmzyfw6uturkaue0exoqe.lambda-url.us-east-1.on.aws`,
  bucket `eacl-demo-datahike-v8-843761893873-us-east-1`, store
  `4e67bb31-557d-4f49-8b4c-699d39577310`;
- Datahike/DynamoDB: Function URL
  `https://cjg7vmjzdhpomcjac3nxgp5ina0iwakt.lambda-url.us-east-1.on.aws`,
  4 GiB comparison URL
  `https://ammics5svacgyu5eopgicnzz3y0lsryk.lambda-url.us-east-1.on.aws`,
  table `eacl-demo-datahike-fixture-v8`, store
  `2d692f8e-0778-49bf-aed7-241e93d63b2f`;
- Datomic/DynamoDB: Function URL
  `https://kfhndav4wq4rtmyugoriekcztm0mjrza.lambda-url.us-east-1.on.aws`,
  4 GiB comparison URL
  `https://7um6u6hb6wq6yfl46ukjkxcpuy0gexer.lambda-url.us-east-1.on.aws`,
  and EC2 URL `https://datomic.demo.eacl.dev`, all reading table
  `eacl-demo-datomic-fixture-v8`;
- Datalevin/embedded disk: Function URL
  `https://n56bfv3ompn6h4cqnxsi5bhavm0gwfrm.lambda-url.us-east-1.on.aws`
  and EC2 URL `https://datalevin.demo.eacl.dev`, each over its own embedded
  LMDB built from the same immutable fixture;
- DataScript/browser memory: the `/datascript/` static artifact, with no
  server-side storage.

The Datomic comparison is served by `i-01f2d07f50ad1cb5d`, a `t3.small` with
a fixed 1 GiB JVM heap, a 576 MiB Datomic object cache, and four admission
permits. The Datalevin comparison is served by its own host,
`i-088bcf1a4dd88e165`, a dedicated `t3.micro` in unlimited credit mode with a
224 MiB maximum JVM heap and one admission permit. It shares only the existing
demo VPC and subnet, and its fixture root `/var/lib/eacl-demo/datalevin` is on
the encrypted EBS root volume. The legacy Datahike instance
`i-04761ff3afba454ab` (`t4g.large`, Elastic IP `54.163.189.23`) is no longer a
retained fallback: the instance, its volume and its network were removed and
the Elastic IP released when the legacy demo was retired on 2026-09-08; see the
[legacy retirement record](../infra/legacy/README.md). The temporary
Datahike/DynamoDB seed machine and all of its temporary network, role, volume,
and address resources were removed after the verified seed and backup
completed.

The listed sizes are the ones the repository declares, not a live AWS
inspection. Lambda memory and SnapStart come from
`scripts/deploy-live-demo.mjs`, which sets both on every release and rejects a
published version that differs; timeouts and ephemeral storage come from
`infra/profiles/*-runtime.yaml`; the EC2 hosts come from
`infra/profiles/datomic-dynamodb-ec2.yaml` and
`infra/profiles/datalevin-memory-ec2.yaml`, and their instance IDs from
`infra/deployment/server-profile-deploy-role.yaml`. The exact Lambda
configuration remains authoritative: the Datahike functions have a 30-second
timeout; the Datomic and Datalevin functions have 60-second timeouts; each has
512 MiB ephemeral storage. The Datahike, Datomic, and Datalevin `candidate`
versions use SnapStart. The Datomic artifact warms its read-only Peer and EACL
paths before the snapshot is taken; AWS-managed runtime credentials remain
refreshable after restore.
