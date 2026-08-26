# Datalevin AL2023 arm64 native candidate

On 2026-08-26, the qualification-only
`dtlvnative-linux-arm64-0.18.8-eacl.al2023.1.jar` was built twice from scratch
with `infra/builders/datalevin-native-al2023-arm64.Dockerfile`. The second run
used BuildKit `--no-cache`. Both outputs were byte-identical:

- bytes: `3579574`
- SHA-256: `be264ee95cf67148194a87b9ef9d533d74caa7dbb2f64bac29a1e159498dcb63`
- source commit: `5b52192dd81c65edc2a9322a49dd9466e4941772`
- platform: `linux/arm64`
- base: Amazon Linux 2023 arm64 manifest
  `sha256:d114e9857686bd3faa025755505a293f281cbcca7800890baa6db899832a0060`
- exact Lambda Java 25 arm64 runtime image:
  `sha256:2db07309181969fade96d0cb251b5f51ffb64ed1eb729b16cb6feaa74a63bb7c`

The exact-identity audit in
`native-abi-al2023-candidate-2026-08-26.json` admits only `libdtlv.so`,
`libgomp.so`, and `libjniDTLV.so`. Every library is AArch64 ELF64 and imports
no GLIBC version newer than 2.34. The only runtime path is `$ORIGIN`; the
JavaCPP-generated absolute build path is removed before packaging.

The builder loaded the exact JAR on Corretto 25 in AL2023 and completed a
native write/commit/read round trip using `mdb_env_open` with a null path and
`MDB_INMEMORY`. The same round trip also passed offline in the exact pinned
Lambda Java 25 arm64 runtime image. This proves local ABI compatibility and
true native memory mode for these bytes. It does not prove the managed Lambda
service or SnapStart lifecycle safety.

This is deliberately not a release. The candidate uses a qualification-only
name and must not overwrite upstream version 0.18.8. Datalevin remains
unavailable until a new immutable maintained coordinate is published, a clean
remote consumer resolves the exact bytes, the maintained Datalevin fork and
EACL adapter are released, and the Lambda/SnapStart lifecycle gates pass.
