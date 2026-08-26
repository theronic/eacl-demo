# Toolchain policy

`toolchain.json` is the authoritative, closed tool version record. Version-manager files mirror it for developer convenience; they are not independent release inputs. CI must compare installed versions with the record before building.

The JavaScript baseline is Node 24.19.0 LTS and its bundled npm 11.17.0. JVM builds use Eclipse Temurin semver 25.0.4+101.0.LTS (the patched runtime reports 25.0.4.1+1-LTS), Clojure 1.12.5, Clojure CLI 1.12.5.1664, and ClojureScript 1.12.42. Infrastructure is raw CloudFormation validated with AWS CLI 2.34.53, cfn-lint 1.55.1, and check-jsonschema 0.38.0. Formatter, linter, and test runner versions are exact rather than ranges.

EACL Core defaults its generated formal JVM runtime to Java 26, which is too
new for the pinned Java 25 Lambda runtime. Demo preparation therefore sets
`EACL_JAVA_RELEASE=25`, checks every generated class in the exact checkout-level
directory consumed by `build.clj`, and rejects anything other than classfile
major 69. Each packaged JVM audit independently checks and loads
`EaclKernel.__default`, so a stale Java 26 class cannot pass by loading only the
Java 17 Lambda bridge.

The recorded Jank development artifact is the locally proven macOS arm64 toolchain imported from the Jank compatibility manifest. Its hashes and bundled Clang 23 compiler are pinned, but `lambdaEvidence` is false. It must never be packaged for Lambda. The target-specific lock pins a reproducible Linux x86_64 Amazon Linux 2023-compatible builder, Jank revision, compiler, native dependency closure, and the exact amd64 Lambda AL2023 filesystem used for smoke. The vendored runtime port also has an explicit older-Core mismatch. Semantic rebase evidence is accumulated as individually named, executable deltas: cache lookup/publication separation, sealed-plan read-scope certification, and locked-Core validation identities are currently proven, while the exhaustive 33-path coverage ledger keeps every remaining partial or unqualified delta fail-closed. The development compiler's public-handler `case` code-generation defect is covered by predicate-based adapter branches plus focused and full interpreted regressions; this is not Linux or Lambda evidence. The Jank profile therefore remains unavailable until full source compatibility and Linux artifact qualification pass.

An update changes `toolchain.json`, all applicable mirror files, dependency locks, clean-build evidence, and artifact manifests in one reviewed commit. Mutable tags such as `latest`, `LTS`, version ranges, floating container tags, and unverified locally installed tools are not build identities.
