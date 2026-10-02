# Dependency policy

`deps.edn` is the sole source of truth for the EACL release the demo runs:
every published `dev.eacl/eacl*` module is a Maven coordinate with the same
`:mvn/version`, and the unpublished `eacl-datalevin` module builds from that
release's source commit, staged at `target/eacl-core-source/<sha>` (its
`:local/root` embeds the 40-hex SHA). `scripts/lib/eacl-core.mjs` derives the
single release identity from it — at CI build time from the `deps.edn`
committed at the triggering commit — and fails when any version or SHA
disagrees. `scripts/lib/prepare-eacl-core.mjs` checks, on every build, that
the published `dev.eacl/eacl` POM names that same commit as its SCM tag and
that its generated kernel classes load on Java 25. There is no separate lock
file. Every demo is built and deployed from that exact EACL release.

Third-party dependencies are ordinary implementation dependencies. Their
versions live only in the package-manager inputs that consume them:
`package.json`/`package-lock.json`, `deps.edn`, and `infra/requirements.lock`.
Upgrading one does not require a second digest ledger, dependency-decision
manifest, or certification gate.

Runtime safety checks remain where they test behavior that matters: the
read-only DynamoDB membrane, browser/server classpath isolation, native ABI and
platform compatibility, artifact loading, and request-boundary tests. Those
checks must not encode an otherwise arbitrary exact third-party version.
