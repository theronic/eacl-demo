# Dependency lock policy

Dependency resolution is isolated by ecosystem:

- `package-lock.json` is the npm lock and must remain lockfile version 3.
- `deps.edn` contains exact JVM coordinates; `dependencies/jvm.lock.json` resolves each independently callable alias separately, then records the union of JAR SHA-256 digests, byte sizes, and consuming aliases. Independent Git-root modules are never forced into one invalid synthetic classpath.
- `dependencies/native.lock.json` records the proven development closure and independently tracks the Lambda target. An unresolved target remains disabled and cannot fall back to the development host.
- `infra/requirements.lock` pins every Python infrastructure dependency transitively with accepted package hashes. Regeneration uses the `pip` and `pip-tools` versions in `toolchain.json`; this avoids the observed incompatibility between pip-tools 7.5.2 and the newer pip bundled with Python 3.14.

`node scripts/verify-locks.mjs` checks the cross-file invariants. Any service-specific dependency added later must enter the appropriate isolated lock and clean-build evidence; local Maven checkouts, npm links, editable Python installs, Homebrew paths, and mutable version selectors are forbidden release inputs.

ClojureScript belongs only to the `datascript-worker` root alias. Datomic and
Datalevin server classpaths are audited to exclude the ClojureScript and Closure
Compiler toolchain. Datahike's upstream cross-platform graph declares browser
compiler dependencies, so both serving aliases exclude ClojureScript at their
Datahike/Konserve roots and both Lambda package audits reject compiler or
browser entries. This closed local JVM evidence does not replace the required
clean AL2023 and staged qualification.

The Datomic lock records both the Maven Peer artifact and the official full
Pro distribution used only by temporary transactor compute. The distribution
URL, byte length, SHA-256, versioned root, and supported LTS Java versions are
closed inputs. Temporary compute must verify the ZIP before extraction and
must never fetch an unversioned "latest" download.

`dependencies/datalevin-memory.v1.json` is a fail-closed dependency decision,
not an accepted release lock. It records the clean maintained-fork candidate,
the absent reserved release coordinate, the development-only local-root EACL
adapter edge, and the exact Linux arm64 native JAR. The current native shared
libraries require glibc 2.38 while Lambda `java25` runs on Amazon Linux 2023
with glibc 2.34, so the profile cannot build or deploy from that artifact. The
decision must be replaced with a published-coordinate, clean-consumer, exact
AL2023 arm64 audit before any Datalevin service source is admitted.
