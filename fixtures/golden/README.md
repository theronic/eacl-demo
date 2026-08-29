# Cross-language fixture goldens

`fixture-v1.tsv` is a minimal tab-separated set of canonical algorithm, stable
ID, schema, count, exemplar, prefix, and fixture-digest vectors. The format is
deliberately consumable without a runtime-specific JSON/EDN library.

The vectors are derived from the two accepted manifests by
`scripts/check-fixture-golden.mjs`. Its default mode is check-only; `--write` is
reserved for an intentional fixture identity change followed by regeneration
and review of every manifest.

Executable ports and tests are:

| Runtime | Source/test | Verified on 2026-08-25 |
| --- | --- | --- |
| TypeScript / Node 24.19.0 | `typescript-port.ts`, `typescript-golden.test.ts` | 2 tests passed |
| JVM Clojure 1.12.5 | `fixture_golden.cljc`, `fixture_golden_test.cljc` via nREPL | 2 tests, 23 assertions passed |
| ClojureScript 1.12.145 / Node 24.19.0 | same `.cljc` test plus Node runner, compiled from an nREPL evaluation | 2 tests, 23 assertions passed |
| Jank 0.1-alpha arm64 macOS development binary | `fixture_golden_jank.jank` | native script passed |

The macOS Jank binary's `clojure.core/unchecked-multiply` currently throws
`TODO: port unchecked-multiply`. The passing port therefore uses Jank's
implemented fixed-width integer `*` and `+` operations, which reproduce both
signed SplitMix64 vectors. Linux x86_64 AL2023/Lambda qualification must rerun
this script; a macOS pass is not Linux artifact evidence.

All adapters may instead consume canonical pre-generated NDJSON. No runtime is
permitted to substitute a locally convenient PRNG or ID formatter and still
claim the accepted manifest digest.
