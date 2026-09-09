# DataScript browser runtime

The main SolidJS application at `/` loads this runtime only when DataScript is selected. Server-profile URLs do not fetch its code or fixture. `/datascript` and `/datascript/` remain compatibility document aliases and canonicalize to `/` without a second navigation.

`npm run build:datascript-runtime` compiles the EACL Core revision pinned in `deps.edn` with `cljs.main -t browser -O advanced`. It runs directly in the browser without Workers, Blob code, or server authorization requests. The build uses EACL's storage-aware connection constructor and embeds the canonical serialized 10,000-resource database.

`npm run build:static-site` publishes `datascript/assets/datascript-runtime-<sha256>.js` and places its URL in inert root-page metadata. The selection-triggered loader shares downloads, retries failures, and keeps session ownership separate from downloaded code.

A fresh session restores 10,000 logical resources plus supporting subjects and relationships. **Add resources** appends the requested number without a fixed resource cap. Additional data uses local accounts with at most 100 servers each to bound write costs. Bounded batches report committed progress; retry resumes the remainder of a failed job. Modified counts and basis reflect local additions; release identity and initial manifest provenance remain unchanged. Switching away releases all session data; returning or reloading restores the initial fixture.

`npm run qualify:datascript-browser` verifies root startup, legacy URLs, history, loading failures, additive seeding, cancellation, and local authorization on desktop/mobile Chromium. `npm run qualify:main-network-isolation` checks server visits, and `npm run verify:datascript-isolation` checks the eager bundle's exclusion of DataScript/CLJS code.
