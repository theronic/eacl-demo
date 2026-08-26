# Datalevin Linux arm64 native ABI audit

The exact `org.clojars.huahaiy/dtlvnative-linux-arm64:0.18.8` JAR was
inspected locally by content digest with
`scripts/qualify-datalevin-native-arm64.mjs --report-only`. Its SHA-256 is
`427e294ea996632df355695c43eca08bd9d0b24e77db60e36a057faf3ac6896d`.

All three admitted native entries are Linux AArch64 ELF64 shared libraries and
their byte digests and `DT_NEEDED` closures match the dependency decision.
Each imports symbols through `GLIBC_2.38`. The planned managed Lambda runtime
is `java25` on Amazon Linux 2023, whose glibc baseline is 2.34. The artifact is
therefore ABI-incompatible and cannot be packaged or deployed for this
profile.

This report is intentionally negative evidence. `--report-only` prevents the
known mismatch from hiding the diagnostic output; the qualification command
without that flag exits nonzero. It does not prove arm64 execution, SnapStart,
snapshot ownership, source lifecycle, memory fit, or production transport.
`datalevin-memory` remains non-enabled and `deploymentEligible: false` until a
published maintained-fork/native closure built against an AL2023-compatible
sysroot passes the full gate.
