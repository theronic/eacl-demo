# `datahike-dynamodb`

Read-only Java Lambda profile over a dedicated immutable Datahike DynamoDB
generation. The local source, package, and fake-reader boundary audits pass; the
profile remains disabled until DynamoDB Local, staged AL2023, and real-AWS
qualification pass for the exact data generation and artifact.

The service uses its local, read-only Konserve adapter. The serving source and
resolved classpath audits reject the upstream `konserve-dynamodb` adapter and
all write-capable AWS SDK operations; no duplicate dependency-decision
manifest or audit-only dependency is required.

The serving aliases exclude the upstream ClojureScript dependency at the
Datahike and Konserve roots, and the package audit rejects ClojureScript,
Closure Compiler, browser assets, non-URL AWS clients, and the rejected
`konserve-dynamodb` adapter. `npm run build:datahike-dynamodb-lambda` creates the
normalized Lambda JAR; `npm run verify:datahike-dynamodb-lambda-artifact`
checks the closed read-only source set, bytecode bridge, package limits, AOT
loader behavior, packaged Datahike runtime, and request-snapshot boundary
without opening a DynamoDB connection. These local checks are not production
qualification and do not make the profile deployment-eligible.

Konserve checks the backing store's `-store-exists?` exactly once before
opening it. If the table is absent, the backing `-create-store` hook throws the
typed `:eacl-demo/missing-dynamodb-store` failure instead of creating anything.
Locking is enabled as required by Konserve and is implemented by the reader's
no-op read lock. The public Konserve `store/-create-store` multimethod remains
absent, the Datahike writer's create/delete methods deny, and the SDK
membrane/IAM surface remains read-only.
