# Backend and storage catalog

`packages/contracts/backend-storage.v1.json` is the closed public catalog. The first selector contains exactly Datahike, Datomic, Datalevin, Jank, and DataScript. The dependent second selector exposes only the relation declared there: Datahike/S3 or DynamoDB; Datomic/DynamoDB; Datalevin/memory; Jank/memory; DataScript/browser memory.

Adding another backend or storage is a contract change requiring schema, registry, routing, capability, fixture, qualification, infrastructure, UI, smoke, and documentation updates. A storage may not appear merely because an adapter library theoretically supports it: it must be an explicit deployed profile in this catalog and the closed profile contract (`packages/contracts/profiles.v1.json`).

`packages/contracts/profiles.v1.json` provides the stable composite identity for every supported pair: `datahike-s3`, `datahike-dynamodb`, `datomic-dynamodb`, `datalevin-memory`, `jank-memory`, and `datascript-browser-memory`. Code looks up this bijection; it does not synthesize IDs by concatenating selector values.

The fail-closed bootstrap registry is synthesized in code from the closed profile contract (`createBaseRegistry` in `packages/explorer-state`): no enabled profiles, `never-deployed` with null identities rather than fabricated placeholders. It is not a shared mutable fleet pointer.

Each deployment owns exactly one same-origin status object at
`/registry/profiles/<profile-id>.json`. The content-addressed
`eacl-demo.profile-publication.v1` record binds the actual demo/Core SHAs,
artifact and version, data-manifest digest, deployment ID, deployed time,
initial-qualification or merge-smoke evidence, state, and last attempt. The
main shell fetches all six allowlisted paths concurrently and composes mixed
generations. Missing, malformed, oversized, redirected, duplicate, tampered,
wrong-profile, or wrong-route content disables only the affected profile. The
shell never treats an embedded enabled fallback as current proof.

Comparable benchmark evidence is a separate content-addressed index and raw-file
boundary. Until the browser has independently loaded and verified both layers,
or whenever either candidate no longer matches its active deployment/data
identity, multiple enabled choices use the stable qualified fallback and make
no speed claim.

Canonical URLs always include the selected backend and storage, then may include only bounded subject, resource type/ID, permission, relation, and view values. Cursor, token, basis, revision, request, cache, seed, page, credential, password, and secret state is never serialized.
