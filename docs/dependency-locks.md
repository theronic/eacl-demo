# Dependency policy

`dependencies/eacl-core.lock.json` is the sole coordinated product-version
lock. Every demo is built and deployed from that exact EACL commit.

Third-party dependencies are ordinary implementation dependencies. Their
versions live only in the package-manager inputs that consume them:
`package.json`/`package-lock.json`, `deps.edn`, and `infra/requirements.lock`.
Upgrading one does not require a second digest ledger, dependency-decision
manifest, or certification gate.

Runtime safety checks remain where they test behavior that matters: the
read-only DynamoDB membrane, browser/server classpath isolation, native ABI and
platform compatibility, artifact loading, and request-boundary tests. Those
checks must not encode an otherwise arbitrary exact third-party version.
