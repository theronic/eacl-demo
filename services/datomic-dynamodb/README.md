# `datomic-dynamodb`

Transactor-free read-only Peer Lambda that captures one current `d/db` during environment initialization. Provisioning/transactor/seed code belongs to private data workflows, not this service.

The serving URI is constructed only as
`datomic:ddb://REGION/TABLE/DATABASE?read-only=true`; callers cannot inject a
protocol, endpoint, credentials, or query parameters. Each request receives an
authenticated exact-basis EACL snapshot selected from the retained DB value.
Only absent or `minimize` consistency inputs pass the public boundary. Its wire basis
behavior is the contract term `fixed-environment`. Synchronized,
exact, historical, and unknown future modes fail before snapshot construction.

The underlying seeded database is required to retain normal Datomic history for
a future, separately deployed non-read-only EC2 demo. That future deployment is
out of scope here and does not broaden this Lambda's fixed-current capability.
