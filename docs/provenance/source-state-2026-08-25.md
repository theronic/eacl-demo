# Source-state provenance

Captured at `2026-08-25T09:55:41.059Z` for OpenSpec task 1.1.

This is an observational record. No sibling checkout was cleaned, reset, staged, committed, or otherwise modified by the capture tool. The JSON companion is authoritative for exact arrays and hashes.

## eacl-core

- Kind: `core`
- Directory: `/Users/petrus/code/eacl/core`
- HEAD: `8dc3b16498788dd822b68e1c4fe25b37a8e8879f`
- Branch: `agent/support-intersection-and-exclusion`
- Upstream: none
- Status manifest SHA-256: `9cecd45766a0ea841d3f021729a02b475ccd3049c04f40edb9d061d659015b89`
- Build status: `failed` — 846 tests and 46,325 assertions ran; 5 failures and 0 errors.

Remotes:

- fetch `origin`: `git@github.com:theronic/eacl.git`
- push `origin`: `git@github.com:theronic/eacl.git`

Dependency manifests and locks:

- `deps.edn` — `579d8fbf9ea47bfc0c1b56bf222c07637c5c2f8f2cf2cf9f658a29703fda35a7` (8968 bytes)
- `exploration/stable-discovery/backend-probes/deps.edn` — `aced3a2b6eeff9d82ea292b94ce5af9e9c75f0a460b721902ee78aadb669396d` (566 bytes)
- `formal/smoke/js/package-lock.json` — `8ea5a5608f313763c4261c9f6c9d5ca8f61bc834f1aa6f8ada8317aae8202e9a` (15240 bytes)
- `formal/smoke/js/package.json` — `3d8a9d7a86709d832d184e6f3c516e28833d5d6439f0f01f844025a4c21473cd` (236 bytes)
- `modules/eacl/deps.edn` — `163ca71dbf96a430cbfe2a6a0953e71c6d418333d41528612fa3da8933cb28c9` (775 bytes)
- `modules/eacl-datahike/deps.edn` — `5a11e49359958356b64ee1f2b78f46e70d710ec0444993be08171d4e93002970` (1079 bytes)
- `modules/eacl-datalevin/deps.edn` — `7cfa123eb8b2971a16f926a6db5ac05b36b688f00d89631a99da095210b546f3` (1983 bytes)
- `modules/eacl-datascript/deps.edn` — `bceb3b8741830e6f3a80c57a7782b6d060f04e5a28d0c4ad40f75f9336d45c47` (1362 bytes)
- `modules/eacl-datomic/deps.edn` — `afa6ab4a1356ed5d73bbeb4193e16f3d9ca0341bf97f7152d50f2ea4fd4c92d8` (1294 bytes)
- `src-build/deps.edn` — `b364db1e64f1ef722956e0347a605c808e4d342e1afb0145cf20ff211ea21ed8` (78 bytes)

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid 8dc3b16498788dd822b68e1c4fe25b37a8e8879f
# branch.head agent/support-intersection-and-exclusion
1 .M N... 100644 100644 100644 90f8ac26c5b1c2a4d3430fbd41d88d1b992c40ab 90f8ac26c5b1c2a4d3430fbd41d88d1b992c40ab .github/workflows/formal.yml
1 .M N... 100644 100644 100644 a2086168ee4e4f19f6b308e21a8e2a273fab3365 a2086168ee4e4f19f6b308e21a8e2a273fab3365 README.md
1 .M N... 100644 100644 100644 a829ad717736e904d4da6d5c9554945a963899ac a829ad717736e904d4da6d5c9554945a963899ac bin/ci-nrepl-eval
1 .M N... 100755 100755 100755 b82c29d28728eddff45c0be3ee372c5e422ca9ae b82c29d28728eddff45c0be3ee372c5e422ca9ae bin/formal
1 .M N... 100755 100755 100755 b7e20db7c998ee39573e2af2f41e617bbdd5dcc9 b7e20db7c998ee39573e2af2f41e617bbdd5dcc9 bin/generate-verification-manifest
1 .M N... 100755 100755 100755 5a685313250087cb5ade5a22dd1c5a1f99591ae9 5a685313250087cb5ade5a22dd1c5a1f99591ae9 bin/public-source-closure.mjs
1 .M N... 100755 100755 100755 99424c5d35b6558694c8116677fc1f1314b66227 99424c5d35b6558694c8116677fc1f1314b66227 bin/validate-verification-manifest
1 .M N... 100644 100644 100644 0f5dc277afbf4838e2ae7a7aa6f1620e25051f82 0f5dc277afbf4838e2ae7a7aa6f1620e25051f82 deps.edn
1 .M N... 100644 100644 100644 9c563f1c8958d9a3bed037c6f28ab7c4ea5de7f4 9c563f1c8958d9a3bed037c6f28ab7c4ea5de7f4 docs/formal-verification.md
1 .M N... 100644 100644 100644 95f7f358b7e92c034e201f3af15b9644b495081e 95f7f358b7e92c034e201f3af15b9644b495081e formal/README.md
1 .M N... 100644 100644 100644 ae9623ecccdddc7ce0479572b8314d6fcf692c67 ae9623ecccdddc7ce0479572b8314d6fcf692c67 formal/dafny/EaclKernel.dfy
1 .M N... 100644 100644 100644 fb1f877fd9b4f5f34ee776a0630fda892a7c194b fb1f877fd9b4f5f34ee776a0630fda892a7c194b formal/smoke/clj/eacl/formal/cross_runtime_vector_test.clj
1 .D N... 100644 100644 000000 e78149bde7396f5453a9839bc118a2eabc4d05a9 e78149bde7396f5453a9839bc118a2eabc4d05a9 formal/smoke/clj/eacl/formal/indexed_authority_benchmark.clj
1 .D N... 100644 100644 000000 bc284861b6a29db2640a5cace9a7d32b1f494383 bc284861b6a29db2640a5cace9a7d32b1f494383 formal/smoke/clj/eacl/formal/production_kernel_test.clj
1 .D N... 100644 100644 000000 464831d504ee6332944a8cf216e97666bc996a36 464831d504ee6332944a8cf216e97666bc996a36 formal/smoke/clj/eacl/formal/routing_certificate_benchmark.clj
1 .M N... 100644 100644 100644 571d76fd94eae0140e2c93151dc62ea715e1a6e5 571d76fd94eae0140e2c93151dc62ea715e1a6e5 formal/smoke/clj/eacl/formal/semantics_bridge.clj
1 .D N... 100644 100644 000000 4dda3255256aac46ab91f36046a4ab56d7e45edd 4dda3255256aac46ab91f36046a4ab56d7e45edd formal/smoke/clj/eacl/formal/semantics_bridge_test.clj
1 .D N... 100644 100644 000000 70626ed0400379b9f27c9f6a4d191ca8947c59ed 70626ed0400379b9f27c9f6a4d191ca8947c59ed formal/smoke/clj/eacl/formal/state_trace_differential_test.clj
1 .M N... 100644 100644 100644 60527c692ac7b4197d538d1d671c4b7d70d89b16 60527c692ac7b4197d538d1d671c4b7d70d89b16 formal/smoke/clj/eacl/formal/verified_authority_suite.clj
1 .M N... 100644 100644 100644 beb299798f5e9b5213f5b0bc2df130654208267b beb299798f5e9b5213f5b0bc2df130654208267b formal/smoke/cljs/eacl/formal/cljs_test_runner.cljs
1 .D N... 100644 100644 000000 3c9fdfbd871ac4a65b75267d5821e9f973b2d56e 3c9fdfbd871ac4a65b75267d5821e9f973b2d56e formal/smoke/cljs/eacl/formal/indexed_semantics_bridge_test.cljs
1 .D N... 100644 100644 000000 0be1518b79a1993d8c59b1c69c69c38815ab5cc8 0be1518b79a1993d8c59b1c69c69c38815ab5cc8 formal/smoke/cljs/eacl/formal/indexed_traversal_benchmark.cljs
1 .M N... 100644 100644 100644 9acbeff4d5c5e1fe03e1405c9fcbcdb334abebd0 9acbeff4d5c5e1fe03e1405c9fcbcdb334abebd0 formal/smoke/cljs/eacl/formal/js_round_trip_test.cljs
1 .M N... 100644 100644 100644 3ac1830dd579434a90ef8baa5de8658996c19603 3ac1830dd579434a90ef8baa5de8658996c19603 formal/smoke/cljs/eacl/formal/production_kernel_js.cljs
1 .D N... 100644 100644 000000 0043a1876a26211d7643aa023ce6199c57b31f21 0043a1876a26211d7643aa023ce6199c57b31f21 formal/smoke/cljs/eacl/formal/production_kernel_test.cljs
1 .M N... 100644 100644 100644 0744021f5280da512ebfeb96eac0730ba1c601cf 0744021f5280da512ebfeb96eac0730ba1c601cf formal/smoke/cljs/eacl/formal/verified_authority_test_runner.cljs
1 .D N... 100755 100755 000000 f027b7c9f09220f3e3abbdd62d8944921a2e6cba f027b7c9f09220f3e3abbdd62d8944921a2e6cba formal/smoke/cljs/run-indexed-traversal-benchmark
1 .M N... 100644 100644 100644 ff58adb434a1b6d6b75395d18aa54ef96bc02074 ff58adb434a1b6d6b75395d18aa54ef96bc02074 formal/smoke/js/build_browser_bundle.mjs
1 .M N... 100644 100644 100644 b4caa878623deacabe18c0bdb68dd0df635bcd7a b4caa878623deacabe18c0bdb68dd0df635bcd7a formal/smoke/js/generated_loader.cjs
1 .M N... 100644 100644 100644 0b19673f10d737ef9f1db08a164d9d915ce565e6 0b19673f10d737ef9f1db08a164d9d915ce565e6 formal/stable-discovery/README.md
1 .M N... 100755 100755 100755 f6572cfd3f010946c0a2176f84314f80ac933f38 f6572cfd3f010946c0a2176f84314f80ac933f38 formal/stable-discovery/verify-fast.sh
1 .M N... 100644 100644 100644 be515cd1060bd277961fef7566ab905b19995dcd be515cd1060bd277961fef7566ab905b19995dcd formal/verification/adapter-certification.edn
1 .M N... 100644 100644 100644 a415d3090ef287e68452246e21f018220d16e4a5 a415d3090ef287e68452246e21f018220d16e4a5 formal/verification/assurance-matrix.edn
1 .M N... 100644 100644 100644 724aa4f288a68aa43bdfe90a4391d276e288146e 724aa4f288a68aa43bdfe90a4391d276e288146e formal/verification/final-assurance-audit.md
1 .M N... 100644 100644 100644 9854d5197abc0d3a212a0d3a90c5ffa7ba355c1e 9854d5197abc0d3a212a0d3a90c5ffa7ba355c1e formal/verification/manifest.edn
1 .M N... 100644 100644 100644 fbfd266857cb8c58818fd4b9775ac0b9caa10104 fbfd266857cb8c58818fd4b9775ac0b9caa10104 formal/verification/public-source-closure.json
1 .M N... 100644 100644 100644 352d5130b1d63c417f00b52341268a4e2be43217 352d5130b1d63c417f00b52341268a4e2be43217 formal/verification/trusted-boundary.md
1 .M N... 100644 100644 100644 8f3ff155c6e61d26f1ce6b7fab1117816e384389 8f3ff155c6e61d26f1ce6b7fab1117816e384389 modules/eacl-datahike/src/eacl/datahike/core.clj
1 .M N... 100644 100644 100644 81ba3efaddb08fcc1af68453d83901240ce60e59 81ba3efaddb08fcc1af68453d83901240ce60e59 modules/eacl-datahike/test/eacl/datahike/adapter_certification_test.clj
1 .M N... 100644 100644 100644 4a9c5c1e256d37da95fb767f629c23609d0f05f8 4a9c5c1e256d37da95fb767f629c23609d0f05f8 modules/eacl-datalevin/test/eacl/datalevin/adapter_certification_test.clj
1 .M N... 100644 100644 100644 1678c7f9388df2a3ab66d1c8e2b50a78db912c89 1678c7f9388df2a3ab66d1c8e2b50a78db912c89 modules/eacl-datascript/test/eacl/datascript/adapter_certification_test.cljc
1 .M N... 100644 100644 100644 b83cd397d4c7589dcfd165b7b79b09aadabf748f b83cd397d4c7589dcfd165b7b79b09aadabf748f modules/eacl-datascript/test/eacl/datascript/cljs_test_runner.cljs
1 .M N... 100644 100644 100644 19944f1f7d3eb7a6a766b7e7175a2bfce4d70973 19944f1f7d3eb7a6a766b7e7175a2bfce4d70973 modules/eacl-datascript/test/eacl/datascript/contract_test.cljc
1 .M N... 100644 100644 100644 977316c3919c3e3cd9efe0de9123c4feff5a5cf7 977316c3919c3e3cd9efe0de9123c4feff5a5cf7 modules/eacl-datomic/test/eacl/datomic/adapter_certification_test.clj
1 .M N... 100644 100644 100644 a45de4a20fe8c6dcb14d1835e8cb5ff129efbd8d a45de4a20fe8c6dcb14d1835e8cb5ff129efbd8d modules/eacl-datomic/test/eacl/datomic/recursive_cache_test.clj
1 .M N... 100644 100644 100644 329a26de292aea858f343b850931a87e1c04d13d 329a26de292aea858f343b850931a87e1c04d13d modules/eacl/src/eacl/backend/v8.cljc
1 .M N... 100644 100644 100644 f78fdc24f21163095cfb578ba605358525c8d69b f78fdc24f21163095cfb578ba605358525c8d69b modules/eacl/src/eacl/cache.cljc
1 .M N... 100644 100644 100644 621af316cda23c708240a2a58550ccbe89c272a0 621af316cda23c708240a2a58550ccbe89c272a0 modules/eacl/src/eacl/client/orchestration.cljc
1 .M N... 100644 100644 100644 d3d13fbdc0cffb12d1c9f09be0dfa62043f31697 d3d13fbdc0cffb12d1c9f09be0dfa62043f31697 modules/eacl/src/eacl/engine/portable_decisions.cljc
1 .D N... 100644 100644 000000 9ce853866eb8a26706395ec06da530c9444d1fe9 9ce853866eb8a26706395ec06da530c9444d1fe9 modules/eacl/src/eacl/engine/portable_indexed.cljc
1 .M N... 100644 100644 100644 94b7419ed6177fa5c52e789ea06830d0938aacce 94b7419ed6177fa5c52e789ea06830d0938aacce modules/eacl/src/eacl/formal/production_kernel.clj
1 .M N... 100644 100644 100644 26480ce67b0e4cc0b1ba5865e5b4a13c6852b371 26480ce67b0e4cc0b1ba5865e5b4a13c6852b371 modules/eacl/src/eacl/formal/production_kernel_cljs.cljs
1 .M N... 100644 100644 100644 d1e31f0a8ef5d1d35da804eea17ebe425d6fad8f d1e31f0a8ef5d1d35da804eea17ebe425d6fad8f modules/eacl/src/eacl/subproblem_cache.cljc
1 .M N... 100644 100644 100644 dd42624ba2b73929a4544f4de218fd901e2a791b dd42624ba2b73929a4544f4de218fd901e2a791b modules/eacl/src/eacl/verified_kernel.cljc
1 .M N... 100644 100644 100644 97cd2fbcd22d3d48deed44709b60267eb621cbc6 97cd2fbcd22d3d48deed44709b60267eb621cbc6 modules/eacl/test/eacl/adapter_certification.cljc
1 .M N... 100644 100644 100644 6550d7d78f57f6f60c11ab282b6048ec10fa6798 6550d7d78f57f6f60c11ab282b6048ec10fa6798 modules/eacl/test/eacl/backend/v8_test.cljc
1 .M N... 100644 100644 100644 d42637ad60ded096319b280b9f597a31877e42c0 d42637ad60ded096319b280b9f597a31877e42c0 modules/eacl/test/eacl/cache_test.cljc
1 .M N... 100644 100644 100644 ae91603fb50b27e97d3a160342058f1838ddce86 ae91603fb50b27e97d3a160342058f1838ddce86 modules/eacl/test/eacl/characterization_fixture_test.clj
1 .M N... 100644 100644 100644 c678d19d3c5a44013ce581d9b78c74a41cfc84f8 c678d19d3c5a44013ce581d9b78c74a41cfc84f8 modules/eacl/test/eacl/contract_support.cljc
1 .M N... 100644 100644 100644 d57ec8a6f3d0a4464f6ccd602697cae3a7b713eb d57ec8a6f3d0a4464f6ccd602697cae3a7b713eb modules/eacl/test/eacl/formal/counterexample_replay_test.clj
1 .M N... 100644 100644 100644 ac310182c3786f5209f3d76e14c393879ddf9d0b ac310182c3786f5209f3d76e14c393879ddf9d0b modules/eacl/test/eacl/formal/mutation_control_test.clj
1 .M N... 100644 100644 100644 cc5bd64ddfe8d8b93ce3c17eb896b181aee0edd1 cc5bd64ddfe8d8b93ce3c17eb896b181aee0edd1 modules/eacl/test/eacl/formal/portable_kernel_bundle_entry.cljs
1 .M N... 100644 100644 100644 87f62a2715507e0ea6e4a3abc52397a32372c957 87f62a2715507e0ea6e4a3abc52397a32372c957 modules/eacl/test/eacl/subproblem_cache_test.cljc
1 .M N... 100644 100644 100644 83ca07079f5b1739421b16daa2d16913f8b153b7 83ca07079f5b1739421b16daa2d16913f8b153b7 modules/eacl/test/eacl/verified_kernel_test.cljc
1 .M N... 100644 100644 100644 1e4c2e9b29d8d94387be7770d6531d2d2a3b6a3d 1e4c2e9b29d8d94387be7770d6531d2d2a3b6a3d src-build/eacl/build/module.clj
? bin/backend-certification-gate
? bin/validate-backend-certification-attestation.mjs
? bin/validate-current-assurance-attestations.mjs
? bin/validate-model-inventory
? bin/validate-stable-discovery-attestation.mjs
? bin/write-backend-certification-attestation.mjs
? bin/write-current-assurance-attestation.mjs
? bin/write-stable-discovery-attestation.mjs
? formal/smoke/shared/eacl/formal/production_decision_bridge_test.cljc
? formal/verification/current-attestation-schemas.json
? formal/verification/model-inventory.edn
? modules/eacl-datahike/test/eacl/datahike/cache_snapshot_test.clj
? modules/eacl-datascript/test/eacl/engine/stable_production_mutation_test.cljc
? openspec/changes/add-portable-cache-snapshots/.openspec.yaml
? openspec/changes/add-portable-cache-snapshots/design.md
? openspec/changes/add-portable-cache-snapshots/proposal.md
? openspec/changes/add-portable-cache-snapshots/specs/portable-authorization-cache/spec.md
? openspec/changes/add-portable-cache-snapshots/tasks.md
? openspec/changes/certify-formal-model-relevance-and-backends/.openspec.yaml
? openspec/changes/certify-formal-model-relevance-and-backends/design.md
? openspec/changes/certify-formal-model-relevance-and-backends/proposal.md
? openspec/changes/certify-formal-model-relevance-and-backends/specs/cross-backend-conformance/spec.md
? openspec/changes/certify-formal-model-relevance-and-backends/specs/formal-implementation-conformance/spec.md
? openspec/changes/certify-formal-model-relevance-and-backends/specs/formally-verified-authorization-engine/spec.md
? openspec/changes/certify-formal-model-relevance-and-backends/tasks.md
? openspec/changes/stable-engine-request-path-performance/.openspec.yaml
? openspec/changes/stable-engine-request-path-performance/README.md
? openspec/changes/stable-engine-request-path-performance/design.md
? openspec/changes/stable-engine-request-path-performance/proposal.md
? openspec/changes/stable-engine-request-path-performance/specs/request-path-efficiency/spec.md
? openspec/changes/stable-engine-request-path-performance/specs/stable-discovery-enumeration/spec.md
? openspec/changes/stable-engine-request-path-performance/tasks.md
? openspec/changes/support-permission-intersection-and-exclusion/.openspec.yaml
? openspec/changes/support-permission-intersection-and-exclusion/design.md
? openspec/changes/support-permission-intersection-and-exclusion/proposal.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/backend-unification/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/cross-backend-conformance/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/cursor-dependency-validity/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/demand-bounded-evaluation/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/dependency-validated-authorization-cache/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/formal-implementation-conformance/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/formally-verified-authorization-engine/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/permission-path-resolution/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/permission-set-algebra/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/permission-tree-expansion/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/portable-v8-authorization-engine/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/schema-aware-traversal-routing/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/schema-write-safety/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/verified-enumeration-performance/spec.md
? openspec/changes/support-permission-intersection-and-exclusion/specs/verified-subproblem-cache/spec.md
? openspec/changes/target-eacl-kernel-java-25/.openspec.yaml
? openspec/changes/target-eacl-kernel-java-25/design.md
? openspec/changes/target-eacl-kernel-java-25/proposal.md
? openspec/changes/target-eacl-kernel-java-25/specs/clojars-release-pipeline/spec.md
? openspec/changes/target-eacl-kernel-java-25/tasks.md
```

## datahike-demo

- Kind: `existing-demo`
- Directory: `/Users/petrus/code/eacl/eacl-datahike-demo`
- HEAD: `06d8141a0cfebbd3b423cd719f9f05eb94ca50aa`
- Branch: `agent/port-to-datahike-demo`
- Upstream: `origin/agent/port-to-datahike-demo`
- Status manifest SHA-256: `a8c0f25778d7a85362e3c988d5986279424eb0c7cd30fc5d8cb824d7b245096b`
- Build status: `passed` — SolidJS client production build and Clojure tools.build uberjar completed successfully.

Remotes:

- fetch `origin`: `https://github.com/theronic/eacl-datomic-solidjs.git`
- push `origin`: `https://github.com/theronic/eacl-datomic-solidjs.git`

Dependency manifests and locks:

- `client/package-lock.json` — `8f2e4e9ea0ad2674eba207404f6c495fdabc2a43eac583400eb9afa883e4afc5` (178135 bytes)
- `client/package.json` — `66f9f67ffe951a333606105a01d9f92080b2ecbae91759b3bdf479935da2d7da` (934 bytes)
- `package.json` — `9647ac82266e9ce671a13893f7b88c57bcc43ff0582ff4bbe7012f2411d8310c` (1712 bytes)
- `server/deps.edn` — `7fb0a41869b6f827d72755780c3d348e7fce00cb4945c191b3d9992b7c4da60c` (2767 bytes)

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid 06d8141a0cfebbd3b423cd719f9f05eb94ca50aa
# branch.head agent/port-to-datahike-demo
# branch.upstream origin/agent/port-to-datahike-demo
# branch.ab +0 -0
1 .M N... 100644 100644 100644 0bf196dacaef394699327a463d97ecce999a0c88 0bf196dacaef394699327a463d97ecce999a0c88 .gitignore
1 .M N... 100644 100644 100644 c4fe4c4e524b66181e1d2dd0c9f4f297601a3801 c4fe4c4e524b66181e1d2dd0c9f4f297601a3801 README.md
1 .M N... 100644 100644 100644 7bf776eace7ba46693ddb964906a5e5a6fcb519f 7bf776eace7ba46693ddb964906a5e5a6fcb519f client/e2e/explorer.spec.ts
1 .M N... 100644 100644 100644 c2fdd8bde63829bf92ba4545c24a569bc70ac359 c2fdd8bde63829bf92ba4545c24a569bc70ac359 client/src/App.tsx
1 .M N... 100644 100644 100644 7ccd9654a64bcb581d9d576e19396f96b7fd7bd2 7ccd9654a64bcb581d9d576e19396f96b7fd7bd2 client/src/api.ts
1 .M N... 100644 100644 100644 fead9628400f665b72c2c228d2728641f380056b fead9628400f665b72c2c228d2728641f380056b client/src/components/CachePanel.tsx
1 .M N... 100644 100644 100644 058975e21181d469a33ab91314e50c541c26767c 058975e21181d469a33ab91314e50c541c26767c client/src/components/DetailPanel.tsx
1 .M N... 100644 100644 100644 569df2c15136dc56d4f42e8d4abca79c803cce94 569df2c15136dc56d4f42e8d4abca79c803cce94 client/src/components/Header.tsx
1 .M N... 100644 100644 100644 0e8f29f96c0986ae7a447869673839130260ea51 0e8f29f96c0986ae7a447869673839130260ea51 client/src/components/ResourceTree.tsx
1 .M N... 100644 100644 100644 245e04482068f184c37c3421da9e288ede8a25db 245e04482068f184c37c3421da9e288ede8a25db client/src/components/SchemaPanel.tsx
1 .M N... 100644 100644 100644 21cc4e58acadeb89899706f4ef99fdd7172e968e 21cc4e58acadeb89899706f4ef99fdd7172e968e client/src/components/SubjectsPanel.tsx
1 .M N... 100644 100644 100644 1392e21fd644af9acb9214991745873b8e8830d9 1392e21fd644af9acb9214991745873b8e8830d9 client/src/preferences.ts
1 .M N... 100644 100644 100644 c178467a1aa10ceef96eabc98bf64d99c4dd6fca c178467a1aa10ceef96eabc98bf64d99c4dd6fca client/src/state.tsx
1 .M N... 100644 100644 100644 336ee584635bca9599f9d6e6120c6bf1a6ce6f4b 336ee584635bca9599f9d6e6120c6bf1a6ce6f4b client/src/styles.css
1 .M N... 100644 100644 100644 e2fab9b9943452e2efe62a41cc477f2f38a0ceba e2fab9b9943452e2efe62a41cc477f2f38a0ceba client/src/types.ts
1 .M N... 100644 100644 100644 11f02fe2a0061d6e6e1f271b21da95423b448b32 11f02fe2a0061d6e6e1f271b21da95423b448b32 client/src/vite-env.d.ts
1 .M N... 100644 100644 100644 7bedde9fd998888026d0fbdda618f5d5492477ef 7bedde9fd998888026d0fbdda618f5d5492477ef client/tests/api.test.ts
1 .M N... 100644 100644 100644 b17630f104e1a80c67174a9294ddfe2625487053 b17630f104e1a80c67174a9294ddfe2625487053 client/tests/cache-panel.test.tsx
1 .M N... 100644 100644 100644 71c33a0303e4c1dee9a00267773da80f8f6184bc 71c33a0303e4c1dee9a00267773da80f8f6184bc client/tests/fixtures.ts
1 .M N... 100644 100644 100644 43fbbce85e75cff492b872db2d37eaa20b7a4ee9 43fbbce85e75cff492b872db2d37eaa20b7a4ee9 client/tests/header.test.tsx
1 .M N... 100644 100644 100644 619a3e8a8b915254e8ef3cc65b09b6e043236c14 619a3e8a8b915254e8ef3cc65b09b6e043236c14 client/tests/preferences.test.ts
1 .M N... 100644 100644 100644 c4fc1dccd31be39e50314e95da474a22501adc3e c4fc1dccd31be39e50314e95da474a22501adc3e client/tests/resource-tree.test.tsx
1 .M N... 100644 100644 100644 eee8f66fd2323978204a00975c37519ad93490e5 eee8f66fd2323978204a00975c37519ad93490e5 client/tests/schema-panel.test.tsx
1 .M N... 100644 100644 100644 c998dcd35a6d012b5b250c13718de476fe8e2e85 c998dcd35a6d012b5b250c13718de476fe8e2e85 client/tests/setup.ts
1 .M N... 100644 100644 100644 d2985659b0a7fbb028686055e93b8ba9afe45b4f d2985659b0a7fbb028686055e93b8ba9afe45b4f client/tests/subjects-panel.test.tsx
1 .M N... 100644 100644 100644 45d7e4b0bf400addded4536b1235149e34a710b6 45d7e4b0bf400addded4536b1235149e34a710b6 docs/cost-controls.md
1 .M N... 100644 100644 100644 89576a7c294c9b00b9fe3df1c8000391673306cd 89576a7c294c9b00b9fe3df1c8000391673306cd docs/dependencies.md
1 .M N... 100644 100644 100644 7c63d3330fdf357925a27d93712a3266a3b18bc1 7c63d3330fdf357925a27d93712a3266a3b18bc1 docs/dependency-tree.txt
1 .M N... 100644 100644 100644 fddf71769e1c844455547752bb5f1c3cae3a410f fddf71769e1c844455547752bb5f1c3cae3a410f docs/deployment.md
1 .M N... 100644 100644 100644 8d5bb5887a2b2491e2dc2cdd366d1c5ebe8296e6 8d5bb5887a2b2491e2dc2cdd366d1c5ebe8296e6 docs/local-minio-runbook.md
1 .M N... 100644 100644 100644 8e2d8a108d52d0f63a9ced8f201fbddb279d6f6c 8e2d8a108d52d0f63a9ced8f201fbddb279d6f6c docs/storage-maintenance.md
1 .M N... 100644 100644 100644 60280e6d4b05cc06589eb6ff2ce2142a09536c35 60280e6d4b05cc06589eb6ff2ce2142a09536c35 docs/verification.md
1 .M N... 100755 100755 100755 7f1ad0bc92f0bf93473943ba6f191096011e179f 7f1ad0bc92f0bf93473943ba6f191096011e179f infra/scripts/configure-production-env.sh
1 .M N... 100755 100755 100755 4cba148bb449ecf3988b903238e18255da83e8d8 4cba148bb449ecf3988b903238e18255da83e8d8 infra/scripts/deploy-artifact.sh
1 .M N... 100755 100755 100755 d7329f3303d51d53640e10333749c33b6931ab07 d7329f3303d51d53640e10333749c33b6931ab07 infra/scripts/verify-small-fixture.sh
1 .M N... 100644 100644 100644 b3049ac74b0133f70e3bb536bb40d9aca8b8e302 b3049ac74b0133f70e3bb536bb40d9aca8b8e302 infra/systemd/eacl-datahike-demo.env.example
1 .M N... 100644 100644 100644 060bc9dfdf52b5f9a2729b74a16454c0ee736868 060bc9dfdf52b5f9a2729b74a16454c0ee736868 package.json
1 .M N... 100644 100644 100644 74fe6578d636eb0b9b858ff25b9274a136cecedc 74fe6578d636eb0b9b858ff25b9274a136cecedc server/build.clj
1 .M N... 100644 100644 100644 9585d006316fbbddaff3ad093b9c2ba43155055f 9585d006316fbbddaff3ad093b9c2ba43155055f server/deps.edn
1 .M N... 100644 100644 100644 3859d02cf3d49ee14c0b71a857a7c8614ea6963c 3859d02cf3d49ee14c0b71a857a7c8614ea6963c server/dev/dev.clj
1 .M N... 100644 100644 100644 73829aed5415348534a81273d9a4c293eec1b8af 73829aed5415348534a81273d9a4c293eec1b8af server/src/eacl_datahike_demo/api.clj
1 .M N... 100644 100644 100644 2893c9073c127428e5a6cb62cff814e06d1ab219 2893c9073c127428e5a6cb62cff814e06d1ab219 server/src/eacl_datahike_demo/config.clj
1 .M N... 100644 100644 100644 622994e329436065b3dd075d08c74775fae6d83c 622994e329436065b3dd075d08c74775fae6d83c server/src/eacl_datahike_demo/contracts.clj
1 .M N... 100644 100644 100644 c902d1552575bb67f3ccc511794c6e310de996a0 c902d1552575bb67f3ccc511794c6e310de996a0 server/src/eacl_datahike_demo/eacl_adapter.clj
1 .M N... 100644 100644 100644 8d1bc85d8000d63617cf28e1cd7b0d1e2a4791c1 8d1bc85d8000d63617cf28e1cd7b0d1e2a4791c1 server/src/eacl_datahike_demo/runtime.clj
1 .M N... 100644 100644 100644 2c86129b8fe1ce0b114a3a96ab00430547df1558 2c86129b8fe1ce0b114a3a96ab00430547df1558 server/src/eacl_datahike_demo/system.clj
1 .M N... 100644 100644 100644 39b8c53791e288fd1392a4ee710ed766a6f29340 39b8c53791e288fd1392a4ee710ed766a6f29340 server/test/eacl_datahike_demo/api_test.clj
1 .M N... 100644 100644 100644 9cd9602cef27f99b57e64e6574e8d7b8d993b059 9cd9602cef27f99b57e64e6574e8d7b8d993b059 server/test/eacl_datahike_demo/config_test.clj
1 .M N... 100644 100644 100644 d2cb891f914843e37b7feb1c6ef786278c9c4839 d2cb891f914843e37b7feb1c6ef786278c9c4839 server/test/eacl_datahike_demo/contracts_test.clj
1 .M N... 100644 100644 100644 3cf9e6dba658b0aa17beb91026b43cac5e3545d7 3cf9e6dba658b0aa17beb91026b43cac5e3545d7 server/test/eacl_datahike_demo/http_test.clj
1 .M N... 100644 100644 100644 4f078304ed7d5d18b8654053328cf8c0d699b734 4f078304ed7d5d18b8654053328cf8c0d699b734 server/test/eacl_datahike_demo/integration_test.clj
1 .M N... 100644 100644 100644 04fe303841615a0f9e72c55a4bc7315378252ddf 04fe303841615a0f9e72c55a4bc7315378252ddf server/test/eacl_datahike_demo/storage_test.clj
1 .M N... 100644 100644 100644 b10fa15d9d965853ce8e629bfd3b1fc7687077ac b10fa15d9d965853ce8e629bfd3b1fc7687077ac server/test/eacl_datahike_demo/test_support.clj
? client/src/components/ConsistencyPanel.tsx
? client/tests/app-startup.test.tsx
? client/tests/consistency-panel.test.tsx
? docs/benchmarks/2026-08-24-function-url-cache-diagnostics/README.md
? docs/benchmarks/2026-08-24-s3-static-direct-function-url/README.md
? docs/benchmarks/lambda-20260821T161042Z/README.md
? docs/benchmarks/lambda-20260821T161042Z/memory-summaries.ndjson
? docs/benchmarks/lambda-20260821T161042Z/samples.ndjson
? docs/benchmarks/lambda-20260821T161042Z/summary.json
? docs/benchmarks/lambda-20260824T133806Z/README.md
? docs/benchmarks/lambda-20260824T133806Z/memory-summaries.ndjson
? docs/benchmarks/lambda-20260824T133806Z/samples.ndjson
? docs/benchmarks/lambda-java25-retained-snapshot-20260824/README.md
? docs/benchmarks/lambda-snapstart-20260821T182601Z/README.md
? docs/benchmarks/lambda-snapstart-20260821T182601Z/samples.ndjson
? docs/benchmarks/lambda-snapstart-20260821T182601Z/summary.json
? docs/benchmarks/s3-amplification-20260822/README.md
? docs/benchmarks/s3-amplification-20260822/summary.json
? docs/datahike-0.8.1801-upgrade.md
? docs/serverless-datahike-reader.md
? infra/cache-extension/go.mod
? infra/cache-extension/go.sum
? infra/cache-extension/main.go
? infra/cache-extension/main_test.go
? infra/lambda-cloudformation.yaml
? infra/lambda-deployment.env.example
? infra/scripts/activate-lambda-version.sh
? infra/scripts/benchmark-lambda-reader.sh
? infra/scripts/build-cache-extension.sh
? infra/scripts/build-eacl-java21.sh
? infra/scripts/build-eacl-java25.sh
? infra/scripts/deploy-lambda-reader.sh
? infra/scripts/deploy-serverless-domain.sh
? infra/scripts/lambda-common.sh
? infra/scripts/lambda-cost-status.sh
? infra/scripts/measure-s3-amplification.sh
? infra/scripts/rollback-lambda-version.sh
? infra/scripts/serverless-domain-common.sh
? infra/scripts/verify-lambda-artifact.sh
? infra/scripts/verify-lambda-candidate.sh
? infra/scripts/verify-public-demo.sh
? infra/scripts/verify-release-artifact.sh
? infra/scripts/verify-serverless-domain.sh
? infra/serverless-domain-cloudformation.yaml
? infra/serverless-domain.env.example
? infra/tests/lambda-guards.sh
? infra/tests/release-guards.sh
? infra/tests/serverless-domain-guards.sh
? openspec/changes/deploy-serverless-datahike-reader/.openspec.yaml
? openspec/changes/deploy-serverless-datahike-reader/design.md
? openspec/changes/deploy-serverless-datahike-reader/proposal.md
? openspec/changes/deploy-serverless-datahike-reader/specs/serverless-datahike-reader/spec.md
? openspec/changes/deploy-serverless-datahike-reader/tasks.md
? openspec/changes/expose-serverless-datahike-domain/.openspec.yaml
? openspec/changes/expose-serverless-datahike-domain/design.md
? openspec/changes/expose-serverless-datahike-domain/proposal.md
? openspec/changes/expose-serverless-datahike-domain/specs/serverless-datahike-domain/spec.md
? openspec/changes/expose-serverless-datahike-domain/tasks.md
? openspec/changes/persist-eacl-lambda-cache/.openspec.yaml
? openspec/changes/persist-eacl-lambda-cache/design.md
? openspec/changes/persist-eacl-lambda-cache/proposal.md
? openspec/changes/persist-eacl-lambda-cache/specs/durable-eacl-cache/spec.md
? openspec/changes/persist-eacl-lambda-cache/specs/lambda-reader-right-sizing/spec.md
? openspec/changes/persist-eacl-lambda-cache/tasks.md
? openspec/changes/pin-serverless-datahike-session-bases/.openspec.yaml
? openspec/changes/pin-serverless-datahike-session-bases/design.md
? openspec/changes/pin-serverless-datahike-session-bases/proposal.md
? openspec/changes/pin-serverless-datahike-session-bases/specs/eacl-immutable-snapshots/spec.md
? openspec/changes/pin-serverless-datahike-session-bases/specs/serverless-datahike-head-notification/spec.md
? openspec/changes/pin-serverless-datahike-session-bases/specs/serverless-datahike-io-observability/spec.md
? openspec/changes/pin-serverless-datahike-session-bases/specs/serverless-datahike-session-basis/spec.md
? openspec/changes/pin-serverless-datahike-session-bases/tasks.md
? server/dev/eacl_datahike_demo/s3_amplification.clj
? server/src/eacl_datahike_demo/cache_persistence.clj
? server/src/eacl_datahike_demo/lambda_adapter.clj
? server/src/eacl_datahike_demo/lambda_handler.clj
? server/src/eacl_datahike_demo/read_only_writer.clj
? server/src/eacl_datahike_demo/reader.clj
? server/src/eacl_datahike_demo/snapshots.clj
? server/test/eacl_datahike_demo/cache_persistence_test.clj
? server/test/eacl_datahike_demo/lambda_adapter_test.clj
? server/test/eacl_datahike_demo/lambda_handler_test.clj
? server/test/eacl_datahike_demo/read_only_writer_test.clj
? server/test/eacl_datahike_demo/reader_test.clj
```

## datomic-demo

- Kind: `existing-demo`
- Directory: `/Users/petrus/code/eacl/eacl-datomic-solidjs`
- HEAD: `8774ef39bc3e7d63d6a1be0bb9630b786a3d0a2a`
- Branch: `agent/upgrade-eacl-v8-demo`
- Upstream: `origin/agent/upgrade-eacl-v8-demo`
- Status manifest SHA-256: `fbf7817c65f8608c81a6a868dcde02b7ba3ce6e8cff3fdb6bce13ebcc04e5494`
- Build status: `passed` — SolidJS client built; 21 server tests and 128 assertions passed with 0 failures and 0 errors.

Remotes:

- fetch `origin`: `git@github.com:theronic/eacl-datomic-solidjs.git`
- push `origin`: `git@github.com:theronic/eacl-datomic-solidjs.git`

Dependency manifests and locks:

- `client/package-lock.json` — `e3b062bb65730018705d6c0382c66ed53950af359ea281417981cb5c6072d2a3` (178123 bytes)
- `client/package.json` — `07c3b42e6df001b22da0f32df2461aabb3ace773aa6326d1134a82be1eee9c26` (928 bytes)
- `package.json` — `5e8e3f7aa263973b43109d240b27f8950f5ddb37f3fda84c206325082996c6f0` (1233 bytes)
- `pnpm-lock.yaml` — `17c814b167307942d3609c7b9d916ceddb85839573ab39baa114e30edb132a1a` (114 bytes)
- `server/deps.edn` — `530b40dcad1c1f3b090edd29b173eb67f15136065e1354f43c58d2c56710788c` (1219 bytes)

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid 8774ef39bc3e7d63d6a1be0bb9630b786a3d0a2a
# branch.head agent/upgrade-eacl-v8-demo
# branch.upstream origin/agent/upgrade-eacl-v8-demo
# branch.ab +0 -0
? .claude/launch.json
? pnpm-lock.yaml
```

## datalevin-demo

- Kind: `existing-demo`
- Directory: `/Users/petrus/code/eacl/eacl-datalevin-solidjs`
- HEAD: `06d8141a0cfebbd3b423cd719f9f05eb94ca50aa`
- Branch: `agent/certify-datalevin-ordered-generation-proofs`
- Upstream: none
- Status manifest SHA-256: `bc8bb07932a65d1551b3af1d9fb903fcdd75a4b0b4b1e3b4c2642194235ca7ee`
- Build status: `failed` — SolidJS client built, but Clojure tools.build uberjar compilation failed.

Remotes:

- fetch `origin`: `/Users/petrus/code/eacl/eacl-datahike-demo`
- push `origin`: `/Users/petrus/code/eacl/eacl-datahike-demo`

Dependency manifests and locks:

- `client/package-lock.json` — `b90e9189b6be557f808f5999c0c2bdcf35bb4fbba732d02ac52b9b28be18f402` (178143 bytes)
- `client/package.json` — `9f6c23feae957c99139a0b9289dcb47b574c5881c9e5f903b63c0113aac1b768` (938 bytes)
- `package.json` — `88a0d4307b0d669909c2f13690e118da474a8b9951a6cd8069d3e75224ec3bfc` (838 bytes)
- `server/deps.edn` — `6fc10109fdc1149d1d8df98de54d8ecd3ccf80e9a997488f647d697b188a55e5` (1856 bytes)

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid 06d8141a0cfebbd3b423cd719f9f05eb94ca50aa
# branch.head agent/certify-datalevin-ordered-generation-proofs
1 .M N... 100644 100644 100644 c4fe4c4e524b66181e1d2dd0c9f4f297601a3801 c4fe4c4e524b66181e1d2dd0c9f4f297601a3801 README.md
1 .M N... 100644 100644 100644 7bf776eace7ba46693ddb964906a5e5a6fcb519f 7bf776eace7ba46693ddb964906a5e5a6fcb519f client/e2e/explorer.spec.ts
1 .M N... 100644 100644 100644 f7c664513dcc81c397a2a2582f1ed4ae4f3b83fb f7c664513dcc81c397a2a2582f1ed4ae4f3b83fb client/index.html
1 .M N... 100644 100644 100644 4221a9a8ecab23106bfa918ef8288cc823283903 4221a9a8ecab23106bfa918ef8288cc823283903 client/package-lock.json
1 .M N... 100644 100644 100644 c488cb9c23460310e7914efa129f00b10b0b95cc c488cb9c23460310e7914efa129f00b10b0b95cc client/package.json
1 .M N... 100644 100644 100644 c2fdd8bde63829bf92ba4545c24a569bc70ac359 c2fdd8bde63829bf92ba4545c24a569bc70ac359 client/src/App.tsx
1 .M N... 100644 100644 100644 569df2c15136dc56d4f42e8d4abca79c803cce94 569df2c15136dc56d4f42e8d4abca79c803cce94 client/src/components/Header.tsx
1 .M N... 100644 100644 100644 1392e21fd644af9acb9214991745873b8e8830d9 1392e21fd644af9acb9214991745873b8e8830d9 client/src/preferences.ts
1 .M N... 100644 100644 100644 c178467a1aa10ceef96eabc98bf64d99c4dd6fca c178467a1aa10ceef96eabc98bf64d99c4dd6fca client/src/state.tsx
1 .M N... 100644 100644 100644 e2fab9b9943452e2efe62a41cc477f2f38a0ceba e2fab9b9943452e2efe62a41cc477f2f38a0ceba client/src/types.ts
1 .M N... 100644 100644 100644 738fa15eb7f7db2e241d9ceca78d8ef970e97d49 738fa15eb7f7db2e241d9ceca78d8ef970e97d49 client/vite.config.ts
1 .M N... 100644 100644 100644 060bc9dfdf52b5f9a2729b74a16454c0ee736868 060bc9dfdf52b5f9a2729b74a16454c0ee736868 package.json
1 .M N... 100644 100644 100644 9585d006316fbbddaff3ad093b9c2ba43155055f 9585d006316fbbddaff3ad093b9c2ba43155055f server/deps.edn
1 .M N... 100644 100644 100644 73829aed5415348534a81273d9a4c293eec1b8af 73829aed5415348534a81273d9a4c293eec1b8af server/src/eacl_datahike_demo/api.clj
1 .M N... 100644 100644 100644 2893c9073c127428e5a6cb62cff814e06d1ab219 2893c9073c127428e5a6cb62cff814e06d1ab219 server/src/eacl_datahike_demo/config.clj
1 .M N... 100644 100644 100644 622994e329436065b3dd075d08c74775fae6d83c 622994e329436065b3dd075d08c74775fae6d83c server/src/eacl_datahike_demo/contracts.clj
1 .M N... 100644 100644 100644 27b26cd1c0e7f359a034c8c4ea84782941e8885f 27b26cd1c0e7f359a034c8c4ea84782941e8885f server/src/eacl_datahike_demo/data.clj
1 .M N... 100644 100644 100644 e25c2428b01a29c2213fb3e0ef8a927ede4d88bb e25c2428b01a29c2213fb3e0ef8a927ede4d88bb server/src/eacl_datahike_demo/main.clj
1 .M N... 100644 100644 100644 8d1bc85d8000d63617cf28e1cd7b0d1e2a4791c1 8d1bc85d8000d63617cf28e1cd7b0d1e2a4791c1 server/src/eacl_datahike_demo/runtime.clj
1 .M N... 100644 100644 100644 2c86129b8fe1ce0b114a3a96ab00430547df1558 2c86129b8fe1ce0b114a3a96ab00430547df1558 server/src/eacl_datahike_demo/system.clj
1 .M N... 100644 100644 100644 39b8c53791e288fd1392a4ee710ed766a6f29340 39b8c53791e288fd1392a4ee710ed766a6f29340 server/test/eacl_datahike_demo/api_test.clj
1 .M N... 100644 100644 100644 4f078304ed7d5d18b8654053328cf8c0d699b734 4f078304ed7d5d18b8654053328cf8c0d699b734 server/test/eacl_datahike_demo/integration_test.clj
1 .M N... 100644 100644 100644 b10fa15d9d965853ce8e629bfd3b1fc7687077ac b10fa15d9d965853ce8e629bfd3b1fc7687077ac server/test/eacl_datahike_demo/test_support.clj
? server/dev/authorization_http_benchmark.clj
```

## jank-demo

- Kind: `existing-demo`
- Directory: `/Users/petrus/code/eacl/eacl-jank`
- HEAD: unborn
- Branch: `main`
- Upstream: none
- Status manifest SHA-256: `e215cf057b2bd82e496885a91b73dd0aad47831c41b52acd81bff324ee0397c2`
- Build status: `passed-host-only` — Pinned toolchain, source audit, OpenSSL, performance budgets, debug and optimized tests, debug/optimized execution, static AOT execution, reserved-namespace rejection, and client build passed.

Remotes:

- fetch `origin`: `https://github.com/theronic/eacl-jank.git`
- push `origin`: `https://github.com/theronic/eacl-jank.git`

Dependency manifests and locks:

- `client/package-lock.json` — `2e868395b19f7dd852269806dc0c968c6e6b2cf3851f3ce5549e525c2b1770c1` (210830 bytes)
- `client/package.json` — `554910109b4ed68d0a21489d4ce1a6a5dd01372e0cc4c8617bddf7176f380cac` (917 bytes)
- `compat/reference/deps.edn` — `81165bc67a987156b9258bcb3039f36550febaa23ea09c7a42a1cf9ff15a27fb` (165 bytes)
- `compat/toolchain-smoke/project.clj` — `145a9090e1df62250df5ec505634831b97960410af3129d767304ce1efde3cc8` (604 bytes)
- `jank-build.bb` — `ae21cca6d896709655a8bb3bff77e919defdab281fb64182d8f7b41c938dfe96` (679 bytes)
- `package.json` — `076577ee98b4196517400c5a4e0d5c7c367c23013ed943629394361e27752e26` (311 bytes)
- `project.clj` — `c47f770fdbb8aff086107d922c2aa61e4deea879952efffd645bb007421edd0e` (1122 bytes)

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid (initial)
# branch.head main
? .codex/skills/openspec-apply-change/SKILL.md
? .codex/skills/openspec-archive-change/SKILL.md
? .codex/skills/openspec-explore/SKILL.md
? .codex/skills/openspec-propose/SKILL.md
? .codex/skills/openspec-sync-specs/SKILL.md
? .codex/skills/openspec-update-change/SKILL.md
? .github/workflows/certification.yml
? .gitignore
? LICENCE
? NOTICE
? README.md
? bench/README.md
? bench/eacl/.gitkeep
? bench/eacl/clojure_reference_scalar_2026_08_23.edn
? bench/eacl/datomic/memory/.gitkeep
? bench/eacl/jank_engine_budgets_v2.edn
? bench/eacl/jank_engine_budgets_v3.edn
? bench/eacl/jank_engine_budgets_v4.edn
? bench/eacl/jank_engine_budgets_v5.edn
? bench/eacl/jank_engine_budgets_v6.edn
? bench/eacl/jank_engine_budgets_v7.edn
? bench/eacl/jank_explorer_aot_v7.edn
? bench/eacl/jank_release_budgets_v1.edn
? bench/eacl/jank_seek_budgets_v1.edn
? bench/eacl/jank_seek_budgets_v2.edn
? bin/audit-source
? bin/benchmark-engine
? bin/benchmark-seeks
? bin/certify
? bin/check-build
? bin/demo
? bin/demo-aot
? bin/generate-core-formal-pin.mjs
? bin/generate-jank-assurance-matrix.mjs
? bin/probe-cljc
? bin/probe-reserved-jank-namespace
? bin/reference-clojure
? bin/run-jank-certification.mjs
? bin/run-jank-production-mutants.mjs
? bin/run-jank-support-gates.mjs
? bin/run-pinned-core-formal.mjs
? bin/validate-jank-certification-attestation.mjs
? bin/validate-pinned-core-attestation.mjs
? bin/verify-core-formal-pin.mjs
? bin/verify-crypto-provider
? bin/verify-lan-demo.mjs
? bin/verify-performance-budget
? bin/verify-pinned-core-formal
? bin/verify-schema-reference
? bin/verify-toolchain
? bin/write-jank-certification-attestation.mjs
? bin/write-pinned-core-attestation.mjs
? client/eslint.config.js
? client/index.html
? client/package-lock.json
? client/package.json
? client/scripts/compress-assets.mjs
? client/src/App.tsx
? client/src/api.ts
? client/src/components/CachePanel.tsx
? client/src/components/Common.tsx
? client/src/components/DetailPanel.tsx
? client/src/components/Header.tsx
? client/src/components/ResourceTree.tsx
? client/src/components/SchemaGraph.tsx
? client/src/components/SchemaPanel.tsx
? client/src/components/SubjectsPanel.tsx
? client/src/format.ts
? client/src/index.tsx
? client/src/preferences.ts
? client/src/state.tsx
? client/src/styles.css
? client/src/types.ts
? client/src/vite-env.d.ts
? client/tests/format.test.ts
? client/tests/preferences.test.ts
? client/tests/setup.ts
? client/tsconfig.app.json
? client/tsconfig.app.tsbuildinfo
? client/tsconfig.json
? client/tsconfig.node.json
? client/tsconfig.node.tsbuildinfo
? client/vite.config.ts
? client/vitest.config.ts
? compat/expected/README.md
? compat/expected/causal-token-v1.edn
? compat/expected/causal-token-v2.edn
? compat/expected/jank-public-fixture-v1.edn
? compat/expected/layered-reference-oracles-v1.edn
? compat/expected/portable-decision-feasibility.edn
? compat/expected/schema-parser-pr145-v1.edn
? compat/expected/secure-format-v1.edn
? compat/fixtures/README.md
? compat/manifests/crypto-provider.edn
? compat/manifests/datom-ordering-abi-v1.edn
? compat/manifests/eacl-pr145-api.edn
? compat/manifests/final-readiness.edn
? compat/manifests/frozen-datomic-read-inventory.edn
? compat/manifests/hard-feasibility-gate.edn
? compat/manifests/jank-feasibility.edn
? compat/manifests/jank-port-compatibility.edn
? compat/manifests/port.edn
? compat/manifests/release-qualification.edn
? compat/manifests/schema-storage-v1.edn
? compat/manifests/source-audit.edn
? compat/manifests/toolchain.edn
? compat/negative/reserved-jank-namespace/README.md
? compat/negative/reserved-jank-namespace/src/eacl/runtime/jank/reserved.jank
? compat/reference/deps.edn
? compat/reference/src/eacl_jank/budget_check.clj
? compat/reference/src/eacl_jank/reference.clj
? compat/reference/src/eacl_jank/schema_fixture.clj
? compat/toolchain-smoke/project.clj
? compat/toolchain-smoke/src/eacl_jank/toolchain_smoke.jank
? demo/proxy.mjs
? dev/eacl_jank/build_main.jank
? dev/eacl_jank/certification_client.jank
? dev/eacl_jank/demo/stdio.jank
? dev/eacl_jank/demo_server.jank
? dev/eacl_jank/engine_benchmark.jank
? dev/eacl_jank/seek_benchmark.jank
? docs/api-compatibility.md
? docs/build.md
? docs/crypto-provider.md
? docs/datomic-memory.md
? docs/demo.md
? docs/final-assurance-audit.md
? docs/known-deficiencies.md
? docs/performance-qualification.md
? docs/readiness.md
? docs/security.md
? docs/toolchain.md
? docs/upstream-sync.md
? docs/verification.md
? formal/assurance-matrix.json
? formal/core-model-pin.json
? jank-build.bb
? modules/eacl-datomic-memory/README.md
? modules/eacl-datomic-memory/src/eacl/datomic/memory.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/.gitkeep
? modules/eacl-datomic-memory/src/eacl/datomic/memory/api.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/consistency.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/datom.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/db.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/feasibility_seek.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/index.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/order.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/relationships.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/schema.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/store.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/token.cljc
? modules/eacl-datomic-memory/src/eacl/datomic/memory/transaction.cljc
? modules/eacl-runtime-jank/README.md
? modules/eacl-runtime-jank/src/eacl/runtime/native/build_smoke.jank
? modules/eacl-runtime-jank/src/eacl/runtime/native/clock.jank
? modules/eacl-runtime-jank/src/eacl/runtime/native/crypto.jank
? modules/eacl-runtime-jank/src/eacl/runtime/native/encoding.jank
? modules/eacl-runtime-jank/src/eacl/runtime/native/feasibility.jank
? modules/eacl-runtime-jank/src/eacl/runtime/native/identity.jank
? modules/eacl/README.md
? modules/eacl/src/eacl/.gitkeep
? modules/eacl/src/eacl/authorization/batch.cljc
? modules/eacl/src/eacl/authorization/filters.cljc
? modules/eacl/src/eacl/cache/local.cljc
? modules/eacl/src/eacl/cancellation.cljc
? modules/eacl/src/eacl/client/orchestration.cljc
? modules/eacl/src/eacl/core.cljc
? modules/eacl/src/eacl/cursor.cljc
? modules/eacl/src/eacl/domain.cljc
? modules/eacl/src/eacl/engine/denotation.cljc
? modules/eacl/src/eacl/engine/discovery.cljc
? modules/eacl/src/eacl/engine/permission_tree.cljc
? modules/eacl/src/eacl/engine/portable_decisions.cljc
? modules/eacl/src/eacl/engine/portable_indexed.cljc
? modules/eacl/src/eacl/engine/sealed_plan.cljc
? modules/eacl/src/eacl/engine/v8.cljc
? modules/eacl/src/eacl/execution.cljc
? modules/eacl/src/eacl/feasibility/portable.cljc
? modules/eacl/src/eacl/feasibility/portable_decision_slice.cljc
? modules/eacl/src/eacl/relationships/endpoint_pair.cljc
? modules/eacl/src/eacl/relationships/filters.cljc
? modules/eacl/src/eacl/relationships/mutations.cljc
? modules/eacl/src/eacl/relationships/storage.cljc
? modules/eacl/src/eacl/request/context.cljc
? modules/eacl/src/eacl/request/counters.cljc
? modules/eacl/src/eacl/schema/model.cljc
? modules/eacl/src/eacl/secure_format.cljc
? modules/eacl/src/eacl/secure_keyring.cljc
? modules/eacl/src/eacl/spicedb/parser.cljc
? modules/eacl/src/eacl/spicedb/tokenizer.cljc
? modules/eacl/src/eacl/store.cljc
? openspec/changes/expose-lan-demo-and-certify-formal-conformance/.openspec.yaml
? openspec/changes/expose-lan-demo-and-certify-formal-conformance/design.md
? openspec/changes/expose-lan-demo-and-certify-formal-conformance/proposal.md
? openspec/changes/expose-lan-demo-and-certify-formal-conformance/specs/jank-formal-conformance/spec.md
? openspec/changes/expose-lan-demo-and-certify-formal-conformance/specs/lan-explorer-access/spec.md
? openspec/changes/expose-lan-demo-and-certify-formal-conformance/tasks.md
? openspec/changes/port-eacl-engine-to-jank/.openspec.yaml
? openspec/changes/port-eacl-engine-to-jank/design.md
? openspec/changes/port-eacl-engine-to-jank/proposal.md
? openspec/changes/port-eacl-engine-to-jank/specs/authorization-engine/spec.md
? openspec/changes/port-eacl-engine-to-jank/specs/datomic-snapshot-store/spec.md
? openspec/changes/port-eacl-engine-to-jank/specs/eacl-public-api/spec.md
? openspec/changes/port-eacl-engine-to-jank/specs/stable-authorized-discovery/spec.md
? openspec/changes/port-eacl-engine-to-jank/tasks.md
? openspec/config.yaml
? package.json
? project.clj
? test/README.md
? test/eacl/.gitkeep
? test/eacl/authorization/batch_test.jank
? test/eacl/authorization/discovery_oracle_test.jank
? test/eacl/authorization/discovery_test.jank
? test/eacl/build_smoke_test.jank
? test/eacl/cache/local_test.jank
? test/eacl/client/public_api_test.jank
? test/eacl/compatibility_fixture_test.jank
? test/eacl/cursor_test.jank
? test/eacl/datomic/memory/.gitkeep
? test/eacl/datomic/memory/index_test.jank
? test/eacl/datomic/memory/relationships_test.jank
? test/eacl/datomic/memory/schema_test.jank
? test/eacl/datomic/memory/store_test.jank
? test/eacl/engine/permission_tree_test.jank
? test/eacl/engine/scalar_test.jank
? test/eacl/feasibility_gate_test.jank
? test/eacl/feasibility_test.jank
? test/eacl/formal/production_refinement_test.jank
? test/eacl/generated_engine_differential_test.jank
? test/eacl/layered_reference_test.jank
? test/eacl/relay/authorized_relationship_test.jank
? test/eacl/relay/raw_pagination_test.jank
? test/eacl/runtime/native/.gitkeep
? test/eacl/runtime/native/runtime_test.jank
? test/eacl/secure_format_test.jank
? test/eacl/spicedb/parser_test.jank
```

## datascript-explorer

- Kind: `existing-demo`
- Directory: `/Users/petrus/code/eacl-explorer`
- HEAD: `fd2487c2be3b0662b943bd1fffe3524e2f1609b9`
- Branch: `main`
- Upstream: `origin/main`
- Status manifest SHA-256: `9a98ac684b6fd871ef489258ece5c6c2bdb53d3a0e960485a2c96bd915e242c2`
- Build status: `failed` — Both Shadow CLJS builds returned :error.

Remotes:

- fetch `origin`: `git@github.com:theronic/eacl-explorer.git`
- push `origin`: `git@github.com:theronic/eacl-explorer.git`

Dependency manifests and locks:

- `deps.edn` — `804cb858ee6ae8d6436a21381215636bfe6c8e2ebc236e83bfa4e9b1fa169cd3` (1102 bytes)
- `package-lock.json` — `52f4d897b60ede01982267dd2dde10af3ca417fbc2d4d7ddbc4f19793e3311ed` (2936 bytes)
- `package.json` — `ff0a4f2ab5ee5842d7061c7553d62ddf8b1bab4f9af18effbba0487efb42b20d` (181 bytes)
- `shadow-cljs.edn` — `f48a8c60979fc93730e2d44ba5291c5bfa7809bb0f843c7338c92fcc17f05b27` (612 bytes)

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid fd2487c2be3b0662b943bd1fffe3524e2f1609b9
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
```

## datalevin-fork

- Kind: `dependency`
- Directory: `/Users/petrus/code/eacl/datalevin`
- HEAD: `a7e29c25a3034b54814e58a2d317e8c6877d1933`
- Branch: `agent/certify-datalevin-ordered-generation-proofs`
- Upstream: `eacl/agent/certify-datalevin-ordered-generation-proofs`
- Status manifest SHA-256: `0126ca4f51d90de1ae019f34296f9612f24d63983e00637275222af6468e9bce`
- Build status: `not-applicable` — Dependency checkout recorded for provenance; it is not itself an existing public demo surface in this change.

Remotes:

- fetch `eacl`: `git@github.com:theronic/datalevin.git`
- push `eacl`: `git@github.com:theronic/datalevin.git`
- fetch `origin`: `git@github.com:datalevin/datalevin.git`
- push `origin`: `git@github.com:datalevin/datalevin.git`

Dependency manifests and locks:

- `.build/bb.edn` — `f7a864e840c70994c6615636e108916e205692c9278a3cad25315979db74d722` (445 bytes)
- `benchmarks/JOB-bench/deps.edn` — `be436c13396c6d578210e8ec9b35a93fb4c29cd37183c3b72ecd3939c4f650f3` (4086 bytes)
- `benchmarks/LDBC-SNB-bench/deps.edn` — `738d44fc91da3b71047bbd21a6dad7162ea168f56b221a629592cae535dbe14e` (521 bytes)
- `benchmarks/access-path-bench/deps.edn` — `8e662954aeb820d483c5cbfcb9b2301305d54b267e6ff42cbf84dbc25f6f1570` (591 bytes)
- `benchmarks/datascript-bench/deps.edn` — `8435beecb53c58db9fa5e3d945cdbac9a6af3b8f0c7515d29755725c9956e6f6` (854 bytes)
- `benchmarks/idoc-bench/deps.edn` — `c423f9044b4fd3992aa791e784a334e863f9b642a5910c90a8fe9e8c504c6b19` (1452 bytes)
- `benchmarks/math-bench/deps.edn` — `58d1bd7edc852547e2072e71288968f3e0679551952445b92b0ea681dc7ca20c` (2216 bytes)
- `benchmarks/openrulebench/deps.edn` — `71cd46e42469114547406dd77c5e709de0ea70a0e75945e16213d50dd04585e0` (996 bytes)
- `benchmarks/search-bench/deps.edn` — `c5abf0f61a93c174f47b1c5b99b5c85b68659235673208ffd757da53f8fea952` (2354 bytes)
- `benchmarks/write-bench/deps.edn` — `6593746d93709221dcaa110da1c503908b7b85cd3b361b57958f1da5e0d40f0f` (2834 bytes)
- `bindings/javascript/package-lock.json` — `7c6fca1ddae43d3f2fcac3eb6c14e70e8827350fd9c4218299cb8a269c167d0a` (4469 bytes)
- `bindings/javascript/package.json` — `e7b7aa58dcf301695d3616ac3b47eaa08b4ae56833ba12c6df0de3dd5f7605ff` (1032 bytes)
- `deps.edn` — `97faecb12db2144dbbfa0883592e1430e1cfa74954dcca95870dfbc244224046` (3789 bytes)
- `examples/bulk-load/project.clj` — `fe16f6ba387c15f02a0e6805dfdaf3e657046a5edbdfdc107c11ccca5d5bf1f5` (633 bytes)
- `examples/simple-deps/deps.edn` — `1edbeaf93e54c5f8dc9cc772fdc6b590f149a3c3d63197651586a3e478a9e261` (1271 bytes)
- `jepsen/project.clj` — `bc50ceb782437b2031864f3fc857f7e47ef85760d9037bb398fda6d5ef007e97` (2381 bytes)
- `project.clj` — `52705865c3139271df7fdbeeb5870bf4fe49c2b4c372611475c55e0f4f062ee9` (4631 bytes)
- `test-jar/deps.edn` — `04b54937688a122b593f9419d0846c6cd43e9fa099ec4ef55d6a513f68beb76b` (282 bytes)

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid a7e29c25a3034b54814e58a2d317e8c6877d1933
# branch.head agent/certify-datalevin-ordered-generation-proofs
# branch.upstream eacl/agent/certify-datalevin-ordered-generation-proofs
# branch.ab +0 -0
```

## rama-adapter

- Kind: `adjacent-source`
- Directory: `/Users/petrus/code/eacl/eacl-rama`
- HEAD: `cd0c1318f433738d1e2074ecb740c55759cd7241`
- Branch: `main`
- Upstream: `origin/main`
- Status manifest SHA-256: `80562568b10d9395dab007e7ec77adf8e1be78531e85603e646426f23012b366`
- Build status: `not-applicable` — Adjacent adapter repository recorded for completeness; it is outside the registered demo profiles.

Remotes:

- fetch `origin`: `git@github.com:theronic/eacl-rama.git`
- push `origin`: `git@github.com:theronic/eacl-rama.git`

Dependency manifests and locks:

- `project.clj` — `5008bb00a89eeb4961b351151f89bd5a3db2e89f6a90b5c026f7068c23a61cb5` (1159 bytes)

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid cd0c1318f433738d1e2074ecb740c55759cd7241
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
```

## spicedb-adapter

- Kind: `adjacent-source`
- Directory: `/Users/petrus/code/eacl/eacl-spicedb`
- HEAD: `370723a9f3af5ea9132935a3bf1ab5f533eabdc6`
- Branch: `agent/add-spicedb-adapter`
- Upstream: `origin/agent/add-spicedb-adapter`
- Status manifest SHA-256: `2edda416c5585ca1912d9004fddac31e7a682150b324bb0f83ff0bdc5631b05e`
- Build status: `not-applicable` — Adjacent adapter repository recorded for completeness; it is outside the registered demo profiles.

Remotes:

- fetch `origin`: `git@github.com:theronic/eacl-spicedb.git`
- push `origin`: `git@github.com:theronic/eacl-spicedb.git`

Dependency manifests and locks:

- `deps.edn` — `75cdade1d17c1f1bf38689bf218fc3b5248319244440159b730cf38c35f9131e` (2828 bytes)

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid 370723a9f3af5ea9132935a3bf1ab5f533eabdc6
# branch.head agent/add-spicedb-adapter
# branch.upstream origin/agent/add-spicedb-adapter
# branch.ab +0 -0
? .nrepl-port
? openspec/changes/upgrade-eacl-v8-snapshot-differential/.openspec.yaml
? openspec/changes/upgrade-eacl-v8-snapshot-differential/README.md
? openspec/changes/upgrade-eacl-v8-snapshot-differential/design.md
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/README.md
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/live-logs/differential-snapshot.log
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/live-logs/extended-snapshot.log
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/live-logs/integration-snapshot.log
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/live-logs/probe-snapshot.log
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/live-logs/probe2-snapshot.log
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/live-logs/probe3-snapshot.log
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/probe.clj
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/probe.sh
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/probe2.clj
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/probe3.clj
? openspec/changes/upgrade-eacl-v8-snapshot-differential/evidence/run-live-snapshot.sh
? openspec/changes/upgrade-eacl-v8-snapshot-differential/proposal.md
? openspec/changes/upgrade-eacl-v8-snapshot-differential/specs/spicedb-authorization-adapter/spec.md
? openspec/changes/upgrade-eacl-v8-snapshot-differential/specs/spicedb-differential-verification/spec.md
? openspec/changes/upgrade-eacl-v8-snapshot-differential/tasks.md
? openspec/config.yaml
? openspec/specs/spicedb-authorization-adapter/spec.md
? openspec/specs/spicedb-differential-verification/spec.md
```

## eacl-demo

- Kind: `canonical-demo`
- Directory: `/Users/petrus/code/eacl/eacl-demo`
- HEAD: unborn
- Branch: `main`
- Upstream: none
- Status manifest SHA-256: `f6c6ca98179263597483cec8d4662b1e099540426b1813da6e4b54683b6811c0`
- Build status: `not-implemented` — The canonical repository is unborn and contains planning/provenance material only at this capture point.

Remotes:

- fetch `origin`: `https://github.com/theronic/eacl-demo.git`
- push `origin`: `https://github.com/theronic/eacl-demo.git`

Dependency manifests and locks:

- None found.

Exact dirty/untracked manifest (`git status --porcelain=v2 -z --branch --untracked-files=all`, shown one NUL-delimited entry per line):

```text
# branch.oid (initial)
# branch.head main
? docs/provenance/build-status-2026-08-25.json
? docs/provenance/source-state-2026-08-25.json
? docs/provenance/source-state-2026-08-25.md
? openspec/changes/consolidate-eacl-demo-backends/.openspec.yaml
? openspec/changes/consolidate-eacl-demo-backends/README.md
? openspec/changes/consolidate-eacl-demo-backends/design.md
? openspec/changes/consolidate-eacl-demo-backends/proposal.md
? openspec/changes/consolidate-eacl-demo-backends/specs/datahike-storage-demos/spec.md
? openspec/changes/consolidate-eacl-demo-backends/specs/datalevin-memory-demo/spec.md
? openspec/changes/consolidate-eacl-demo-backends/specs/datascript-browser-demo/spec.md
? openspec/changes/consolidate-eacl-demo-backends/specs/datomic-read-only-demo/spec.md
? openspec/changes/consolidate-eacl-demo-backends/specs/demo-backend-conformance/spec.md
? openspec/changes/consolidate-eacl-demo-backends/specs/demo-delivery-operations/spec.md
? openspec/changes/consolidate-eacl-demo-backends/specs/jank-lambda-demo/spec.md
? openspec/changes/consolidate-eacl-demo-backends/specs/unified-demo-api/spec.md
? openspec/changes/consolidate-eacl-demo-backends/specs/unified-demo-shell/spec.md
? openspec/changes/consolidate-eacl-demo-backends/tasks.md
? openspec/config.yaml
? scripts/capture-source-state.mjs
```
