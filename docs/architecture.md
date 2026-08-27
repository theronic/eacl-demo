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
   +-- Datahike / S3 ----------> Lambda Function URL -> Java 25 arm64, 4,096 MiB
   |                                                     -> adopted S3 store
   |
   +-- Datomic / DynamoDB -----> Lambda Function URL -> Java 25 x86_64, 3,072 MiB
   |                                                     -> read-only Peer
   |                                                     -> DynamoDB table
   |
   +-- Datalevin / memory -----> Lambda Function URL -> Java 25 arm64, 6,144 MiB
   |                                                     -> SnapStart
   |                                                     -> in-memory LMDB
   |
   +-- DataScript / browser memory -> /datascript static entry
                                     -> page-local ClojureScript runtime
                                     -> no Lambda and no Worker
```

The three server Function URLs are `AuthType: NONE` because browsers cannot
hold AWS credentials. Each URL is bound to the `candidate` alias, accepts only
the exact `https://demo.eacl.dev` CORS origin and the demo's GET/POST headers,
and exposes a closed read-only route table. CORS controls which browsers may
read responses; it is not authorization. EACL still evaluates every
authorization request, while Lambda roles and route tables deny storage writes
and maintenance operations.

CloudFront has one origin: the private static S3 bucket. Its only additional
cache behavior is the separate `/datascript/*` static artifact. The content
security policy permits connections to the three exact Function URL origins,
not a wildcard Lambda domain.

No active EC2 machine serves this architecture. The stopped legacy Datahike
instance is a separately retained fallback and is not on the request path.

The listed sizes are a live AWS inspection captured on 2026-08-27. The exact
Lambda configuration remains authoritative: Datahike has a 30-second timeout;
Datomic and Datalevin have 60-second timeouts; each has 512 MiB ephemeral
storage. The current Datalevin `candidate` version has SnapStart optimization
on, while Datahike and Datomic have SnapStart off.
