# Explorer v1 contract

`schemas/explorer.v1.schema.json` is the language-neutral wire authority. Its definitions are closed objects for explorer objects, relationships, page information, bounded counts, authorization decisions and explanation paths, schema, cache information, basis metadata, health, bootstrap, and success/failure envelopes. Bootstrap capabilities are a closed record: operation set, consistency modes, snapshot behavior, cache behavior, mutation locality, and limitations are individually validated. The descriptor also binds the backend/storage pair and runtime execution, name, architecture, and SnapStart status rather than leaving those facts to client inference.

Every response identity binds the profile, exact demo and Core commits, artifact digest, deployment identity, and data-manifest digest. Dynamic object attributes are an array of bounded name/scalar pairs rather than an open JSON object. Backend-native entities, exceptions, Datomic values, Datahike nodes, Datalevin handles, Jank values, and DataScript records cannot leak across the service boundary.

`packages/contracts/error-codes.v1.json` is the stable failure catalog. Each code fixes an HTTP status, retryability, and safe public message for validation, routing/method/media rejection, cursor failures, unsupported consistency, cancellation, deadline, overload, throttling, dependency availability, missing/corrupt storage, identity mismatch, response overflow, and internal failure.

`packages/contracts/limits.v1.json` is the central hard-limit record: 64 KiB request bodies, 1 MiB response/total output, 4 KiB strings and cursors, 256-byte identifiers/path segments, 1,000 array/page items (20 default page), one-million bounded counts, 8 KiB diagnostics, 2 KiB query strings, 10-second request deadline, and 32 admitted concurrent requests per environment. Profiles may publish smaller descriptor limits but never exceed these contract ceilings.

Server operations route only as `/api/v1/{server-profile-id}/{operation}`. DataScript cannot resolve through that table; its content-addressed ClojureScript browser runtime executes the same logical operation names and compact envelopes directly in `/datascript/` under the fixed `datascript-browser-memory` profile identity. It does not create a Worker or claim a WebAssembly architecture.

DataScript binds the direct page runtime to the publication's exact profile, demo/Core commits, runtime digest, deployment ID, and fixture digest before bootstrap. Normal operations are rejected before initialization. The runtime asset is loaded by the separate DataScript entry and never enters the main server-profile graph.

Strict runtime validators compile the JSON schemas for client requests, server responses, fixture manifests, descriptors, registries, and release manifests. They reject unknown fields and malformed identities without placing rejected values in thrown errors or logs.

Both success and failure envelopes are constructed from the same immutable response context. That context carries request ID, profile, deployed demo/Core commits, artifact, deployment, data-manifest, and basis identities. Failure code, status, retryability, and message come from the stable catalog rather than backend exceptions.

Before normal use, the client performs an identity handshake among the requested route, enabled registry entry, health, and bootstrap. Profile, route, deployed demo/Core SHAs, artifact digest, deployment ID, data-manifest digest, and basis must agree; readiness must be true. Any mismatch yields `identity-mismatch` and the transport is released.

The HTTP boundary accepts exact normalized paths, the route's one allowed method, no query parameters, no body/content type for GET, and JSON only for POST. Each operation has a closed body-key and value allowlist with the central bounds. Percent-encoded paths, duplicate separators, trailing slashes, seed/transaction/eviction/admin fields, malformed JSON, and oversized values are rejected before dispatch.

The same-origin browser transport sends one bounded `x-eacl-request-id` on
every request and the exact lowercase SHA-256 payload hash on every POST.
CloudFront forwards only those headers plus content type to the IAM-protected
Function URL. JVM and Jank adapters prefer a valid client request ID and fall
back to the AWS request-context ID for callers that omit it. The browser
accepts an envelope only when schema, HTTP success/failure status, operation,
request ID, profile, demo/Core SHAs, artifact digest, deployment ID, and data
manifest all match the active registry entry.

The execution boundary admits at most 32 concurrent requests per environment, links parent cancellation, races a 10-second deadline, measures serialized response bytes against the 1 MiB ceiling, and runs registered cleanup callbacks exactly once in reverse order on every terminal path. Profiles may configure smaller values but not larger ones.

The public dispatcher accepts exactly the ten shared read-only logical operations. Its handler table must have no missing or extra keys. Schema writes, seeds, setup, benchmarks, transactions, cache eviction, store deletion, and administration have neither routes nor dynamic dispatch names and remain in separate maintenance artifacts/workflows.

Server cursors are HMAC-SHA-256 authenticated, byte-bounded, and expire. Their signed scope includes contract, profile, deployment, data manifest, lifecycle, operation, and a canonical query digest. DataScript instead issues opaque random page-local tokens backed by a bounded registry; closing or replacing the page destroys them. Neither form exposes raw query values or crosses an incompatible identity/lifecycle; invalid/expired and scope-mismatched cursors use distinct stable errors.

Contract identity separates route major from additive revision. A revision-N shell accepts N and N-1 profile descriptors on the same major; older or newer revisions fail negotiation. An additive same-major change increments one revision. An incompatible semantic change is rejected unless it introduces a new `/api/v{major}` route.

Structured redaction removes credentials, authorization/cookies, signing/private keys, connection strings, and database URIs by key; exceptions retain only name and a stable code. Public failures ignore backend messages and stacks, accept only bounded non-secret public details, and collapse unknown exceptions to `internal-error`. Route-table tests assert unlisted mutating or expensive names invoke zero handlers.

`verification/contracts/function-url-v2.cases.json` is the reusable Lambda Function URL payload-v2 event suite for both JVM and Jank custom runtimes. The reference adapter normalizes those events through the same HTTP boundary and emits stable JSON/status/security-header responses; every runtime adapter must pass the fixture unchanged. Additional JVM/Jank cases prove the optional browser correlation header without changing the shared fallback fixtures.
