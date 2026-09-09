# Schema Graph and Direct Relationship Reads Release

- Released: 2026-09-09
- Demo production: `16de231cec55fef27d8d3bef80b3e0c10283ef4b`
- EACL core: `6982d388b4f4472cfc69dae0f92adc58c62438d8`
- PR: https://github.com/theronic/eacl-demo/pull/103
- Successful deployment: https://github.com/theronic/eacl-demo/actions/runs/34380771514
- Browser runtime SHA-256: `e36ed830cd011e8b1a2337b20f42c18a43dc129d998a4f51afea4db3c42e0a1b`

The approved Solid Flow schema graph, clickable source and focused views are deployed. Nested branches issue plain anchored relationship reads; viewing-subject and permission fields are omitted. Root lookups and explicit permission checks keep their authorization behavior. No fixture or permission-schema changes are included.

## Verification

Local combined release: production static build, TypeScript, 32 desktop/mobile browser tests, 63 contract tests, 91 explorer-state tests, four UI tests, three JVM build-identity tests and ten delivery-policy tests passed. The companion core passed 1,510 JVM tests and 837 CLJS tests, plus focused backend and demo operation suites.

The compiled browser runtime returned disjoint first/next five-row relationship pages and rejected 20 obsolete-field variants. Before rollout, all four existing JVM services accepted a plain anchored relationship request. Every new candidate JVM deployment passed direct first/next pagination and rejection of the old complete authorization caller before publication.

After deployment, all nine public JVM targets reported the demo/core identities above and passed direct pagination plus six obsolete-field rejection cases: Datahike/S3 primary and large Lambdas, Datahike/DynamoDB primary and large Lambdas, Datomic primary and large Lambdas, Datalevin primary Lambda, Datomic EC2 and Datalevin EC2. The browser publication also reported the exact release identities.

Live browser checks at 1440px and 390px verified the full Relations graph, focused platform-to-user super_admin edge after switching definitions, shareable graph URL reload, no horizontal overflow and no browser exceptions. Production Platforms > platform > Accounts expansion issued exactly one reverse-relationships request with no viewer/permission fields.

Internal local counters (not an HTTP latency claim) verified 25 rows with zero permission evaluations, one indexed seek and 27 consumed datoms including pagination probes. Jank remains parked; no Jank production qualification is claimed.

Raw local evidence: ignored target/release/public-matrix.json and target/release/deployment.log; production screenshots under target/verification/production-schema-graph-*.png.
