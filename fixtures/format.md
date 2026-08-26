# Canonical fixture interchange format

The fixture interchange is UTF-8 NDJSON (`application/x-ndjson`). Each line is
one complete JSON value validated by `schemas/fixture-stream.v1.schema.json` and
ends with LF, including the final line. There is no byte-order mark and no
blank line.

The first line is the fixture header. Remaining lines are logical object or
relationship records. JSON object keys are serialized in ascending Unicode
code-point order; arrays retain their declared order; numbers are non-negative
IEEE-754-safe integers; the unsigned 64-bit seed is encoded as a decimal string.
All current identifiers and values are ASCII, so UTF-8 and Unicode collation do
not introduce runtime-specific normalization.

An adapter may stream records without holding the fixture in memory. It must
validate the header before writes, preserve each resource bundle as the
generator exposes it, and verify final counts and digests before publication.
NDJSON records contain no EDN keywords, Java class names, JavaScript `BigInt`,
Jank-native values, Datomic entity IDs, or backend storage keys.

## Runtime consumption

- JVM Clojure reads one UTF-8 line at a time with any standards-compliant JSON
  parser, maps strings to adapter-local keywords only after validation, and
  retains the decimal seed string for identity checks.
- ClojureScript and TypeScript parse each line with `JSON.parse`. Browser
  profiles may stop at the bounded 10,000-resource manifest.
- Jank uses the same JSON field names and string/integer values. It does not need
  JVM `SplittableRandom`; implementations of the generator use the published
  unsigned-64-bit vectors, while deployments may consume pre-generated NDJSON.
- Every runtime hashes the original canonical line bytes, not a reserialized
  native map, when verifying an artifact received from storage.

`schemas/fixture-manifest.v1.schema.json` validates the sidecar manifest. The
`digests.manifest` value is SHA-256 over the canonical manifest plus terminal LF
before the `manifest` member itself is inserted. This avoids self-reference.
The fixture digest covers the header and semantic records; the semantic-record
digest excludes the cut-point-specific header and is used for prefix proofs.

`schemas/fixture-exemplars.v1.schema.json` validates the language-neutral
conformance cases. Expected results are data, not executable JavaScript or
Clojure forms.
