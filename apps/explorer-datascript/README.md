# DataScript explorer entry

`/datascript/` is a separate static entry that renders the exact shared Explorer components and stylesheet from `apps/explorer-main`. It has no presentation components or styling of its own. Selecting DataScript in the main entry navigates here; selecting a server backend here navigates back to the main entry.

`npm run build:datascript-runtime` fetches the exact EACL Core SHA pinned in `deps.edn`, prepares that source, and compiles `eacl-demo.datascript.runtime` with `cljs.main -t browser -O advanced`. This is a normal in-page ClojureScript build. It does not create a Web Worker, Blob, worker protocol, or server process.

The build creates a DataScript-native serialized database from the canonical 10,000-resource fixture and prepends it to the content-addressed runtime. Startup restores the ready database directly instead of replaying fixture transactions in the browser. `npm run build:static-site` publishes the result as `datascript/assets/datascript-runtime-<sha256>.js` and inserts that script before the shared SolidJS entry.

The page runtime owns the DataScript connection, EACL client, cache, cursors, and read-only operation dispatcher. It implements the same compact `{data, meta}` or `{error, meta}` logical envelopes as server backends. Its descriptor reports browser execution and page-local lifecycle semantics. Authorization inputs and results never leave the page.

`verification/datascript/browser-local.spec.ts` proves that the entry creates zero Workers, makes no authorization API requests, restores the fixture, exercises the shared UI and EACL operations, and emits the compact envelope. `npm run verify:datascript-isolation` proves the DataScript/CLJS dependency graph remains absent from the main server-profile entry.
