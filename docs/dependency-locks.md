# Dependency policy

`deps.edn` is the sole source of truth for the pinned EACL Core commit: every
`dev.eacl/eacl*` coordinate carries the canonical repository URL and the same
exact 40-hex `:git/sha` (the datalevin module and the staged formal-class
paths embed the same SHA). `scripts/lib/eacl-core.mjs` derives the single Core
identity from it — at CI build time from the `deps.edn` committed at the
triggering commit — and fails when any pin disagrees. There is no separate
lock file. Every demo is built and deployed from that exact EACL commit.

Third-party dependencies are ordinary implementation dependencies. Their
versions live only in the package-manager inputs that consume them:
`package.json`/`package-lock.json`, `deps.edn`, and `infra/requirements.lock`.
Upgrading one does not require a second digest ledger, dependency-decision
manifest, or certification gate.

Runtime safety checks remain where they test behavior that matters: the
read-only DynamoDB membrane, browser/server classpath isolation, native ABI and
platform compatibility, artifact loading, and request-boundary tests. Those
checks must not encode an otherwise arbitrary exact third-party version.
