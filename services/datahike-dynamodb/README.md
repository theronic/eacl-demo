# `datahike-dynamodb`

Read-only Java Lambda profile over a dedicated immutable Datahike DynamoDB
generation. The local source, package, and fake-reader boundary audits pass; the
profile remains disabled until DynamoDB Local, staged AL2023, and real-AWS
qualification pass for the exact data generation and artifact.

`dependencies/datahike-dynamodb-adapter.v1.json` binds the exact dependency
decision. The released upstream adapter is available only through the
`datahike-dynamodb-upstream-audit` alias so its four rejected behaviors remain
executable regression evidence. It is deliberately absent from the serving
alias and Lambda closure.

The serving aliases exclude the upstream ClojureScript dependency at the
Datahike and Konserve roots, and the package audit rejects ClojureScript,
Closure Compiler, browser assets, non-URL AWS clients, and the rejected
`konserve-dynamodb` adapter. `npm run build:datahike-dynamodb-lambda` creates the
normalized Lambda JAR; `npm run verify:datahike-dynamodb-lambda-artifact`
checks the closed read-only source set, bytecode bridge, package limits, AOT
loader behavior, packaged Datahike runtime, and request-snapshot boundary
without opening a DynamoDB connection. These local checks are not production
qualification and do not make the profile deployment-eligible.

Konserve's backing `-create-store` hook is a no-op because
`connect-default-store` invokes it while opening an existing in-place store;
locking is enabled as required by Konserve 0.9.378 and is implemented by the
reader's no-op read lock. This does not expose database creation: the public
Konserve `store/-create-store` multimethod is absent, the Datahike writer's
create/delete methods deny, and the SDK membrane/IAM surface remains read-only.
