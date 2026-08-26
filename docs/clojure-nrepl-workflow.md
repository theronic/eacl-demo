# Clojure test workflow

Clojure compilation and tests run through a persistent nREPL. Start it from this repository with the pinned test and nREPL aliases:

```sh
clojure -M:test:nrepl --port 7888
```

Discover running servers with `clj-nrepl-eval --discover-ports`, verify the server belongs to this checkout, then run:

```sh
EACL_NREPL_PORT=7888 npm run test:clojure
```

`scripts/test-clojure-nrepl.mjs` requires an explicit port so it cannot silently evaluate in one of the sibling EACL checkouts. It always requires every namespace with `:reload` before `clojure.test/run-tests` and throws if any test fails or errors. Additional namespaces are passed as a validated comma-separated `EACL_TEST_NAMESPACES` value. Direct `clojure -M:test`, subprocess JVM test runners, and stale requires are not accepted evidence after source changes.

The wrapper also requires a nonzero test count and validates the final nREPL
evaluation record, rather than trusting the evaluator process exit code or a
pass-shaped string printed earlier by test output. Reload a changed source
namespace explicitly before invoking the wrapper when the selected test
namespace only refers to that source as a dependency.

CI starts one repository-local nREPL, records its port, invokes this command for every Clojure namespace batch, and terminates the exact process during cleanup. Interactive development reuses the same server; after any source edit, run the scripted reload rather than trusting previously interned Vars.
