# Demo architecture

`demo.eacl.dev` has one shared explorer source and two delivery paths. The
browser downloads static files through CloudFront, then calls the selected
server profile's alias-qualified Lambda Function URL directly. CloudFront does
not proxy, sign, cache, or otherwise mediate API requests.

```text
                                      +----------------------------+
                                      | private versioned S3 bucket|
                                      | explorer + /datascript     |
                                      +-------------+--------------+
                                                    ^ OAC read only
                                                    |
Browser -- GET demo.eacl.dev ----------------> CloudFront
   |
   +-- Datahike / S3 ----------> Lambda Function URL -> Java 25 arm64, 1,024 or 4,096 MiB
   |                                                     -> adopted S3 store
   |
   +-- Datahike / DynamoDB ----> Lambda Function URL -> Java 25 arm64, 1,024 or 4,096 MiB
   |                                                     -> immutable DynamoDB store
   |
   +-- Datomic / DynamoDB -----> Lambda Function URL -> Java 25 x86_64, 1,024 or 4,096 MiB
   |                                                     -> read-only Peer
   |                                                     -> DynamoDB table
   |                         \-> EC2 t3.micro, 1,024 MiB -> same read-only Peer/table
   |
   +-- Datalevin / memory -----> Lambda Function URL -> Java 25 arm64, 1,024 MiB
   |                                                     -> SnapStart
   |                                                     -> in-memory LMDB
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

CloudFront has one origin: the private static S3 bucket. Its only additional
cache behavior is the separate `/datascript/*` static artifact. The content
security policy permits connections to the four exact Function URL origins,
not a wildcard Lambda domain.

The exact serving resources inspected on 2026-08-28 are:

- static site: S3 bucket `eacl-demo-foundation-staticbucket-af4yqivd185n`
  through CloudFront distribution `E1BIWUU7H35MWG`;
- deployment artifacts only (never a public serving origin): versioned S3
  bucket `eacl-demo-foundation-artifactbucket-xxzglw0b0v6t`;
- Datahike/S3: Function URL
  `https://nkpogjjpx5wyb4imujlrefedqu0qpqwu.lambda-url.us-east-1.on.aws`,
  4 GiB comparison URL
  `https://y66owmoqebrcmzyfw6uturkaue0exoqe.lambda-url.us-east-1.on.aws`,
  bucket `demo-eacl-datahike-v2-843761893873-us-east-1`, store
  `4e67bb31-5480-4734-bb55-9c33e35953bf`;
- Datahike/DynamoDB: Function URL
  `https://cjg7vmjzdhpomcjac3nxgp5ina0iwakt.lambda-url.us-east-1.on.aws`,
  4 GiB comparison URL
  `https://ammics5svacgyu5eopgicnzz3y0lsryk.lambda-url.us-east-1.on.aws`,
  table `eacl-demo-datahike-fixture-v1-green`, store
  `2d692f8e-0778-49bf-aed7-241e93d63b2f`;
- Datomic/DynamoDB: Function URL
  `https://kfhndav4wq4rtmyugoriekcztm0mjrza.lambda-url.us-east-1.on.aws`,
  4 GiB comparison URL
  `https://7um6u6hb6wq6yfl46ukjkxcpuy0gexer.lambda-url.us-east-1.on.aws`,
  and EC2 URL `https://datomic.demo.eacl.dev`, all reading table
  `eacl-demo-datomic-fixture-v1-green`;
- Datalevin/memory: Function URL
  `https://n56bfv3ompn6h4cqnxsi5bhavm0gwfrm.lambda-url.us-east-1.on.aws`;
- DataScript/browser memory: the `/datascript/` static artifact, with no
  server-side storage.

The Datomic comparison is served by `i-01f2d07f50ad1cb5d`, a `t3.micro` with
one admission slot per HTTP worker and four HTTP workers. The stopped legacy
Datahike instance `i-04761ff3afba454ab` (`t4g.large`, retained Elastic IP
`54.163.189.23`) is a separately retained fallback and is not on the request
path. The temporary Datahike/DynamoDB seed machine and all of its temporary
network, role, volume, and address resources were removed after the verified
seed and backup completed.

The listed sizes are a live AWS inspection captured on 2026-08-28. The exact
Lambda configuration remains authoritative: both Datahike functions have a
30-second timeout; Datomic and Datalevin have 60-second timeouts; each has 512
MiB ephemeral storage. The Datahike, Datomic, and Datalevin `candidate`
versions use SnapStart. The Datomic artifact warms its read-only Peer and EACL
paths before the snapshot is taken; AWS-managed runtime credentials remain
refreshable after restore.
