# `datomic-dynamodb`

Transactor-free read-only Peer service for Lambda and EC2. It captures one
current `d/db` during environment initialization; provisioning, transactor, and
seed code belong to private data workflows, not this service.

The serving URI is constructed only as
`datomic:ddb://REGION/TABLE/DATABASE?read-only=true`; callers cannot inject a
protocol, endpoint, credentials, or query parameters. Each request receives an
authenticated exact-basis EACL snapshot. The Lambda profile exposes its fixed
startup basis. The EC2 profile additionally exposes `historical-date`: it
resolves the requested instant against the retained Datomic history, issues an
authenticated token for the resulting native transaction basis, and keeps the
complete request—including cursor pages—on that exact basis. The initial wire
basis remains `fixed-environment`; a selected historical basis is reported as
`request-snapshot`.

Neither profile synchronizes with a writer during a request. Unknown and
unadvertised consistency modes fail before snapshot construction.
